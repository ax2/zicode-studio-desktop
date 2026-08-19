import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import type { WatchCheckResult, WatchItem } from "./watchLogic";
import { normalizeUrl } from "./watchLogic";

export interface WatchScope {
  sceneId: string;
  workspaceId: string;
}

export interface WatchGateway {
  list(scope: WatchScope): Promise<{ items: WatchItem[] }>;
  add(scope: WatchScope, name: string, url: string): Promise<{ item: WatchItem }>;
  update(
    scope: WatchScope,
    item: { id: string; name: string; url: string },
  ): Promise<{ item: WatchItem }>;
  check(scope: WatchScope, id: string): Promise<WatchCheckResult>;
  remove(scope: WatchScope, id: string): Promise<{ removed: boolean }>;
}

export class WatchHttpGateway implements WatchGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Watch gateway requires fetch");
    this.#fetch = fetchImpl;
    this.#location = location;
  }

  async #request(path: string, options: RequestInit = {}): Promise<unknown> {
    const response = await this.#fetch(new URL(path, this.#location.origin).toString(), {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    });
    if (!response.ok) {
      let detail = "";
      try {
        const parsed = await response.json();
        detail = parsed?.error?.message || parsed?.error?.code || "";
      } catch {
        // Ignore non-JSON error bodies.
      }
      throw new Error(detail || `watch failed (${response.status})`);
    }
    return response.json();
  }

  async list(scope: WatchScope): Promise<{ items: WatchItem[] }> {
    const url = new URL("/v2/watch", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    url.searchParams.set("workspaceId", scope.workspaceId);
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`watch failed (${response.status})`);
    return response.json() as Promise<{ items: WatchItem[] }>;
  }

  add(scope: WatchScope, name: string, url: string): Promise<{ item: WatchItem }> {
    return this.#request("/v2/watch/add", {
      method: "POST",
      body: JSON.stringify({ ...scope, name, url }),
    }) as Promise<{ item: WatchItem }>;
  }

  update(
    scope: WatchScope,
    item: { id: string; name: string; url: string },
  ): Promise<{ item: WatchItem }> {
    return this.#request("/v2/watch/update", {
      method: "POST",
      body: JSON.stringify({ ...scope, ...item }),
    }) as Promise<{ item: WatchItem }>;
  }

  check(scope: WatchScope, id: string): Promise<WatchCheckResult> {
    return this.#request("/v2/watch/check", {
      method: "POST",
      body: JSON.stringify({ ...scope, id }),
    }) as Promise<WatchCheckResult>;
  }

  remove(scope: WatchScope, id: string): Promise<{ removed: boolean }> {
    return this.#request("/v2/watch/remove", {
      method: "POST",
      body: JSON.stringify({ ...scope, id }),
    }) as Promise<{ removed: boolean }>;
  }
}

export interface WatchState {
  items: WatchItem[];
  results: Record<string, WatchCheckResult>;
  busy: boolean;
  checking: boolean;
  error: string;
  draftName: string;
  draftUrl: string;
  editingId: string | null;
  setDraft(patch: Partial<Pick<WatchState, "draftName" | "draftUrl">>): void;
  load(): Promise<void>;
  add(): Promise<void>;
  startEdit(item: WatchItem): void;
  saveEdit(): Promise<void>;
  cancelEdit(): void;
  check(id: string): Promise<void>;
  checkAll(): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface WatchOptions {
  gateway?: WatchGateway;
  getTarget(): WatchScope;
  notify(message: string): void;
}

export function createWatchStore(options: WatchOptions) {
    const { gateway = new WatchHttpGateway(), getTarget, notify } = options;
    let loadSeq = 0;
    return create<WatchState>()((set, get) => ({
    items: [],
    results: {},
    busy: false,
    checking: false,
    error: "",
    draftName: "",
    draftUrl: "",
    editingId: null,

    setDraft(patch) {
      set({ ...patch, error: "" });
    },

      async load() {
        const seq = ++loadSeq;
        set({ busy: true, error: "" });
        try {
          const result = await gateway.list(getTarget());
          if (seq !== loadSeq) return;
          set({ items: result.items, busy: false });
        } catch (error) {
          if (seq !== loadSeq) return;
          set({ busy: false, error: friendlyPluginError(error) });
        }
      },

    async add() {
      const { draftName, draftUrl, busy } = get();
      if (!draftName.trim() || !draftUrl.trim() || busy) return;
      set({ busy: true, error: "" });
      try {
        const { item } = await gateway.add(getTarget(), draftName, normalizeUrl(draftUrl));
        set({ draftName: "", draftUrl: "", busy: false });
        notify(t("Watcher added"));
        await get().load();
        // Establish the initial content baseline immediately so the user sees
        // a checked status without a second click.
        if (item?.id) await get().check(item.id);
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    startEdit(item) {
      set({ editingId: item.id, draftName: item.name, draftUrl: item.url, error: "" });
    },

    cancelEdit() {
      set({ editingId: null, draftName: "", draftUrl: "" });
    },

    async saveEdit() {
      const { editingId, draftName, draftUrl, busy } = get();
      if (!editingId || !draftName.trim() || !draftUrl.trim() || busy) return;
      set({ busy: true, error: "" });
      try {
        await gateway.update(getTarget(), {
          id: editingId,
          name: draftName,
          url: normalizeUrl(draftUrl),
        });
        set({ busy: false, editingId: null, draftName: "", draftUrl: "" });
        notify(t("Watcher updated"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async check(id) {
      set({ busy: true, checking: true, error: "" });
      try {
        const result = await gateway.check(getTarget(), id);
        set((state) => ({
          results: { ...state.results, [id]: result },
          busy: false,
          checking: false,
        }));
        await get().load();
      } catch (error) {
        set({ busy: false, checking: false, error: friendlyPluginError(error) });
      }
    },

    async checkAll() {
      const { items, busy } = get();
      if (busy || items.length === 0) return;
      set({ busy: true, checking: true, error: "" });
      // Check watchers in parallel so a long list does not have to wait for
      // each URL sequentially. One unreachable watcher still must not discard
      // the other results, so each outcome is handled independently.
      const settled = await Promise.allSettled(
        items.map((item) => gateway.check(getTarget(), item.id)),
      );
      const results: Record<string, WatchCheckResult> = {};
      let firstError = "";
      items.forEach((item, index) => {
        const outcome = settled[index];
        if (outcome.status === "fulfilled") {
          results[item.id] = outcome.value;
        } else if (!firstError) {
          firstError = friendlyPluginError(outcome.reason);
        }
      });
      set((state) => ({
        results: { ...state.results, ...results },
        busy: false,
        checking: false,
      }));
      const checked = Object.keys(results).length;
      if (checked > 0) {
        notify(
          t("Checked {count} watchers").replace(
            "{count}",
            String(checked),
          ),
        );
      }
      await get().load();
      if (firstError) {
        set({ error: firstError });
      }
    },

    async remove(id) {
      set({ busy: true, error: "" });
      try {
        await gateway.remove(getTarget(), id);
        set((state) => {
          const results = { ...state.results };
          delete results[id];
          return { results, busy: false };
        });
        notify(t("Watcher removed"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },
  }));
}

export type WatchStore = ReturnType<typeof createWatchStore>;

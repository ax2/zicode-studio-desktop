import { create } from "zustand";
import { t } from "../../shared/i18n";
import type { WatchCheckResult, WatchItem } from "./watchLogic";

export interface WatchScope {
  sceneId: string;
  workspaceId: string;
}

export interface WatchGateway {
  list(scope: WatchScope): Promise<{ items: WatchItem[] }>;
  add(scope: WatchScope, name: string, url: string): Promise<{ item: WatchItem }>;
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
  error: string;
  draftName: string;
  draftUrl: string;
  setDraft(patch: Partial<Pick<WatchState, "draftName" | "draftUrl">>): void;
  load(): Promise<void>;
  add(): Promise<void>;
  check(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface WatchOptions {
  gateway?: WatchGateway;
  getTarget(): WatchScope;
  notify(message: string): void;
}

export function createWatchStore(options: WatchOptions) {
  const { gateway = new WatchHttpGateway(), getTarget, notify } = options;
  return create<WatchState>()((set, get) => ({
    items: [],
    results: {},
    busy: false,
    error: "",
    draftName: "",
    draftUrl: "",

    setDraft(patch) {
      set({ ...patch, error: "" });
    },

    async load() {
      set({ busy: true, error: "" });
      try {
        const result = await gateway.list(getTarget());
        set({ items: result.items, busy: false });
      } catch (error) {
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    async add() {
      const { draftName, draftUrl, busy } = get();
      if (!draftName.trim() || !draftUrl.trim() || busy) return;
      set({ busy: true, error: "" });
      try {
        await gateway.add(getTarget(), draftName, draftUrl);
        set({ draftName: "", draftUrl: "", busy: false });
        notify(t("Watcher added"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    async check(id) {
      set({ busy: true, error: "" });
      try {
        const result = await gateway.check(getTarget(), id);
        set((state) => ({
          results: { ...state.results, [id]: result },
          busy: false,
        }));
        await get().load();
      } catch (error) {
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
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
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));
}

export type WatchStore = ReturnType<typeof createWatchStore>;

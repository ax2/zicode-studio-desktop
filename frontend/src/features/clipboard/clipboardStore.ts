import { create } from "zustand";
import { t } from "../../shared/i18n";
import { friendlyPluginError } from "../../shared/hostErrors";
import type { ClipboardItem } from "./clipboardLogic";

export interface ClipboardScope {
  sceneId: string;
  workspaceId: string;
}

export interface ClipboardGateway {
  list(scope: ClipboardScope): Promise<{ items: ClipboardItem[] }>;
  add(scope: ClipboardScope, text: string, source?: string): Promise<{ item: ClipboardItem }>;
  remove(scope: ClipboardScope, id: string): Promise<{ removed: boolean }>;
  clear(scope: ClipboardScope): Promise<{ removed: number }>;
}

export class ClipboardHttpGateway implements ClipboardGateway {
  #fetch: typeof globalThis.fetch;
  #location: Location;

  constructor({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    location = globalThis.location,
  }: {
    fetchImpl?: typeof globalThis.fetch;
    location?: Location;
  } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Clipboard gateway requires fetch");
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
      throw new Error(detail || `clipboard failed (${response.status})`);
    }
    return response.json();
  }

  async list(scope: ClipboardScope): Promise<{ items: ClipboardItem[] }> {
    const url = new URL("/v2/clipboard", this.#location.origin);
    url.searchParams.set("sceneId", scope.sceneId);
    url.searchParams.set("workspaceId", scope.workspaceId);
    const response = await this.#fetch(url.toString());
    if (!response.ok) throw new Error(`clipboard failed (${response.status})`);
    return response.json() as Promise<{ items: ClipboardItem[] }>;
  }

  add(scope: ClipboardScope, text: string, source?: string): Promise<{ item: ClipboardItem }> {
    return this.#request("/v2/clipboard/add", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, workspaceId: scope.workspaceId, text, source }),
    }) as Promise<{ item: ClipboardItem }>;
  }

  remove(scope: ClipboardScope, id: string): Promise<{ removed: boolean }> {
    return this.#request("/v2/clipboard/remove", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, workspaceId: scope.workspaceId, id }),
    }) as Promise<{ removed: boolean }>;
  }

  clear(scope: ClipboardScope): Promise<{ removed: number }> {
    return this.#request("/v2/clipboard/clear", {
      method: "POST",
      body: JSON.stringify({ sceneId: scope.sceneId, workspaceId: scope.workspaceId }),
    }) as Promise<{ removed: number }>;
  }
}

export interface ClipboardState {
  items: ClipboardItem[];
  draft: string;
  busy: boolean;
  error: string;
  setDraft(value: string): void;
  load(): Promise<void>;
  add(): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  paste(): Promise<void>;
  sendToNote(text: string): Promise<void>;
  copyItem(text: string): Promise<void>;
}

export interface ClipboardOptions {
  gateway?: ClipboardGateway;
  getTarget(): ClipboardScope;
  notify(message: string): void;
  saveToNote?(text: string): Promise<void>;
}

export function createClipboardStore(options: ClipboardOptions) {
  const { gateway = new ClipboardHttpGateway(), getTarget, notify, saveToNote } = options;
  return create<ClipboardState>()((set, get) => ({
    items: [],
    draft: "",
    busy: false,
    error: "",

    setDraft(value) {
      set({ draft: value, error: "" });
    },

    async load() {
      set({ busy: true, error: "" });
      try {
        const result = await gateway.list(getTarget());
        set({ items: result.items, busy: false });
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async add() {
      const { draft, busy } = get();
      if (!draft.trim() || busy) return;
      set({ busy: true, error: "" });
      try {
        await gateway.add(getTarget(), draft, "manual");
        set({ draft: "", busy: false });
        notify(t("Added to inbox"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async remove(id) {
      set({ busy: true, error: "" });
      try {
        await gateway.remove(getTarget(), id);
        set({ busy: false });
        notify(t("Item removed"));
        await get().load();
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async clear() {
      set({ busy: true, error: "" });
      try {
        await gateway.clear(getTarget());
        set({ busy: false, items: [] });
        notify(t("Inbox cleared"));
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async paste() {
      try {
        if (typeof navigator.clipboard?.readText !== "function") {
          set({ error: t("Clipboard access is not available") });
          return;
        }
        const text = await navigator.clipboard.readText();
        if (text) {
          set({ draft: text, error: "" });
        } else {
          set({ error: t("Clipboard is empty") });
        }
      } catch {
        set({ error: t("Cannot read the clipboard") });
      }
    },

    async sendToNote(text) {
      if (!saveToNote || !text.trim()) return;
      set({ busy: true, error: "" });
      try {
        await saveToNote(text);
        set({ busy: false });
        notify(t("Sent to notes"));
      } catch (error) {
        set({ busy: false, error: friendlyPluginError(error) });
      }
    },

    async copyItem(text) {
      if (!text) return;
      try {
        if (typeof navigator.clipboard?.writeText !== "function") {
          throw new Error(t("Clipboard access is not available"));
        }
        await navigator.clipboard.writeText(text);
        notify(t("Copied"));
      } catch (error) {
        set({ error: error instanceof Error ? error.message : String(error) });
      }
    },
  }));
}

export type ClipboardStore = ReturnType<typeof createClipboardStore>;

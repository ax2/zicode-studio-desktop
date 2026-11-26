import { create } from "zustand";
import { localizeHostError } from "../../shared/hostErrors";
import { t } from "../../shared/i18n";
import type { ConfigGatewayLike } from "./configStore";

export interface MemoryEntry {
  id: string;
  text: string;
  updatedAt?: string;
}

export interface MemorySnapshot {
  enabled: boolean;
  entries: MemoryEntry[];
}

interface MemoryState extends MemorySnapshot {
  loading: boolean;
  error: string;
  loadedOnce: boolean;
  load(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  add(text: string): Promise<boolean>;
  importEntries(entries: Array<{ text?: string }>): Promise<number>;
  update(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
}

function newEntry(text: string): MemoryEntry {
  return {
    id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    updatedAt: new Date().toISOString(),
  };
}

export function createMemoryStore(gateway: ConfigGatewayLike) {
  // The gateway replaces the whole file. Compute each update after the previous
  // operation settles, so a later edit carries forward the saved snapshot.
  let pending: Promise<unknown> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.catch(() => undefined);
    return result;
  }

  return create<MemoryState>()((set, get) => {
    const reportError = (reason: unknown) => {
      set({
        loadedOnce: false,
        error: localizeHostError(reason instanceof Error ? reason : new Error(String(reason)))
          .message,
      });
    };

    async function loadSnapshot() {
      set({ loading: true, error: "" });
      try {
        const response = await gateway.call("read_memory");
        const data = response?.data as Partial<MemorySnapshot> | undefined;
        if (!response?.ok || typeof data?.enabled !== "boolean" || !Array.isArray(data.entries)) {
          throw new Error(response?.error || t("Could not load memory"));
        }
        set({ enabled: data.enabled, entries: data.entries, loadedOnce: true });
      } catch (reason) {
        reportError(reason);
      } finally {
        set({ loading: false });
      }
    }

    async function commit(next: MemorySnapshot): Promise<boolean> {
      try {
        const response = await gateway.call("write_memory", next);
        const data = response?.data as Partial<MemorySnapshot> | undefined;
        if (!response?.ok || typeof data?.enabled !== "boolean" || !Array.isArray(data.entries)) {
          throw new Error(response?.error || t("Could not save memory"));
        }
        set({ enabled: data.enabled, entries: data.entries, error: "" });
        window.dispatchEvent(new CustomEvent("zicode:memory-changed"));
        return true;
      } catch (reason) {
        reportError(reason);
        return false;
      }
    }

    function mutate<T>(fallback: T, operation: (state: MemorySnapshot) => Promise<T>): Promise<T> {
      return enqueue(async () => {
        if (!get().loadedOnce) await loadSnapshot();
        return get().loadedOnce ? operation(get()) : fallback;
      });
    }

    return {
      enabled: true,
      entries: [],
      loading: false,
      error: "",
      loadedOnce: false,

      load: () => enqueue(loadSnapshot),

      async setEnabled(enabled) {
        await mutate(undefined, async ({ entries }) => {
          await commit({ enabled, entries });
        });
      },

      async add(text) {
        const clean = String(text).trim();
        if (!clean) return false;
        return mutate(false, ({ enabled, entries }) =>
          commit({ enabled, entries: [...entries, newEntry(clean)] }),
        );
      },

      async importEntries(incoming) {
        return mutate(0, async ({ enabled, entries }) => {
          const seen = new Set(entries.map((entry) => entry.text.trim()));
          const additions: MemoryEntry[] = [];
          for (const candidate of incoming ?? []) {
            const text = String(candidate?.text ?? "").trim();
            if (!text || seen.has(text)) continue;
            seen.add(text);
            additions.push(newEntry(text));
          }
          if (!additions.length) return 0;
          const saved = await commit({ enabled, entries: [...entries, ...additions] });
          return saved ? additions.length : 0;
        });
      },

      async update(id, text) {
        const clean = String(text).trim();
        if (!clean) return;
        await mutate(undefined, async ({ enabled, entries }) => {
          const updated = entries.map((entry) =>
            entry.id === id
              ? { ...entry, text: clean, updatedAt: new Date().toISOString() }
              : entry,
          );
          await commit({ enabled, entries: updated });
        });
      },

      async remove(id) {
        await mutate(undefined, async ({ enabled, entries }) => {
          await commit({ enabled, entries: entries.filter((entry) => entry.id !== id) });
        });
      },
    };
  });
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;

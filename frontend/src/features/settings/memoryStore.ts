import { create } from "zustand";
import { t } from "../../shared/i18n";
import { localizeHostError } from "../../shared/hostErrors";
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

interface MemoryState {
  enabled: boolean;
  entries: MemoryEntry[];
  loading: boolean;
  error: string;
  loadedOnce: boolean;
  load(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
  add(text: string): Promise<void>;
  importEntries(entries: Array<{ text?: string }>): Promise<number>;
  update(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export function createMemoryStore(gateway: ConfigGatewayLike) {
  const persist = async (next: MemorySnapshot) => {
    const response = await gateway.call("write_memory", {
      enabled: next.enabled,
      entries: next.entries,
    });
    if (!response?.ok) {
      throw localizeHostError(
        new Error(response?.error || t("Could not save memory")),
      );
    }
    return response.data as unknown as MemorySnapshot;
  };

  return create<MemoryState>()((set, get) => ({
    enabled: true,
    entries: [],
    loading: false,
    error: "",
    loadedOnce: false,

    async load() {
      set({ loading: true, error: "" });
      try {
        const response = await gateway.call("read_memory");
        const data = (response?.data ?? {}) as Partial<MemorySnapshot>;
        set({
          enabled: data.enabled !== false,
          entries: Array.isArray(data.entries) ? data.entries : [],
          loading: false,
          loadedOnce: true,
        });
      } catch (reason) {
        set({
          loading: false,
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ).message,
        });
      }
    },

    async setEnabled(enabled) {
      const next = { enabled, entries: get().entries };
      try {
        const saved = await persist(next);
        set({ enabled: saved.enabled, error: "" });
        window.dispatchEvent(new CustomEvent("zicode:memory-changed"));
      } catch (reason) {
        set({
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ).message,
        });
      }
    },

    async add(text) {
      const clean = String(text).trim();
      if (!clean) return;
      const entry: MemoryEntry = {
        id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: clean,
        updatedAt: new Date().toISOString(),
      };
      const next = { enabled: get().enabled, entries: [...get().entries, entry] };
      try {
        const saved = await persist(next);
        set({ entries: saved.entries, error: "" });
        window.dispatchEvent(new CustomEvent("zicode:memory-changed"));
      } catch (reason) {
        set({
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ).message,
        });
      }
    },

    async importEntries(incoming) {
      const current = get().entries;
      const seen = new Set(current.map((entry) => entry.text.trim()));
      const additions: MemoryEntry[] = [];
      for (const candidate of incoming ?? []) {
        const text = String(candidate?.text ?? "").trim();
        if (!text || seen.has(text)) continue;
        seen.add(text);
        additions.push({
          id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          updatedAt: new Date().toISOString(),
        });
      }
      if (additions.length === 0) return 0;
      const next = { enabled: get().enabled, entries: [...current, ...additions] };
      try {
        const saved = await persist(next);
        set({ entries: saved.entries, error: "" });
        window.dispatchEvent(new CustomEvent("zicode:memory-changed"));
        return additions.length;
      } catch (reason) {
        set({
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ).message,
        });
        return 0;
      }
    },

    async update(id, text) {
      const clean = String(text).trim();
      if (!clean) return;
      const entries = get().entries.map((entry) =>
        entry.id === id
          ? { ...entry, text: clean, updatedAt: new Date().toISOString() }
          : entry,
      );
      const next = { enabled: get().enabled, entries };
      try {
        const saved = await persist(next);
        set({ entries: saved.entries, error: "" });
        window.dispatchEvent(new CustomEvent("zicode:memory-changed"));
      } catch (reason) {
        set({
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ).message,
        });
      }
    },

    async remove(id) {
      const next = {
        enabled: get().enabled,
        entries: get().entries.filter((entry) => entry.id !== id),
      };
      try {
        const saved = await persist(next);
        set({ entries: saved.entries, error: "" });
        window.dispatchEvent(new CustomEvent("zicode:memory-changed"));
      } catch (reason) {
        set({
          error: localizeHostError(
            reason instanceof Error ? reason : new Error(String(reason)),
          ).message,
        });
      }
    },
  }));
}

export type MemoryStore = ReturnType<typeof createMemoryStore>;

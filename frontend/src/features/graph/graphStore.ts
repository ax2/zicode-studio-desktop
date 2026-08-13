import { create } from "zustand";
import type { GraphKnowledge } from "./graphLogic";

export interface GraphState {
  data: GraphKnowledge | null;
  busy: boolean;
  error: string;
  selectedId: string | null;
  load(): Promise<void>;
  select(id: string | null): void;
}

export interface GraphOptions {
  loadKnowledge(): Promise<GraphKnowledge>;
  notify(message: string): void;
}

export function createGraphStore(options: GraphOptions) {
  const { loadKnowledge } = options;
  return create<GraphState>()((set) => ({
    data: null,
    busy: false,
    error: "",
    selectedId: null,

    async load() {
      set({ busy: true, error: "" });
      try {
        const data = await loadKnowledge();
        set({ data, busy: false });
      } catch (error) {
        set({ busy: false, error: error instanceof Error ? error.message : String(error) });
      }
    },

    select(id) {
      set({ selectedId: id });
    },
  }));
}

export type GraphStore = ReturnType<typeof createGraphStore>;

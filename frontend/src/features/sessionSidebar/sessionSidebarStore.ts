import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import type {
  SessionSearchResult,
  SessionSummary,
} from "./sessionSidebarLogic";

export interface ContextMenuRow {
  icon: string;
  label: string;
  action(): void;
}

export interface ContextMenuState {
  x: number;
  y: number;
  rows: ContextMenuRow[];
}

export type SidebarPhase = "idle" | "skeleton" | "loading" | "error" | "ready";

export interface SidebarStore {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  favourites: string[];
  archived: string[];
  archivedCollapsed: boolean;
  projectsCollapsed: Record<string, boolean>;
  unread: string[];
  streaming: string[];
  searchQuery: string;
  searchResults: SessionSearchResult[] | null;
  visibleCount: number;
  phase: SidebarPhase;
  contextMenu: ContextMenuState | null;
  confirmDeleteCount: number | null;
  renamingId: string | null;
}

export type SidebarStoreHook = UseBoundStore<StoreApi<SidebarStore>>;

export function createSidebarStore(initial: {
  activeSessionId?: string | null;
}): SidebarStoreHook {
  return create<SidebarStore>()(() => ({
    sessions: [],
    activeSessionId: initial.activeSessionId ?? null,
    favourites: [],
    archived: [],
    // Archived sessions are secondary; always start the section collapsed on
    // launch (the in-session toggle can still expand it).
    archivedCollapsed: true,
    projectsCollapsed: {},
    unread: [],
    streaming: [],
    searchQuery: "",
    searchResults: null,
    visibleCount: 8,
    phase: "idle",
    contextMenu: null,
    confirmDeleteCount: null,
    renamingId: null,
  }));
}

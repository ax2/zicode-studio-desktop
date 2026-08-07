import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";
import type {
  SessionSearchResult,
} from "../sessionSidebar/sessionSidebarLogic";

export interface SessionSearchDialogStore {
  open: boolean;
  query: string;
  messageMatches: SessionSearchResult[];
  loadingMessages: boolean;
  activeIndex: number;
}

export type SessionSearchDialogStoreHook = UseBoundStore<
  StoreApi<SessionSearchDialogStore>
>;

export function createSearchDialogStore(): SessionSearchDialogStoreHook {
  return create<SessionSearchDialogStore>()(() => ({
    open: false,
    query: "",
    messageMatches: [],
    loadingMessages: false,
    activeIndex: 0,
  }));
}

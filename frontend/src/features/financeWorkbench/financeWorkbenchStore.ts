import type { StoreApi, UseBoundStore } from "zustand";
import { create } from "zustand";

export type FinanceStatusState =
  | "checking"
  | "connected"
  | "missing"
  | "unavailable";

export interface FinanceStatus {
  state: FinanceStatusState;
  error?: string;
}

export interface FinanceWorkbenchStore {
  activeViewId: string;
  sceneId: string | null;
  status: FinanceStatus | null;
  usage: unknown;
  discovery: unknown;
  snapshots: unknown;
  snapshotSaved: unknown;
  backtest: unknown;
  screening: unknown;
  research: unknown;
  paperAccounts: unknown;
  paperOrder: unknown;
  paperLimit: unknown;
  paperMark: unknown;
  busy: Record<string, boolean>;
}

export type FinanceWorkbenchStoreHook = UseBoundStore<
  StoreApi<FinanceWorkbenchStore>
>;

export function createFinanceWorkbenchStore(): FinanceWorkbenchStoreHook {
  return create<FinanceWorkbenchStore>()(() => ({
    activeViewId: "overview",
    sceneId: null,
    status: null,
    usage: null,
    discovery: null,
    snapshots: null,
    snapshotSaved: null,
    backtest: null,
    screening: null,
    research: null,
    paperAccounts: null,
    paperOrder: null,
    paperLimit: null,
    paperMark: null,
    busy: {},
  }));
}

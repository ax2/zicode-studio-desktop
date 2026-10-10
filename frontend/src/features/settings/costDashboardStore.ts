import { create } from "zustand";
import { t } from "../../shared/i18n";
import {
  type AdaptedDashboard,
  adaptDashboardToInfobarPayload,
  type DashboardPayload,
  DEFAULT_RANGE,
  FILTER_STORAGE_KEY,
  RANGE_DAYS,
} from "./costDashboardLogic";

export interface CostDashboardData {
  costDashboard(workspaceId: string): Promise<{ dashboard?: DashboardPayload }>;
}

interface CostDashboardState {
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  range: string;
  rawDashboard: DashboardPayload | null;
  payload: AdaptedDashboard | null;
  load(data: CostDashboardData | null, getWorkspaceId: () => string | undefined): Promise<void>;
  setRange(range: string): void;
}

function loadSavedRange(): string {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return DEFAULT_RANGE;
    const saved = JSON.parse(raw) as { range?: string };
    return saved.range && RANGE_DAYS[saved.range] ? saved.range : DEFAULT_RANGE;
  } catch {
    return DEFAULT_RANGE;
  }
}

function saveRange(range: string): void {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({ range, scope: "all" }));
  } catch {
    // Persistence is best-effort.
  }
}

export function createCostDashboardStore() {
  return create<CostDashboardState>()((set, get) => ({
    status: "idle",
    error: null,
    range: loadSavedRange(),
    rawDashboard: null,
    payload: null,

    async load(data, getWorkspaceId) {
      set({ status: "loading", error: null });
      try {
        const workspaceId = getWorkspaceId();
        if (!workspaceId) throw new Error(t("No active workspace"));
        if (!data) throw new Error(t("Usage data is unavailable"));
        const response = await data.costDashboard(workspaceId);
        const dashboard = response?.dashboard ?? {};
        set({
          status: "ready",
          error: null,
          rawDashboard: dashboard,
          payload: adaptDashboardToInfobarPayload(dashboard, get().range),
        });
      } catch (error) {
        set({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          payload: null,
        });
      }
    },

    setRange(range) {
      if (!RANGE_DAYS[range]) return;
      saveRange(range);
      const current = get();
      set({
        range,
        payload: current.rawDashboard
          ? adaptDashboardToInfobarPayload(current.rawDashboard, range)
          : null,
      });
    },
  }));
}

export type CostDashboardStore = ReturnType<typeof createCostDashboardStore>;

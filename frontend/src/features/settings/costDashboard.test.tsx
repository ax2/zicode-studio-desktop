import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { CostDashboardTab } from "./CostDashboardTab";
import {
  adaptDashboardToInfobarPayload,
  buildActivityMonthLabels,
  buildModelSummary,
  type DashboardPayload,
  deriveOverviewMetrics,
  formatCompact,
  formatUsd,
  overviewNote,
} from "./costDashboardLogic";
import { createCostDashboardStore } from "./costDashboardStore";

const SAMPLE_SESSIONS = [
  {
    time: new Date().toISOString(),
    title: "Fix bug",
    workspace: "zicode-studio-desktop",
    model: "deepseek-v4-flash",
    totalCost: 1.25,
    totalTokens: 15000,
    inputTokens: 10000,
    outputTokens: 5000,
    toolCalls: 4,
    userMessages: 3,
    toolCostByName: { grep: 0.5, read: 0.75 },
  },
  {
    time: new Date(Date.now() - 86400000).toISOString(),
    title: "Write docs",
    model: "deepseek-v4-pro",
    totalCost: 0.75,
    totalTokens: 9000,
    inputTokens: 7000,
    outputTokens: 2000,
    toolCalls: 2,
    userMessages: 2,
  },
];

describe("cost dashboard logic", () => {
  it("adapts sessions into summary, models, tools, and projects", () => {
    const payload = adaptDashboardToInfobarPayload(
      { sessions: SAMPLE_SESSIONS } as DashboardPayload,
      "30d",
    );
    expect(payload.summary.sessionCount).toBe(2);
    expect(payload.summary.totalCost).toBeCloseTo(2.0);
    expect(payload.infobar.models).toHaveLength(2);
    expect(payload.infobar.usage.tools).toHaveLength(2);
    expect(payload.sessions).toHaveLength(2);
  });

  it("filters sessions to the selected range", () => {
    const payload = adaptDashboardToInfobarPayload(
      { sessions: SAMPLE_SESSIONS } as DashboardPayload,
      "7d",
    );
    expect(payload.summary.sessionCount).toBe(2);
    const oldPayload = adaptDashboardToInfobarPayload(
      {
        sessions: [
          ...SAMPLE_SESSIONS,
          { time: new Date(Date.now() - 40 * 86400000).toISOString(), model: "old", totalCost: 5 },
        ],
      } as DashboardPayload,
      "7d",
    );
    expect(oldPayload.summary.sessionCount).toBe(2);
  });

  it("derives overview metrics including streaks", () => {
    const payload = adaptDashboardToInfobarPayload(
      { sessions: SAMPLE_SESSIONS } as DashboardPayload,
      "30d",
    );
    const metrics = deriveOverviewMetrics(payload, payload.infobar.overview);
    expect(metrics.sessions).toBe(2);
    expect(metrics.totalTokens).toBeGreaterThan(0);
    expect(typeof metrics.currentStreak).toBe("number");
  });

  it("builds a model summary with per-day series", () => {
    const payload = adaptDashboardToInfobarPayload(
      { sessions: SAMPLE_SESSIONS } as DashboardPayload,
      "30d",
    );
    const summary = buildModelSummary(payload.infobar.models, payload);
    expect(summary.models.length).toBeGreaterThan(0);
    expect(summary.series[0].data.length).toBe(summary.labels.length);
  });

  it("formats currency and compact numbers", () => {
    expect(formatUsd(1.5)).toBe("$1.50");
    expect(formatCompact(15000)).toMatch(/1\.5/);
  });

  it("builds activity month labels and overview note", () => {
    setLocale("en");
    const labels = buildActivityMonthLabels(
      [{ key: "2026-08-01", value: 1 }],
      0,
    );
    expect(labels.length).toBeGreaterThan(0);
    expect(overviewNote(0)).toContain("War and Peace");
  });
});

describe("cost dashboard store + React tab", () => {
  it("loads usage data and renders overview, models, and sessions", async () => {
    setLocale("en");
    const data = {
      costDashboard: vi.fn(async () => ({
        dashboard: { sessions: SAMPLE_SESSIONS } as DashboardPayload,
      })),
    };
    const store = createCostDashboardStore();
    render(<CostDashboardTab store={store} />);
    await store
      .getState()
      .load(data, () => "workspace-1");
    await waitFor(() => expect(screen.getByText("Overview")).toBeTruthy());
    expect(data.costDashboard).toHaveBeenCalledWith("workspace-1");
    expect(document.querySelectorAll(".cost-dash-stat-card").length).toBeGreaterThan(0);
    expect(screen.getByText("Fix bug")).toBeTruthy();
    expect(document.querySelector(".cost-dash-sessions-table-wrap")).toBeTruthy();
    expect(document.querySelector(".cost-dash-activity-calendar")).toBeTruthy();
  });

  it("switches the quick range and re-adapts the payload", async () => {
    setLocale("en");
    const store = createCostDashboardStore();
    const data = {
      costDashboard: vi.fn(async () => ({
        dashboard: { sessions: SAMPLE_SESSIONS } as DashboardPayload,
      })),
    };
    await store.getState().load(data, () => "workspace-1");
    const before = store.getState().payload?.range.range;
    store.getState().setRange("7d");
    expect(store.getState().range).toBe("7d");
    expect(store.getState().payload?.range.range).toBe("7d");
    expect(before).toBe("30d");
  });

  it("renders a load error state with a retry action", async () => {
    setLocale("en");
    const data = {
      costDashboard: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const store = createCostDashboardStore();
    const onRetry = vi.fn();
    render(<CostDashboardTab store={store} onRetry={onRetry} />);
    await store.getState().load(data, () => "workspace-1");
    await waitFor(() => expect(document.querySelector(".cost-dash-error")).toBeTruthy());
    expect(document.querySelector(".cost-dash-error")?.textContent).toContain("boom");
    screen.getByRole("button", { name: "Retry" }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

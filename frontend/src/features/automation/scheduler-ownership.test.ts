import { expect, it, vi } from "vitest";
import type { AutomationWorkflow } from "./logic";
import { createAutomationStore } from "./store";

it("polls due, failed and finished work without competing with the Host writer", async () => {
  const base: AutomationWorkflow = {
    id: "base",
    title: "Work",
    prompt: "Report",
    enabled: true,
    schedule: "manual",
  };
  const workflows: AutomationWorkflow[] = [
    {
      ...base,
      id: "due",
      schedule: "interval",
      intervalMinutes: 5,
      nextRunAt: "2020-01-01T00:00:00Z",
      requireApproval: true,
    },
    { ...base, id: "retry", maxRetries: 3, history: [{ status: "queued", taskId: "failed" }] },
    { ...base, id: "finished", history: [{ status: "queued", taskId: "done" }] },
  ];
  const tasks = [
    { id: "failed", status: "failed", retryCount: 0 },
    { id: "done", status: "done" },
  ];
  const call = vi.fn(async (operation: string, params?: unknown) => {
    if (operation === "automation_workspace" && (params as { action?: string })?.action === "list")
      return { ok: true, data: { workflows, revision: "workflows-read" } };
    if (operation === "read_super_agent_tasks")
      return { ok: true, data: { tasks, revision: "tasks-read" } };
    throw new Error(`Page polling attempted a write: ${operation}`);
  });
  const notifySystem = vi.fn();
  const store = createAutomationStore({ call, notifySystem, pollIntervalMs: 1000 });
  vi.useFakeTimers();
  try {
    store.getState().startScheduler();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().workflows).toEqual(workflows);
    expect(store.getState().error).toBeNull();
    expect(
      call.mock.calls.filter(([operation]) => operation === "automation_workspace"),
    ).toHaveLength(3);
    expect(
      call.mock.calls.every(
        ([operation, params]) =>
          operation === "read_super_agent_tasks" ||
          (operation === "automation_workspace" &&
            (params as { action?: string })?.action === "list"),
      ),
    ).toBe(true);
    expect(tasks).toEqual([
      { id: "failed", status: "failed", retryCount: 0 },
      { id: "done", status: "done" },
    ]);
    expect(notifySystem).not.toHaveBeenCalled();
  } finally {
    store.getState().destroy();
    vi.useRealTimers();
  }
});

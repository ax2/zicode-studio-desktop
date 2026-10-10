import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskCenterStore } from "../tasks/store";
import { createAutomationStore } from "./store";

const healthy = { ok: true, data: { tasks: [], workflows: [], revision: "read" } };
afterEach(() => vi.useRealTimers());

describe.each([
  { name: "tasks", create: createTaskCenterStore, read: "read_super_agent_tasks" },
  { name: "automation", create: createAutomationStore, read: "automation_workspace" },
])("$name read lifecycle", ({ create, read }) => {
  it("does not retry a readiness failure received after destruction", async () => {
    vi.useFakeTimers();
    let reject!: (reason: Error) => void;
    const response = new Promise<typeof healthy>((_resolve, fail) => { reject = fail; });
    const call = vi.fn(() => response);
    const store = create({ call });
    const loading = store.getState().load();
    store.getState().destroy();
    reject(new Error("unknown_instance"));
    await loading;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(call).toHaveBeenCalledTimes(1);
    expect(store.getState().loading).toBe(false);
    expect(store.getState().error).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending readiness retry when an explicit read recovers", async () => {
    vi.useFakeTimers();
    const call = vi.fn(async () => healthy);
    call.mockRejectedValueOnce(new Error("unknown_instance"));
    const store = create({ call });
    try {
      await store.getState().load();
      expect(vi.getTimerCount()).toBe(1);
      await store.getState().load();
      const calls = call.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(call.mock.calls).toHaveLength(calls);
      expect(store.getState().error).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      store.getState().destroy();
    }
  });

  it("refreshes immediately after reopening during the old tick", async () => {
    vi.useFakeTimers();
    let resolve!: (response: typeof healthy) => void;
    const oldRead = new Promise<typeof healthy>((done) => { resolve = done; });
    let reads = 0;
    const call = vi.fn(async (operation: string) => {
      if (operation === read && ++reads === 1) return oldRead;
      return healthy;
    });
    const store = create({ call });
    try {
      store.getState().startScheduler();
      store.getState().destroy();
      store.getState().startScheduler();
      resolve(healthy);
      await vi.advanceTimersByTimeAsync(0);
      expect(reads).toBe(2);
      expect(store.getState().loading).toBe(false);
      expect(store.getState().error).toBeNull();
    } finally {
      store.getState().destroy();
    }
  });
});

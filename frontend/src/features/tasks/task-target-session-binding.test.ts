import { expect, it, vi } from "vitest";
import { sameTaskTarget, type TaskCenterTarget } from "./approve-task";
import { createTaskCenterStore } from "./store";

it("refreshes task reads when a temporary session binds to a saved session on the same instance", async () => {
  let target: TaskCenterTarget = {
    sceneId: "programming",
    workspaceId: "workspace-a",
    sessionId: "temporary-one",
    instanceId: "instance-a",
  };
  const call = vi.fn(
    async (_operation: string, _params?: unknown, options?: { target?: unknown }) => {
      const requested = options?.target as TaskCenterTarget;
      if (requested.sessionId !== target.sessionId) {
        throw new Error("Runtime request rejected: IdentityMismatch");
      }
      return { ok: true, data: { tasks: [] } };
    },
  );
  const store = createTaskCenterStore({ call, getTarget: () => target });
  try {
    await store.getState().load();
    expect(store.getState().error).toBeNull();

    const saved = { ...target, sessionId: "saved-one" };
    expect(sameTaskTarget(target, saved)).toBe(false);
    target = saved;
    store.getState().syncTarget();
    await store.getState().load();

    expect(store.getState().error).toBeNull();
    expect(call).toHaveBeenLastCalledWith("read_super_agent_tasks", undefined, { target: saved });
  } finally {
    store.getState().destroy();
  }
});

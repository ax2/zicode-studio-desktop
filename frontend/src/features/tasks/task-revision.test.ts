import { expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n.js";
import { createTaskCenterStore } from "./store";

it("rejects a stale foreground update and succeeds after reloading the new version", async () => {
  setLocale("en");
  let revision = "first";
  let persisted = [{ id: "a", title: "original", status: "pending" }];
  const notify = vi.fn();
  const call = vi.fn(async (operation: string, params?: unknown) => {
    if (operation === "read_super_agent_tasks")
      return { ok: true, data: { tasks: persisted, revision } };
    const write = params as { revision?: string; tasks: typeof persisted };
    if (write.revision !== revision) return { ok: false, error: "task_conflict" };
    persisted = write.tasks;
    revision = "saved";
    return { ok: true, data: { revision } };
  });
  const store = createTaskCenterStore({ call, notify });
  try {
    await store.getState().load();
    persisted = [{ id: "a", title: "edited elsewhere", status: "pending" }];
    revision = "second";
    await store.getState().updateTask("a", (task) => ({ ...task, status: "done" }));
    expect(persisted[0]).toMatchObject({ title: "edited elsewhere", status: "pending" });
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Tasks changed elsewhere. Refresh the task list before saving again.",
      }),
    );
    await store.getState().load();
    await store.getState().updateTask("a", (task) => ({ ...task, status: "done" }));
    expect(persisted[0]).toMatchObject({ title: "edited elsewhere", status: "done" });
    expect(store.getState().revision).toBe("saved");
  } finally {
    store.getState().destroy();
    setLocale("zh-CN");
  }
});

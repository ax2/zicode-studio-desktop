import { expect, it, vi } from "vitest";
import { createTaskWriter } from "./create-task";
import type { SuperAgentTask } from "./logic";
import type { TaskDraft } from "./store";

it("serializes creations and reads fresh state after the previous write completes", async () => {
  let persisted: SuperAgentTask[] = [];
  let finishFirst!: () => void;
  const firstWrite = new Promise<void>((resolve) => {
    finishFirst = resolve;
  });
  let writes = 0;
  const readCurrent = vi.fn(async () => ({ tasks: [...persisted], revision: "current" }));
  const writer = createTaskWriter({
    readCurrent,
    call: async (_operation, params) => {
      if (++writes === 1) await firstWrite;
      persisted = (params as { tasks: SuperAgentTask[] }).tasks;
      return { ok: true };
    },
    publish: vi.fn(),
    notify: vi.fn(),
  });
  const draft: TaskDraft = { title: "A", description: "", targetProject: "/a", schedule: "manual" };
  const first = writer(draft);
  const second = writer({ ...draft, title: "B", targetProject: "/b" });
  draft.targetProject = "/changed-after-request";
  await vi.waitFor(() => expect(writes).toBe(1));
  expect(readCurrent).toHaveBeenCalledTimes(1);
  finishFirst();
  expect(await Promise.all([first, second])).toEqual([true, true]);
  expect(persisted.map((task) => task.targetProject)).toEqual(["/a", "/b"]);
  expect(readCurrent).toHaveBeenCalledTimes(2);
});

it("continues after a failed write without publishing a false success", async () => {
  const publish = vi.fn();
  const call = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ ok: true });
  const writer = createTaskWriter({
    readCurrent: async () => ({ tasks: [] }),
    publish,
    call,
    notify: vi.fn(),
  });
  const draft: TaskDraft = { title: "A", description: "", targetProject: "/a", schedule: "manual" };
  expect(await writer(draft)).toBe(false);
  expect(publish).not.toHaveBeenCalled();
  expect(await writer(draft)).toBe(true);
  expect(publish).toHaveBeenCalledTimes(1);
});

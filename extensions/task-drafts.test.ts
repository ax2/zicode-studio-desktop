// @vitest-environment jsdom

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { expect, it } from "vitest";
import type { SuperAgentTask } from "../frontend/src/features/tasks/logic";
import { createTaskCenterStore } from "../frontend/src/features/tasks/store";
import { readTasks, writeTasks } from "./task-repository";

it("recovers a draft from a real workspace file and preserves it on a stale activation", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zicode-drafts-"));
  const file = path.join(directory, "中文项目", ".zicode", "tasks", "tasks.json");
  const call = async (operation: string, params?: unknown) => {
    try {
      const value = params as { tasks: unknown[]; revision: string };
      const saved =
        operation === "read_super_agent_tasks"
          ? readTasks(file)
          : writeTasks(file, value.tasks, value.revision, () => {});
      return { ok: true, data: { ...saved, tasks: saved.tasks as SuperAgentTask[] } };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
  const first = createTaskCenterStore({ call });
  const reopened = createTaskCenterStore({ call });
  try {
    expect(
      await first
        .getState()
        .createTask({
          title: "恢复草稿",
          description: "下一步实现",
          targetProject: "C:/开发/项目",
          schedule: "daily",
          dailyTime: "10:15",
          requireApproval: true,
          saveAsDraft: true,
        }),
    ).toBe(true);
    first.getState().destroy();
    await reopened.getState().load();
    const draft = reopened.getState().tasks[0];
    expect(draft).toMatchObject({
      status: "draft",
      dailyTime: "10:15",
      nextRunAt: null,
      enabled: false,
      requireApproval: true,
    });
    const external = readTasks(file);
    writeTasks(
      file,
      [...external.tasks, { id: "other", status: "pending" }],
      external.revision,
      () => {},
    );
    const before = fs.readFileSync(file, "utf8");
    expect(await reopened.getState().updateTaskMeta(draft.id, { saveAsDraft: false })).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    await reopened.getState().load();
    expect(await reopened.getState().updateTaskMeta(draft.id, { saveAsDraft: false })).toBe(true);
    const saved = readTasks(file).tasks as SuperAgentTask[];
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ status: "pending", enabled: true, requireApproval: true });
    expect(saved[0].nextRunAt).toBeTruthy();
    expect(fs.readdirSync(path.dirname(file))).toEqual(["tasks.json"]);
  } finally {
    first.getState().destroy();
    reopened.getState().destroy();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

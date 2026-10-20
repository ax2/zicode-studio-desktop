// @ts-expect-error native shared module without declarations
import { taskWriteParams } from "../../../../public/super-agent/task-persistence.js";
// @ts-expect-error plain JS module without type declarations
import { markTaskForDispatch, normalizeSuperAgentTasks } from "../../../../public/super-agent/task-state.js";
import { t } from "../../shared/i18n.js";
import type { SuperAgentTask } from "./logic";

export type TaskCenterTarget = {
  sceneId?: string;
  workspaceId?: string;
  instanceId?: string;
  sessionId?: string;
  cwd?: string;
  runtimeMode?: "ai" | "tools";
};

type TaskCall = (
  operation: string,
  params?: unknown,
  options?: { target?: unknown },
) => Promise<{
  ok?: boolean;
  error?: string;
  data?: { tasks?: unknown[]; revision?: string };
}>;

export function sameTaskTarget(a: TaskCenterTarget | null, b: TaskCenterTarget | null): boolean {
  return JSON.stringify([a?.sceneId, a?.workspaceId, a?.sessionId, a?.instanceId, a?.cwd, a?.runtimeMode]) ===
    JSON.stringify([b?.sceneId, b?.workspaceId, b?.sessionId, b?.instanceId, b?.cwd, b?.runtimeMode]);
}

export async function approveExistingTask(call: TaskCall, taskId: string, target: TaskCenterTarget | null) {
  const fixedCall = (operation: string, params?: unknown) =>
    call(operation, params, target ? { target } : undefined);
  const read = await fixedCall("read_super_agent_tasks");
  if (!read?.ok || !Array.isArray(read.data?.tasks)) {
    throw new Error(read?.error || t("Task service is unavailable"));
  }
  const tasks = normalizeSuperAgentTasks(read.data.tasks) as SuperAgentTask[];
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index < 0 || tasks[index].status !== "pending") {
    throw new Error(t("Task is no longer pending"));
  }
  const next = [...tasks];
  next[index] = markTaskForDispatch(next[index]);
  const write = await fixedCall("write_super_agent_tasks", taskWriteParams(next, read.data.revision));
  if (!write?.ok) throw new Error(write?.error || t("Could not approve task"));
  return { task: next[index], tasks: next, revision: write.data?.revision };
}

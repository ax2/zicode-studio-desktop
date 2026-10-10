// Read-modify-write helper for the Agent Inbox task list persisted through the
// picot-config data plane (`read_super_agent_tasks` / `write_super_agent_tasks`).
//
// Dispatch runs asynchronously and must not clobber concurrent edits made by
// the Runtime panel, so every mutation re-reads the latest tasks, applies the
// updater to the matching task, and writes the whole list back.

import { taskWriteParams } from "./task-persistence.js";
import { normalizeSuperAgentTasks } from "./task-state.js";

export async function updateSuperAgentTask(call, taskId, updater) {
  if (typeof call !== "function") return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await call("read_super_agent_tasks");
    if (!result?.ok || !Array.isArray(result.data?.tasks))
      throw new Error(result?.error || "Failed to read Agent Inbox tasks");
    const tasks = normalizeSuperAgentTasks(result.data?.tasks || []);
    const index = tasks.findIndex((task) => task.id === taskId);
    if (index < 0) return null;
    const next = updater(tasks[index]);
    if (!next) return null;
    tasks[index] = next;
    const write = await call(
      "write_super_agent_tasks",
      taskWriteParams(tasks, result.data?.revision),
    );
    if (!write?.ok && write?.error === "task_conflict" && attempt < 2) continue;
    if (!write?.ok) throw new Error(write?.error || "Failed to persist Agent Inbox tasks");
    return next;
  }
  return null;
}

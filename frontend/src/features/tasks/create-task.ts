// @ts-expect-error native shared module without declarations
import { taskWriteParams } from "../../../../public/super-agent/task-persistence.js";
import { localizeHostError } from "../../shared/hostErrors.js";
import { t } from "../../shared/i18n.js";
import type { TaskCenterTarget } from "./approve-task";
import { nextTaskRunAt, type SuperAgentTask } from "./logic";
import type { TaskCenterOptions, TaskDraft } from "./store";

/** Serialize creations in this center; other clients still require a service-side transaction. */
export function createTaskWriter({
  call,
  readCurrent,
  publish,
  notify,
  scopeToken,
  isScopeCurrent,
}: {
  call: TaskCenterOptions["call"];
  readCurrent(): Promise<{ tasks: SuperAgentTask[]; revision?: string; target?: TaskCenterTarget | null }>;
  publish(task: SuperAgentTask, revision?: string, target?: TaskCenterTarget | null): void;
  notify: NonNullable<TaskCenterOptions["notify"]>;
  scopeToken?: () => number;
  isScopeCurrent?: (token: number) => boolean;
}) {
  let queue: Promise<unknown> = Promise.resolve();
  async function save(draft: TaskDraft, token: number): Promise<boolean> {
    const title = String(draft.title || "").trim();
    if (!title) {
      notify({ title: t("Task title is required"), type: "error" });
      return false;
    }
    try {
      if (isScopeCurrent && !isScopeCurrent(token)) throw new Error(t("Workspace changed. Retry the task action."));
      const current = await readCurrent();
      if (isScopeCurrent && !isScopeCurrent(token)) throw new Error(t("Workspace changed. Retry the task action."));
      const now = new Date().toISOString();
      const scheduled = draft.schedule !== "manual";
      const isDraft = draft.saveAsDraft === true;
      const task = {
        id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        description: String(draft.description || "").trim(),
        targetProject: String(draft.targetProject || "").trim() || null,
        status: isDraft ? "draft" : "pending",
        source: { channel: "local", conversationId: null, userId: null, messageId: null },
        automation: {
          workflowId: null,
          trigger: scheduled ? "schedule" : "manual",
          autoDispatch: isDraft || scheduled ? false : !draft.requireApproval,
        },
        schedule: scheduled ? draft.schedule : null,
        intervalMinutes: draft.schedule === "interval" ? draft.intervalMinutes : null,
        dailyTime: draft.schedule === "daily" ? draft.dailyTime : null,
        nextRunAt: scheduled && !isDraft
          ? nextTaskRunAt({
              schedule: draft.schedule,
              intervalMinutes: draft.intervalMinutes,
              dailyTime: draft.dailyTime,
            })
          : null,
        enabled: isDraft ? false : scheduled ? true : undefined,
        requireApproval: Boolean(draft.requireApproval),
        budget: null,
        maxRetries: Number.isFinite(Number(draft.maxRetries)) ? Number(draft.maxRetries) : 2,
        retryCount: 0,
        events: [
          {
            at: now,
            type: isDraft ? "draft_saved" : "queued",
            status: isDraft ? "draft" : "pending",
            message: isDraft ? t("Task draft saved.") : scheduled ? t("Scheduled task created.") : t("Task created."),
          },
        ],
      };
      const response = await call(
        "write_super_agent_tasks",
        taskWriteParams([...current.tasks, task], current.revision),
        current.target ? { target: current.target } : undefined,
      );
      if (!response?.ok) throw new Error(response?.error || t("Could not create task"));
      if (!isScopeCurrent || isScopeCurrent(token)) publish(task, response.data?.revision, current.target);
      notify({
        title: isDraft ? t("Task draft saved") : scheduled ? t("Scheduled task created") : t("Task created"),
        type: "success",
      });
      return true;
    } catch (reason) {
      notify({
        title: t("Could not create task"),
        message: localizeHostError(reason).message,
        type: "error",
      });
      return false;
    }
  }
  return (draft: TaskDraft): Promise<boolean> => {
    const captured = { ...draft };
    const token = scopeToken?.() ?? 0;
    const result = queue.then(() => save(captured, token));
    queue = result.catch(() => {});
    return result;
  };
}

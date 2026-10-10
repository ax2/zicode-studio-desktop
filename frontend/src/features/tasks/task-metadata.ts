import { t } from "../../shared/i18n.js";
import { nextTaskRunAt, type SuperAgentTask } from "./logic";
import type { TaskDraft } from "./store";

/** Keep draft scheduling inert until the user explicitly activates it. */
export function taskMetadata(
  current: SuperAgentTask,
  patch: Partial<TaskDraft> & { enabled?: boolean },
): SuperAgentTask {
  if (patch.saveAsDraft === true && current.status !== "draft")
    throw new Error(t("Only drafts can be saved as drafts."));
  const draft = current.status === "draft" && patch.saveAsDraft !== false;
  const activating = current.status === "draft" && !draft;
  const schedule = patch.schedule ?? current.schedule ?? "manual";
  const scheduled = schedule !== "manual";
  const title = patch.title !== undefined ? String(patch.title).trim() : current.title;
  if (!title?.trim()) throw new Error(t("Task title is required"));
  const fields = {
    schedule: scheduled ? schedule : null,
    intervalMinutes:
      schedule === "interval" ? (patch.intervalMinutes ?? current.intervalMinutes ?? 60) : null,
    dailyTime: schedule === "daily" ? (patch.dailyTime ?? current.dailyTime ?? "09:00") : null,
  };
  return {
    ...current,
    ...fields,
    title,
    description:
      patch.description !== undefined ? String(patch.description).trim() : current.description,
    targetProject:
      patch.targetProject !== undefined
        ? String(patch.targetProject).trim() || null
        : current.targetProject,
    status: activating ? "pending" : current.status,
    requireApproval: patch.requireApproval ?? current.requireApproval,
    enabled: draft ? false : activating && scheduled ? true : (patch.enabled ?? current.enabled),
    maxRetries:
      patch.maxRetries !== undefined && Number.isFinite(Number(patch.maxRetries))
        ? Number(patch.maxRetries)
        : current.maxRetries,
    automation: {
      ...(current.automation || {}),
      trigger: scheduled ? "schedule" : "manual",
      autoDispatch:
        draft || scheduled ? false : !(patch.requireApproval ?? current.requireApproval),
    },
    nextRunAt: scheduled && !draft ? nextTaskRunAt(fields) : null,
    events: [
      ...(current.events || []),
      {
        at: new Date().toISOString(),
        type: activating ? "queued" : "updated",
        status: activating ? "pending" : current.status,
        message: activating
          ? t("Task activated.")
          : draft
            ? t("Task draft saved.")
            : t("Task updated"),
      },
    ],
  };
}

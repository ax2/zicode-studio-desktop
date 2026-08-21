import { t } from "../../shared/i18n.js";

export type TaskFilter =
  | "all"
  | "scheduled"
  | "running"
  | "paused"
  | "needs_input"
  | "failed"
  | "done"
  | "cancelled";

export interface SuperAgentTask {
  id: string;
  title?: string;
  description?: string;
  status: string;
  targetProject?: string | null;
  maxRetries?: number | null;
  retryCount?: number;
  budget?: number | null;
  failReason?: string | null;
  result?: {
    status?: string | null;
    summary?: string | null;
    completedAt?: string | null;
    failReason?: string | null;
  };
  dispatch?: {
    targetProject?: string | null;
    childWorkspaceId?: string | null;
    childSessionId?: string | null;
    childInstanceId?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  };
  automation?: {
    workflowId?: string;
    trigger?: string;
    autoDispatch?: boolean;
  };
  // User-managed scheduling. A task with a non-manual schedule acts as a
  // recurring template: the task center's scheduler spawns a fresh instance
  // (without schedule fields) each time `nextRunAt` passes.
  schedule?: "manual" | "interval" | "daily" | null;
  intervalMinutes?: number | null;
  dailyTime?: string | null;
  nextRunAt?: string | null;
  enabled?: boolean;
  requireApproval?: boolean;
  scheduledFrom?: string | null;
  // User-facing pin: pinned tasks stay at the top of every list view.
  pinned?: boolean;
  events?: Array<{ at?: string; type?: string; status?: string; message?: string }>;
}

export const TASK_FILTERS: TaskFilter[] = [
  "all",
  "scheduled",
  "running",
  "paused",
  "needs_input",
  "failed",
  "done",
  "cancelled",
];

export function filterLabel(filter: TaskFilter): string {
  const labels: Record<TaskFilter, string> = {
    all: "All tasks",
    scheduled: "Scheduled",
    running: "Running",
    paused: "Paused",
    needs_input: "Needs input",
    failed: "Failed",
    done: "Completed",
    cancelled: "Cancelled",
  };
  return labels[filter];
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "Pending",
    running: "Running",
    paused: "Paused",
    needs_input: "Needs input",
    blocked: "Blocked",
    failed: "Failed",
    done: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status] || status;
}

export function filteredTasks(tasks: SuperAgentTask[], id: TaskFilter): SuperAgentTask[] {
  let base: SuperAgentTask[];
  if (id === "all") base = tasks;
  else if (id === "scheduled") base = tasks.filter((task) => isScheduledTemplate(task));
  else if (id === "running") {
    base = tasks.filter(
      (task) => !isScheduledTemplate(task) && ["running", "pending"].includes(task.status),
    );
  } else if (id === "needs_input") {
    base = tasks.filter(
      (task) => !isScheduledTemplate(task) && ["needs_input", "blocked"].includes(task.status),
    );
  } else {
    base = tasks.filter((task) => !isScheduledTemplate(task) && task.status === id);
  }
  return sortTaskList(base);
}

// Keep the active/important work on top: scheduled templates (soonest next run
// first), then pending/running/needs-input/failed/paused tasks, then history
// by most recent activity. Without this, old finished runs bury new work.
const ACTIVE_TASK_STATUSES = new Set([
  "pending",
  "running",
  "needs_input",
  "blocked",
  "failed",
  "paused",
]);

function taskActivityMs(task: SuperAgentTask): number {
  const candidate =
    task.events?.at(-1)?.at ||
    task.result?.completedAt ||
    task.dispatch?.startedAt ||
    "";
  const time = new Date(candidate).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function sortTaskList(tasks: SuperAgentTask[]): SuperAgentTask[] {
  return [...tasks].sort((a, b) => {
    const aPinned = Boolean(a.pinned);
    const bPinned = Boolean(b.pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aTemplate = isScheduledTemplate(a);
    const bTemplate = isScheduledTemplate(b);
    if (aTemplate !== bTemplate) return aTemplate ? -1 : 1;
    if (aTemplate && bTemplate) {
      const aNext = new Date(a.nextRunAt ?? "0").getTime();
      const bNext = new Date(b.nextRunAt ?? "0").getTime();
      return (
        (Number.isFinite(aNext) ? aNext : Number.MAX_SAFE_INTEGER) -
        (Number.isFinite(bNext) ? bNext : Number.MAX_SAFE_INTEGER)
      );
    }
    const aActive = ACTIVE_TASK_STATUSES.has(a.status) ? 0 : 1;
    const bActive = ACTIVE_TASK_STATUSES.has(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return taskActivityMs(b) - taskActivityMs(a);
  });
}

/**
 * Workspace a task belongs to. Tasks created from a scheduled template or an
 * Agent Inbox entry keep the project they were launched against; everything
 * else falls back to the default workspace label.
 */
export function taskWorkspace(task: SuperAgentTask): string {
  const path =
    String(task?.targetProject || task?.dispatch?.targetProject || "").trim() || "";
  return path || "__default__";
}

export function defaultWorkspaceKey(): string {
  return "__default__";
}

export function isDefaultWorkspace(key: string): boolean {
  return key === "__default__";
}

/**
 * Group a sorted task list by workspace, preserving the first-seen order so
 * active/pinned work stays above historical groups.
 */
export function groupTasksByWorkspace(
  tasks: SuperAgentTask[],
): Array<{ workspace: string; tasks: SuperAgentTask[] }> {
  const groups: Array<{ workspace: string; tasks: SuperAgentTask[] }> = [];
  const index = new Map<string, number>();
  for (const task of tasks) {
    const key = taskWorkspace(task);
    const existing = index.get(key);
    if (existing !== undefined) {
      groups[existing].tasks.push(task);
    } else {
      index.set(key, groups.length);
      groups.push({ workspace: key, tasks: [task] });
    }
  }
  return groups;
}

export function taskLastActivity(task: SuperAgentTask): string | null {
  const candidate =
    task?.events?.at(-1)?.at ||
    task?.result?.completedAt ||
    task?.dispatch?.startedAt ||
    task?.dispatch?.finishedAt ||
    null;
  return candidate && new Date(candidate).getTime() > 0 ? candidate : null;
}

export function isScheduledTemplate(task: SuperAgentTask): boolean {
  return Boolean(task?.schedule && task.schedule !== "manual");
}

export function nextTaskRunAt(
  task: Pick<SuperAgentTask, "schedule" | "intervalMinutes" | "dailyTime">,
  now: Date = new Date(),
): string | null {
  if (task?.schedule === "interval") {
    const minutes = Math.max(5, Number(task.intervalMinutes) || 60);
    return new Date(now.getTime() + minutes * 60_000).toISOString();
  }
  if (task?.schedule === "daily") {
    const [hours, minutes] = String(task.dailyTime || "09:00")
      .split(":")
      .map(Number);
    const next = new Date(now);
    next.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
  }
  return null;
}

export function scheduleDescription(task: SuperAgentTask): string {
  if (task?.schedule === "interval") {
    return t("Every {count} minutes").replace(
      "{count}",
      String(Math.max(5, Number(task.intervalMinutes) || 60)),
    );
  }
  if (task?.schedule === "daily") {
    return t("Daily at {time}").replace("{time}", String(task.dailyTime || "09:00"));
  }
  return t("Manual");
}

export function scheduledTaskStats(
  template: SuperAgentTask,
  tasks: SuperAgentTask[],
): { runCount: number; lastRunAt: string | null } {
  const instances = tasks.filter((task) => task.scheduledFrom === template.id);
  let lastRunAt: string | null = null;
  for (const instance of instances) {
    const candidate =
      instance.result?.completedAt ||
      instance.dispatch?.startedAt ||
      instance.events?.at(-1)?.at ||
      null;
    if (candidate && (!lastRunAt || candidate > lastRunAt)) lastRunAt = candidate;
  }
  return { runCount: instances.length, lastRunAt };
}

export function childTarget(task: SuperAgentTask) {
  const dispatch = task?.dispatch || {};
  if (!dispatch.childWorkspaceId || !dispatch.childSessionId || !dispatch.childInstanceId) {
    return null;
  }
  return {
    workspaceId: dispatch.childWorkspaceId,
    sessionId: dispatch.childSessionId,
    instanceId: dispatch.childInstanceId,
  };
}

export function retryLimitReached(task: SuperAgentTask): boolean {
  return (
    Number.isFinite(Number(task.maxRetries)) &&
    Number(task.retryCount || 0) >= Number(task.maxRetries)
  );
}

export function formatDate(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 60 * 1000) return t("Just now");
  if (deltaMs < 60 * 60 * 1000) {
    return t("{count}m ago").replace(
      "{count}",
      String(Math.floor(deltaMs / (60 * 1000))),
    );
  }
  if (deltaMs < 24 * 60 * 60 * 1000) {
    return t("{count}h ago").replace(
      "{count}",
      String(Math.floor(deltaMs / (60 * 60 * 1000))),
    );
  }
  return date.toLocaleString();
}

export function taskProject(task: SuperAgentTask): string {
  return task.targetProject || task.dispatch?.targetProject || t("Not assigned");
}

export function taskSummaryText(task: SuperAgentTask): string {
  return task.result?.summary || task.result?.failReason || task.failReason || "";
}

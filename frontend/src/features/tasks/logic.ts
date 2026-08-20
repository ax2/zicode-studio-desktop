import { t } from "../../shared/i18n.js";

export type TaskFilter =
  | "all"
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
  events?: Array<{ at?: string; type?: string; status?: string; message?: string }>;
}

export const TASK_FILTERS: TaskFilter[] = [
  "all",
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
  if (id === "all") return tasks;
  if (id === "running") return tasks.filter((task) => ["running", "pending"].includes(task.status));
  if (id === "needs_input") {
    return tasks.filter((task) => ["needs_input", "blocked"].includes(task.status));
  }
  return tasks.filter((task) => task.status === id);
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

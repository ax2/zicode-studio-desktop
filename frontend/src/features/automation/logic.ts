import { t } from "../../shared/i18n.js";

export type AutomationSchedule = "manual" | "interval" | "daily";

export interface AutomationRun {
  status: string;
  startedAt?: string;
  taskId?: string | null;
  message?: string;
}

export interface AutomationWorkflow {
  id: string;
  title: string;
  prompt: string;
  targetProject?: string | null;
  enabled: boolean;
  schedule: AutomationSchedule;
  intervalMinutes?: number | null;
  dailyTime?: string | null;
  requireApproval?: boolean;
  approvalPending?: boolean;
  nextRunAt?: string | null;
  maxCost?: number | null;
  maxRetries?: number;
  history?: AutomationRun[];
}

export const AUTOMATION_FILTERS = ["all", "enabled", "approval", "history"] as const;
export type AutomationFilter = (typeof AUTOMATION_FILTERS)[number];

export function nextAutomationRun(
  workflow: Pick<AutomationWorkflow, "enabled" | "schedule" | "intervalMinutes" | "dailyTime">,
  from: Date = new Date(),
): string | null {
  if (!workflow?.enabled || workflow.schedule === "manual") return null;
  const base = new Date(from);
  if (workflow.schedule === "interval") {
    const minutes = Math.max(5, Number(workflow.intervalMinutes) || 60);
    return new Date(base.getTime() + minutes * 60_000).toISOString();
  }
  const [hour, minute] = String(workflow.dailyTime || "09:00")
    .split(":")
    .map(Number);
  const next = new Date(base);
  next.setHours(
    Number.isFinite(hour) ? hour : 9,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  );
  if (next <= base) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

export function isAutomationDue(
  workflow: Pick<
    AutomationWorkflow,
    "enabled" | "schedule" | "approvalPending" | "nextRunAt"
  >,
  now: Date = new Date(),
): boolean {
  if (!workflow?.enabled || workflow.schedule === "manual" || workflow.approvalPending) {
    return false;
  }
  if (!workflow.nextRunAt) return true;
  const next = new Date(workflow.nextRunAt).getTime();
  return Number.isFinite(next) && next <= new Date(now).getTime();
}

export function filterLabel(id: AutomationFilter): string {
  const labels: Record<AutomationFilter, string> = {
    all: "All automations",
    enabled: "Enabled",
    approval: "Needs approval",
    history: "Run history",
  };
  return labels[id];
}

export function scheduleLabel(workflow: AutomationWorkflow): string {
  if (workflow.schedule === "interval") {
    return `${t("Every")} ${workflow.intervalMinutes} ${t("minutes")}`;
  }
  if (workflow.schedule === "daily") return `${t("Daily at")} ${workflow.dailyTime}`;
  return t("Manual");
}

export function formatDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

export function filterWorkflows(
  workflows: AutomationWorkflow[],
  id: AutomationFilter,
  pendingApprovalTasks?: Record<string, string>,
): AutomationWorkflow[] {
  if (id === "all") return workflows;
  if (id === "enabled") return workflows.filter((workflow) => workflow.enabled);
  if (id === "approval") return workflows.filter((workflow) => pendingApprovalTasks ? Boolean(pendingApprovalTasks[workflow.id]) : Boolean(workflow.approvalPending));
  return workflows.filter((workflow) => workflow.history?.length);
}

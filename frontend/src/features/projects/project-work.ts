import type { ProjectTarget } from "./logic";

export interface ProjectTaskSummary {
  id: string;
  title: string;
  status: string;
  summary: string;
}

export interface ProjectAutomationSummary {
  id: string;
  title: string;
  enabled: boolean;
  approvalPending: boolean;
  nextRunAt: string;
}

export interface ProjectWork {
  tasks: ProjectTaskSummary[];
  automations: ProjectAutomationSummary[];
  tasksUnavailable: boolean;
  automationsUnavailable: boolean;
}

export function emptyProjectWork(): ProjectWork {
  return { tasks: [], automations: [], tasksUnavailable: true, automationsUnavailable: true };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// Compare only explicit absolute paths. This is UI association, not filesystem authorization.
export function projectPathKey(value: unknown): string {
  const raw = text(value);
  const windows = /^[a-z]:[\\/]/i.test(raw) || raw.startsWith("\\\\") || raw.startsWith("//");
  let path = windows ? raw.replace(/\\/g, "/") : raw;
  if (/^\/\/\?\/unc\//i.test(path)) path = `//${path.slice(8)}`;
  else if (path.startsWith("//?/")) path = path.slice(4);
  if (windows) {
    path = path.startsWith("//")
      ? `//${path.slice(2).replace(/^\/+/, "").replace(/\/+/g, "/")}`
      : path.replace(/\/+/g, "/");
  }
  if (!windows && !path.startsWith("/")) return "";
  if (path.split("/").some((part) => part === "." || part === "..")) return "";
  path = path.replace(/\/+$/, "") || "/";
  return windows ? path.toLowerCase() : path;
}

function belongs(item: Record<string, unknown>, target: ProjectTarget | null): boolean {
  const dispatch = record(item.dispatch);
  const declared = text(item.targetProject) || text(dispatch.targetProject);
  if (declared) {
    const key = projectPathKey(declared);
    return Boolean(
      key && [target?.cwd, target?.projectPath].some((path) => projectPathKey(path) === key),
    );
  }
  return Boolean(target?.workspaceId && dispatch.childWorkspaceId === target.workspaceId);
}

function source(response: unknown, key: string): unknown[] | null {
  const result = record(response);
  if (result.ok !== true) return null;
  const data = record(result.data);
  const values = data[key] ?? record(data.workspace)[key];
  return Array.isArray(values) ? values : null;
}

const ACTIVE = new Set(["pending", "running", "needs_input", "blocked", "failed", "paused"]);

export function projectWorkFromResponses(
  tasksResponse: unknown,
  automationsResponse: unknown,
  target: ProjectTarget | null,
  previous: ProjectWork = emptyProjectWork(),
): ProjectWork {
  const taskSource = source(tasksResponse, "tasks");
  const automationSource = source(automationsResponse, "workflows");
  return {
    tasksUnavailable: taskSource === null,
    automationsUnavailable: automationSource === null,
    tasks:
      taskSource === null
        ? previous.tasks
        : taskSource
            .map(record)
            .filter((item) => text(item.id) && item.archived !== true && belongs(item, target))
            .map((item) => ({
              id: text(item.id),
              title: text(item.title),
              status: text(item.status),
              summary: text(record(item.result).summary) || text(item.description),
            }))
            .sort((a, b) => Number(ACTIVE.has(b.status)) - Number(ACTIVE.has(a.status))),
    automations:
      automationSource === null
        ? previous.automations
        : automationSource
            .map(record)
            .filter((item) => text(item.id) && belongs(item, target))
            .map((item) => ({
              id: text(item.id),
              title: text(item.title),
              enabled: item.enabled === true,
              approvalPending: item.approvalPending === true,
              nextRunAt: text(item.nextRunAt),
            })),
  };
}

export interface RpivTodoTask {
  id: number;
  subject: string;
  status: "pending" | "in_progress" | "completed" | "deleted";
  blockedBy?: number[];
  activeForm?: string;
}

export interface RpivTodoDetails {
  tasks: RpivTodoTask[];
  nextId: number;
}

export const TODO_TOOL_NAME = "todo";
export const TODO_WIDGET_KEY = "rpiv-todos";

export const EMPTY_STATE: RpivTodoDetails = Object.freeze({
  tasks: Object.freeze([]),
  nextId: 1,
}) as unknown as RpivTodoDetails;

export const STATUS_LABELS: Record<RpivTodoTask["status"], string> = {
  pending: "pending",
  in_progress: "in progress",
  completed: "completed",
  deleted: "deleted",
};

export const STATUS_GLYPHS: Record<RpivTodoTask["status"], string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
  deleted: "✗",
};

export function isRpivTodoWidgetRequest(request: {
  method?: string;
  widgetKey?: string;
}): boolean {
  return request?.method === "setWidget" && request.widgetKey === TODO_WIDGET_KEY;
}

export function isRpivTodoCommandNotify(message: string): boolean {
  const text = String(message ?? "");
  return (
    text === "No todos yet. Ask the agent to add some!" ||
    /^\d+\/\d+ completed/m.test(text) ||
    text.includes("── Pending ──") ||
    text.includes("── In Progress ──") ||
    text.includes("── Completed ──")
  );
}

function isRpivTodoTask(value: unknown): value is RpivTodoTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Record<string, unknown>;
  return (
    typeof task.id === "number" &&
    typeof task.subject === "string" &&
    ["pending", "in_progress", "completed", "deleted"].includes(String(task.status))
  );
}

export function isRpivTodoDetails(value: unknown): value is RpivTodoDetails {
  if (!value || typeof value !== "object") return false;
  const details = value as Record<string, unknown>;
  if (!Array.isArray(details.tasks)) return false;
  if (typeof details.nextId !== "number") return false;
  return details.tasks.every(isRpivTodoTask);
}

export function replayRpivTodoFromMessages(
  messages: Array<Record<string, unknown>> = [],
): RpivTodoDetails {
  let state: RpivTodoDetails = EMPTY_STATE;
  for (const message of messages) {
    if (message?.role !== "toolResult") continue;
    if (message.toolName !== TODO_TOOL_NAME) continue;
    if (!isRpivTodoDetails(message.details)) continue;
    state = cloneTodoState(message.details);
  }
  return state;
}

export function cloneTodoState(details: RpivTodoDetails): RpivTodoDetails {
  return {
    tasks: details.tasks.map((task) => ({ ...task })),
    nextId: details.nextId,
  };
}

export function shouldShowIds(tasks: RpivTodoTask[]): boolean {
  return tasks.some((task) => Array.isArray(task.blockedBy) && task.blockedBy.length > 0);
}

export function selectDisplayTasks(tasks: RpivTodoTask[]): RpivTodoTask[] {
  const maxRows = 5;
  const active = tasks.filter((task) => task.status !== "completed");
  const completed = tasks.filter((task) => task.status === "completed");
  return [...active, ...completed].slice(0, maxRows);
}

import type { AutomationWorkspaceStatus } from "./store";

const STATES = new Set(["ready", "uninitialized", "error"]);
const COUNTS = [
  "workflowCount",
  "dueCount",
  "pendingCount",
  "approvalCount",
  "runningCount",
  "blockedCount",
  "failedCount",
] as const;

function isWorkspaceStatus(value: unknown): value is AutomationWorkspaceStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.workspaceId === "string" &&
    item.workspaceId.length > 0 &&
    typeof item.path === "string" &&
    item.path.length > 0 &&
    typeof item.scannedAt === "string" &&
    Number.isFinite(Date.parse(item.scannedAt)) &&
    STATES.has(item.status as string) &&
    STATES.has(item.taskStatus as string) &&
    COUNTS.every((key) => Number.isSafeInteger(item[key]) && (item[key] as number) >= 0) &&
    (item.errorCode == null || typeof item.errorCode === "string") &&
    (item.taskErrorCode == null || typeof item.taskErrorCode === "string")
  );
}

/** Tauri invoke is a runtime boundary even when its TypeScript signature is trusted. */
export function readWorkspaceStatuses(value: unknown): AutomationWorkspaceStatus[] {
  if (!Array.isArray(value) || !value.every(isWorkspaceStatus))
    throw new Error("automation_workspace_status_invalid");
  const ids = new Set(value.map((item) => item.workspaceId));
  if (ids.size !== value.length) throw new Error("automation_workspace_status_invalid");
  return value;
}

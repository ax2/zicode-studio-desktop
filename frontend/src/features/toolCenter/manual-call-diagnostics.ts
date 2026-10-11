export type CallDiagnosticEvent = "preparing" | "handle_issued" | "invoking" | "response_received" | "request_failed" |
  "cancel_requested" | "cancel_acknowledged" | "cancel_unconfirmed" | "status_requested" | "status_verified" |
  "status_unavailable" | "reconciliation_requested" | "reconciliation_verified";
export interface CallDiagnostics {
  schemaVersion: 1; startedAt: number; callId?: string; hostInstanceId?: string;
  events: { at: number; event: CallDiagnosticEvent; code?: string }[];
}
const codes = new Set(["completed", "worker_cancelled", "worker_timeout", "plugin_capability_timeout", "worker_fuel_exhausted",
  "worker_memory_trap", "worker_stack_exhausted", "worker_trapped", "worker_exit_failed", "worker_failed", "worker_protocol_error",
  "worker_cleanup_failed", "result_too_large", "plugin_not_active", "permission_denied", "capability_unavailable", "plugin_disabled",
  "catalog_changed", "capability_changed", "manual_call_invalid", "manual_call_unavailable", "manual_calls_unavailable",
  "manual_call_already_started", "manual_call_busy", "manual_call_budget_exceeded", "manual_call_host_changed",
  "manual_call_not_started", "manual_call_retired"]);
export const diagnosticCode = (code: unknown) => typeof code === "string" && codes.has(code) ? code : "unclassified_error";
export function appendCallDiagnostic(trace: CallDiagnostics, event: CallDiagnosticEvent, code?: unknown): CallDiagnostics {
  return { ...trace, events: [...trace.events, { at: Date.now(), event, ...(code === undefined ? {} : { code: diagnosticCode(code) }) }].slice(-24) };
}
export function manualCallFailureNotice(code: string): string {
  if (code === "worker_timeout") return "The tool request reported an execution timeout. Confirm its status before running again.";
  if (code === "plugin_capability_timeout") return "The connection timed out. The tool may still be running. Check its status before retrying.";
  if (code === "worker_fuel_exhausted") return "The tool request reported a computation limit. Confirm its status before running again.";
  if (code === "worker_memory_trap") return "The tool request reported a memory access error. Confirm its status before running again.";
  if (code === "worker_stack_exhausted") return "The tool request reported a stack limit. Confirm its status before running again.";
  if (["worker_failed", "worker_trapped", "worker_exit_failed", "worker_protocol_error", "worker_cleanup_failed", "result_too_large"].includes(code))
    return "The tool request reported an execution error. Confirm its status before running again.";
  return "Connection interrupted. The tool may still be running. Check its status before retrying.";
}

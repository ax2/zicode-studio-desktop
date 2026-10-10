// Only fixed public codes/messages cross the opaque View boundary.
const CODES = new Set([
  "plugin_disabled",
  "resource_busy",
  "resource_plugin_unavailable",
  "broker_token_invalid",
  "resource_range_invalid",
  "resource_gateway_unavailable",
  "resource_response_invalid",
  "plugin_capability_timeout",
  "worker_fuel_exhausted",
  "worker_memory_trap",
  "worker_stack_exhausted",
  "worker_trapped",
  "worker_exit_failed",
  "worker_timeout",
  "worker_cancelled",
  "worker_failed",
  "worker_cleanup_failed",
  "worker_protocol_error",
  "permission_denied",
  "capability_unavailable",
  "capability_changed",
  "plugin_call_budget_exceeded",
  "plugin_execution_failed",
  "runtime_stopped",
  "invalid_parameters",
  "result_too_large",
  "payload_too_large",
  "resource_worker_busy",
  "resource_confirmation_required",
  "resource_unavailable",
  "resource_authorization_changed",
  "resource_profile_unsupported",
  "resource_output_profile_unsupported",
  "resource_budget_exceeded",
  "invalid_output",
  "resource_execution_failed",
  "resource_request_invalid",
  "resource_view_changed",
  "resource_read_failed",
  "resource_read_invalid",
  "resource_read_limit",
  "resource_read_changed",
]);
const MESSAGES = {
  plugin_disabled: "Plugin is disabled",
  plugin_capability_timeout: "Plugin capability request timed out",
  worker_fuel_exhausted: "Plugin computation budget exhausted",
  worker_memory_trap: "Plugin memory access rejected",
  worker_stack_exhausted: "Plugin stack budget exhausted",
  worker_timeout: "Plugin Worker timed out",
  worker_cancelled: "Plugin Worker cancelled",
  result_too_large: "Plugin result exceeds its declared budget",
  payload_too_large: "Plugin input exceeds its request budget",
  capability_unavailable: "Tool is unavailable or its permission has changed",
  capability_changed: "Plugin changed during execution; reload its tools",
  plugin_call_budget_exceeded: "Too many tools are running; wait and retry",
  plugin_execution_failed: "Plugin execution failed; retry the tool",
};
const LOCAL = new Map([
  ["Plugin is disabled", "plugin_disabled"],
  ["Plugin command is not declared", "plugin_command_not_declared"],
  ["Too many active plugin view requests", "plugin_view_busy"],
  ["Plugin capability identifier is invalid", "plugin_request_invalid"],
  ["Unsupported plugin view request", "plugin_request_unsupported"],
]);
export function publicViewError(error) {
  const message = typeof error === "string" ? error : error?.message;
  const bracket = typeof message === "string" ? /^\[([a-z_]+)\]$/.exec(message)?.[1] : null;
  const candidate = CODES.has(error?.code) ? error.code : bracket;
  if (CODES.has(candidate))
    return { errorCode: candidate, error: MESSAGES[candidate] ?? `[${candidate}]` };
  if (LOCAL.has(message)) return { errorCode: LOCAL.get(message), error: message };
  return { errorCode: "plugin_request_failed", error: "Plugin request failed" };
}

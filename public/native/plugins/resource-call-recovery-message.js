export function resourceCallRecoveryMessage(status, error) {
  if (error?.message === "[resource_call_host_changed]")
    return "Studio restarted. The previous execution cannot be confirmed. Running again remains blocked.";
  if (error) return "Tool status could not be confirmed. Running again remains blocked.";
  if (status.phase === "not_started") return "This call was sealed before execution. Review inputs before starting a new run.";
  if (status.phase === "not_admissible") return "This call can no longer start. Its earlier outcome and result were not recovered. Review inputs before a new run.";
  if (status.executionFinished)
    return "Tool execution has ended. Its result was not recovered. Review inputs before starting a new run.";
  if (status.phase === "active") return "Cancellation requested. The tool is still active; wait and recover again.";
  return "Execution status is unknown. Running again is blocked; no result has been recovered.";
}

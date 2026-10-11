export function resourceCallRecoveryMessage(status, error) {
  if (error?.message === "[resource_call_host_changed]")
    return "Studio restarted. The previous execution cannot be confirmed. Running again remains blocked.";
  if (error) return "Tool status could not be confirmed. Running again remains blocked.";
  if (status.executionFinished)
    return "Tool execution has ended. Its result was not recovered. Review inputs before starting a new run.";
  if (status.phase === "active") return "Tool is still running. Wait or cancel, then check again.";
  return "Execution status is unknown. Running again is blocked; no result has been recovered.";
}

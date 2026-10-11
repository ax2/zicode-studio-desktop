const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PHASES = new Set(["unknown", "cancel_pending", "active", "finished"]);

// No Host message, paths, inputs or result bytes cross this boundary.
export function normalizeResourceCallStatus(value, owner, id, hostInstanceId) {
  if (value?.schemaVersion !== 1 || value.profile !== "resource.call.status.draft1" ||
      value.toolCallId !== id || !UUID.test(value.hostInstanceId ?? "") ||
      (hostInstanceId && value.hostInstanceId !== hostInstanceId) ||
      Object.keys(owner).some(key => value.owner?.[key] !== owner[key]) ||
      !PHASES.has(value.phase) || value.executionFinished !== (value.phase === "finished") ||
      typeof value.cancellationRequested !== "boolean" || value.persistent !== false ||
      value.retentionSeconds !== 60 || value.resultAvailable !== false ||
      (value.phase === "cancel_pending" && !value.cancellationRequested) ||
      (value.phase === "unknown" && value.cancellationRequested)) {
    throw new Error("[resource_response_invalid]");
  }
  return { hostInstanceId: value.hostInstanceId, phase: value.phase,
    executionFinished: value.executionFinished, cancellationRequested: value.cancellationRequested };
}

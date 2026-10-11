export function resourceCallStatus(owner, toolCallId, phase = "unknown") {
  return { schemaVersion: 1, profile: "resource.call.status.draft1", owner, toolCallId,
    hostInstanceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", phase,
    executionFinished: phase === "finished", cancellationRequested: phase === "cancel_pending",
    persistent: false, retentionSeconds: 60, resultAvailable: false };
}

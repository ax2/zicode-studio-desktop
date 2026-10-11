export const hostInstanceId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
export function admission(owner, callId = "resource-call-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa") {
  return { schemaVersion: 1, profile: "resource.call.admission.draft1", owner, callId,
    hostInstanceId, phase: "prepared", expiresInSeconds: 60, persistent: false };
}
export function reconciliation(owner, callId, phase = "active") {
  return { ...admission(owner, callId), phase, executionFinished: phase !== "active",
    admissionClosed: true, resultAvailable: false };
}

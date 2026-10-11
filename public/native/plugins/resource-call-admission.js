const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PROFILE = "resource.call.admission.draft1";
const invalid = () => { throw new Error("[resource_response_invalid]"); };
function identity(value, owner) {
  if (value?.schemaVersion !== 1 || value.profile !== PROFILE || value.persistent !== false ||
      !UUID.test(value.hostInstanceId ?? "") || typeof value.callId !== "string" || !value.callId.startsWith("resource-call-") ||
      !UUID.test(value.callId.slice(14)) || Object.keys(owner).some(key => value.owner?.[key] !== owner[key])) invalid();
}
export function normalizeResourceAdmission(value, owner) {
  identity(value, owner);
  if (value.phase !== "prepared" || value.expiresInSeconds !== 60) invalid();
  return { callId: value.callId, hostInstanceId: value.hostInstanceId };
}
export function normalizeResourceReconciliation(value, owner, ticket) {
  identity(value, owner);
  if (value.callId !== ticket.callId || value.hostInstanceId !== ticket.hostInstanceId ||
      !["active", "ended", "not_started", "not_admissible"].includes(value.phase) ||
      value.executionFinished !== (value.phase !== "active") || value.admissionClosed !== true ||
      value.resultAvailable !== false) invalid();
  return { phase: value.phase, executionFinished: value.executionFinished, hostInstanceId: value.hostInstanceId };
}

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const fail = () => { throw new Error("resource_transfer_response_invalid"); };
export function resourceAccess(owner, resource) {
  return { schemaVersion: 1, owner: { ...owner }, resourceId: resource.resourceId, contentVersion: resource.contentVersion };
}
export function transferGrant(value, source, target, resource, version) {
  if (value?.schemaVersion !== 1 || value.profile !== "resource.transfer.draft1" ||
      !UUID.test(value.grantId ?? "") || value.requiresConfirmation !== true || value.saved !== false ||
      !Number.isInteger(value.expiresInSeconds) || value.expiresInSeconds < 1 || value.expiresInSeconds > 60 ||
      value.source?.pluginId !== source.owner.pluginId || value.source?.capabilityId !== source.owner.capabilityId ||
      value.source?.resourceId !== source.resourceId || value.source?.contentVersion !== source.contentVersion ||
      value.target?.pluginId !== target.pluginId || value.target?.capabilityId !== target.capabilityId ||
      value.target?.pluginVersion !== version || typeof value.target?.pluginName !== "string" ||
      typeof value.target?.toolTitle !== "string" || value.mimeType !== resource.mimeType || value.byteLength !== resource.byteLength) fail();
  return value;
}
export function transferredReference(value, target) {
  if (value?.schemaVersion !== 1 || value.profile !== "resource.transfer.draft1" || value.status !== "committed" ||
      value.saved !== false || typeof value.replayed !== "boolean" || value.reference?.capabilityId !== target.capabilityId ||
      !UUID.test(value.reference?.resourceId ?? "") || !HASH.test(value.reference?.contentVersion ?? "")) fail();
  return resourceAccess(target, value.reference);
}

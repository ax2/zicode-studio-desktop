const HASH = /^[0-9a-f]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const FIELDS = ["schemaVersion", "profile", "saveId", "workspaceId", "relativePath", "mimeType", "byteLength", "contentVersion", "preparedAt"];
const SOURCE_FIELDS = ["pluginId", "capabilityId", "resourceId", "packageVersion"];

// A positive observation of the approved snapshot, never proof of non-execution.
// Uses only the existing read-only library; cannot replay a save transaction.
export async function verifySavedResource({ gateway, expected, sceneId, workspaceId, signal }) {
  const unavailable = () => { throw new Error("saved_resource_unconfirmed"); };
  if (!gateway || !expected || expected.workspaceId !== workspaceId ||
      !Number.isSafeInteger(expected.byteLength) || expected.byteLength < 0 || expected.byteLength > MAX_BYTES ||
      !HASH.test(expected.contentVersion) || signal?.aborted) unavailable();
  const page = await gateway.list(sceneId, workspaceId, { query: expected.saveId, offset: 0, signal });
  if (signal?.aborted || page?.schemaVersion !== 1 || page.profile !== "resource.library.draft1" ||
      page.workspaceId !== workspaceId || page.offset !== 0 || page.pageSize !== 40 || page.payloadsRead !== false ||
      page.hasMore !== false || page.total !== 1 || !Array.isArray(page.items) || page.items.length !== 1) unavailable();
  const item = structuredClone(page.items[0]);
  if (item.integrity !== "not_checked" || !HASH.test(item.receiptVersion) ||
      !FIELDS.every(key => item.receipt?.[key] === expected[key]) ||
      !SOURCE_FIELDS.every(key => typeof expected.source?.[key] === "string" && item.receipt?.source?.[key] === expected.source[key])) unavailable();
  const bytes = await gateway.read(sceneId, workspaceId, item, signal);
  if (signal?.aborted || !(bytes instanceof ArrayBuffer) || bytes.byteLength !== expected.byteLength) unavailable();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map(value => value.toString(16).padStart(2, "0")).join("");
  if (signal?.aborted || digest !== expected.contentVersion) unavailable();
  return item.receipt;
}

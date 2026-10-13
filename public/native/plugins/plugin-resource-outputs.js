// Whitelist Host-produced references before they enter the opaque View or parent preview.
import { outputExtension } from "./plugin-output-formats.js";
const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
export function normalizeResourceOutputs(response, source) {
  const fail = () => { throw new Error("[resource_response_invalid]"); };
  if (response.outputProfile === undefined && response.resources === undefined) return null;
  if (response.outputProfile !== "resource.wasi.output.draft1" || !Array.isArray(response.resources) || response.resources.length > 4) fail();
  const sources = [source, ...(source.additionalResources ?? [])];
  const ids = new Set(sources.map(item => item.resourceId));
  let total = 0;
  return response.resources.map((row, index) => {
    if (!row || row.index !== index || !UUID.test(row.resourceId ?? "") || ids.has(row.resourceId) ||
      !HASH.test(row.contentVersion ?? "") || !outputExtension(row.mimeType) ||
      !Number.isSafeInteger(row.byteLength) || row.byteLength < 0 ||
      !Number.isSafeInteger(row.expiresInSeconds) || row.expiresInSeconds < 1 || row.expiresInSeconds > 900 ||
      row.saved !== false || row.origin !== "worker-output" ||
      row.derivedFrom?.resourceId !== source.resourceId || row.derivedFrom?.contentVersion !== source.contentVersion) fail();
    if (sources.length > 1) {
      if (!Array.isArray(row.derivedFromAll) || row.derivedFromAll.length !== sources.length ||
          row.derivedFromAll.some((item, position) => item?.resourceId !== sources[position].resourceId ||
            item?.contentVersion !== sources[position].contentVersion)) fail();
    } else if (row.derivedFromAll !== undefined) fail();
    total += row.byteLength;
    if (total > 32 * 1024 * 1024) fail();
    ids.add(row.resourceId);
    return { index, resourceId: row.resourceId, contentVersion: row.contentVersion,
      mimeType: row.mimeType, byteLength: row.byteLength, expiresInSeconds: row.expiresInSeconds,
      origin: "worker-output", saved: false,
      derivedFrom: { resourceId: source.resourceId, contentVersion: source.contentVersion },
      ...(sources.length > 1 ? { derivedFromAll: sources.map(item => ({ resourceId: item.resourceId,
        contentVersion: item.contentVersion })) } : {}) };
  });
}

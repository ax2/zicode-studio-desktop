const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const version = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const MAX_ORIGINAL_BYTES = 8 * 1024 * 1024;
const safeName = value => typeof value === "string" && value.length > 0 && value.length <= 255 &&
  !/[\\/:\p{Cc}\u202a-\u202e\u2066-\u2069]/u.test(value);

export async function prepareNativeDigestSelection({ api, owner, isCurrent, minResources, maxResources }) {
  const result = await api.choose(owner);
  if (result === null) return null;
  const files = Array.isArray(result?.files) ? result.files : [];
  if (!isCurrent() || result?.schemaVersion !== 1 || result.profile !== "resource.local-file.native-selection.draft1" ||
      result.contentRead !== false || result.confirmed !== false || !Number.isInteger(result.expiresInSeconds) ||
      result.expiresInSeconds < 1 || result.expiresInSeconds > 120 || Object.keys(owner).some(key => result.owner?.[key] !== owner[key]) ||
      files.length < minResources || files.length > maxResources ||
      files.some(file => !uuid(file?.grantId) || !safeName(file.name) || !Number.isSafeInteger(file.byteLength) || file.byteLength < 0) ||
      new Set(files.map(file => file.grantId)).size !== files.length ||
      files.reduce((sum, file) => sum + file.byteLength, 0) > 32 * 1024 * 1024) {
    for (const file of files.slice(0, maxResources)) if (uuid(file?.grantId)) void api.cancel(owner, file.grantId).catch(() => {});
    throw new Error("project_file_preview_invalid");
  }
  return files.map(file => ({ owner, grantId: file.grantId, name: file.name, byteLength: file.byteLength, native: true }));
}

export async function prepareProjectResource({ api, workspaceId, owner, isCurrent, relativePath: entryPath }) {
  let preview;
  try {
    const relativePath = entryPath ?? await api.choose(workspaceId);
    if (!isCurrent() || relativePath === null) return null;
    if (typeof relativePath !== "string" || !relativePath) throw new Error("project_file_invalid");
    preview = await api.prepare(owner, relativePath);
    if (!isCurrent() || preview?.profile !== "resource.local-file.draft1" || !uuid(preview.grantId)
      || preview.relativePath !== relativePath || !Number.isSafeInteger(preview.byteLength)
      || preview.byteLength < 0 || preview.byteLength > 32 * 1024 * 1024 || preview.contentRead !== false
      || preview.confirmed !== false || Object.keys(owner).some(key => preview.owner?.[key] !== owner[key])) {
      throw new Error("project_file_preview_invalid");
    }
    return { ...preview, owner: { ...owner } };
  } catch (error) {
    if (uuid(preview?.grantId)) await api.cancel(owner, preview.grantId).catch(() => {});
    throw error;
  }
}
export async function confirmProjectResource({ api, preview, gateway, isCurrent }) {
  let access, delivered = false;
  try {
    if (!isCurrent()) throw new Error("resource_selection_changed");
    const result = await api.commit(preview.owner, preview.grantId);
    if (uuid(result?.resourceId) && version(result.contentVersion)) {
      access = { schemaVersion: 1, owner: preview.owner, resourceId: result.resourceId, contentVersion: result.contentVersion };
    }
    if (!access || !isCurrent() || result.confirmed !== true || result.byteLength !== preview.byteLength
      || result.profile !== "resource.local-file.draft1" || result.access?.resourceId !== access.resourceId
      || result.access?.contentVersion !== access.contentVersion
      || (preview.native && result.originalFile && result.originalFile.name !== preview.name)
      || Object.keys(preview.owner).some(key => result.access?.owner?.[key] !== preview.owner[key])) {
      throw new Error("project_file_snapshot_invalid");
    }
    const reference = { capabilityId: preview.owner.capabilityId, resourceId: access.resourceId, contentVersion: access.contentVersion };
    const name = result.originalFile?.name;
    const originalFile = safeName(name) &&
      result.originalFile.byteLength === preview.byteLength && preview.byteLength <= MAX_ORIGINAL_BYTES
      ? { ...reference, originalFile: true, fileName: name, mimeType: "application/octet-stream", byteLength: preview.byteLength } : null;
    delivered = true;
    return { access, reference, ...(originalFile ? { originalFile } : {}) };
  } finally {
    if (access && !delivered) await gateway.revokeResource(access).catch(() => {});
  }
}

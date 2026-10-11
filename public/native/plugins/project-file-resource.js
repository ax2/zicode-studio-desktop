const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
const version = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export async function prepareProjectResource({ api, workspaceId, owner, isCurrent }) {
  let preview;
  try {
    const relativePath = await api.choose(workspaceId);
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
      || Object.keys(preview.owner).some(key => result.access?.owner?.[key] !== preview.owner[key])) {
      throw new Error("project_file_snapshot_invalid");
    }
    delivered = true;
    return { access, reference: { capabilityId: preview.owner.capabilityId, resourceId: access.resourceId, contentVersion: access.contentVersion } };
  } finally {
    if (access && !delivered) await gateway.revokeResource(access).catch(() => {});
  }
}

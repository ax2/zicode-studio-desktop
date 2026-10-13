import { outputExtension } from "./plugin-output-formats.js";

const MAX_BYTES = 32 * 1024 * 1024;
const CHUNK_BYTES = 65536;
let uploadActive = false;

// Invoked only by the trusted parent's explicit confirmation control.
export async function uploadConfirmedResource({
  file,
  owner,
  gateway,
  isCurrent,
  onProgress = () => {},
  catalogRevision,
}) {
  if (uploadActive) throw new Error("resource_upload_busy");
  uploadActive = true;
  const startedAt = Date.now();
  let access;
  let delivered = false;
  const check = () => {
    if (!isCurrent()) throw new Error("resource_selection_changed");
    if (Date.now() - startedAt > 110000) throw new Error("resource_upload_timeout");
  };
  try {
    check();
    if (!Number.isSafeInteger(file?.size) || file.size < 0 || file.size > MAX_BYTES)
      throw new Error("resource_size_invalid");
    const bytes = new Uint8Array(await file.arrayBuffer());
    check();
    if (bytes.length !== file.size) throw new Error("resource_size_invalid");
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    check();
    const contentVersion = Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (file.expectedContentVersion !== undefined && file.expectedContentVersion !== contentVersion)
      throw new Error("saved_output_changed");
    const mimeType = outputExtension(file.type) ? file.type : "application/octet-stream";
    const prepared = await gateway.prepareResource({
      schemaVersion: 1,
      owner,
      mimeType,
      byteLength: bytes.length,
      contentVersion,
      ...(catalogRevision ? { catalogRevision } : {}),
    });
    if (
      typeof prepared?.resourceId !== "string" ||
      !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(prepared.resourceId)
    )
      throw new Error("resource_prepare_invalid");
    access = { schemaVersion: 1, owner, resourceId: prepared.resourceId, contentVersion };
    check();
    for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
      check();
      const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
      let binary = "";
      for (const byte of chunk) binary += String.fromCharCode(byte);
      const result = await gateway.appendResource(access, offset, btoa(binary));
      check();
      if (result?.uploadedBytes !== offset + chunk.length)
        throw new Error("resource_append_invalid");
      onProgress(offset + chunk.length, bytes.length);
    }
    check();
    const result = await gateway.commitResource(access);
    check();
    if (
      result?.confirmed !== true ||
      result.resourceId !== access.resourceId ||
      result.contentVersion !== contentVersion ||
      result.byteLength !== bytes.length
    )
      throw new Error("resource_commit_invalid");
    delivered = true;
    return {
      access,
      reference: {
        capabilityId: owner.capabilityId,
        resourceId: access.resourceId,
        contentVersion,
      },
    };
  } finally {
    try {
      if (access && !delivered) await gateway.revokeResource(access).catch(() => {});
    } finally {
      uploadActive = false;
    }
  }
}

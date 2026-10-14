import { decodeResourceImage } from "./plugin-resource-image.js";
import { isBinaryOutput, isTextOutput } from "./plugin-output-formats.js";
const MAX_PREVIEW = 8 * 1024 * 1024;
const MAX_TEXT = 128 * 1024;
const fail = () => { throw new Error("preview_unavailable"); };
export async function loadResourcePreview({ resource, read, isCurrent }) {
  const limit = isTextOutput(resource.mimeType) ? MAX_TEXT : MAX_PREVIEW;
  if (!Number.isSafeInteger(resource.byteLength) || resource.byteLength < 0 || resource.byteLength > limit) fail();
  const bytes = new Uint8Array(resource.byteLength);
  let offset = 0;
  do {
    if (!isCurrent()) fail();
    const row = await read(offset, Math.min(32768, Math.max(1, bytes.length - offset)));
    if (!isCurrent() || row.offset !== offset || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0 ||
      row.byteLength > 32768 || row.byteLength > bytes.length - offset ||
      row.eof !== (offset + row.byteLength === bytes.length) || (!row.eof && row.byteLength === 0)) fail();
    const data = atob(row.dataBase64);
    if (data.length !== row.byteLength) fail();
    bytes.set(Uint8Array.from(data, (c) => c.charCodeAt(0)), offset);
    offset += row.byteLength;
    if (row.eof) break;
  } while (offset < bytes.length);
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hash !== resource.contentVersion || !isCurrent()) fail();
  if (isTextOutput(resource.mimeType)) return { kind: "text", text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  if (isBinaryOutput(resource.mimeType)) return { kind: "binary", text: [...bytes.subarray(0, 256)].map((b) => b.toString(16).padStart(2, "0")).join(" ") };
  return decodeResourceImage(bytes, resource.mimeType, isCurrent);
}

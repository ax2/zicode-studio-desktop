const MAX_BYTES = 2 * 1024 * 1024, CHUNK = 32768;
const fail = () => { throw new Error("markdown_draft_unavailable"); };

// Read only an already confirmed Host snapshot, never a path or browser File.
export async function loadMarkdownDraft({ resource, read, isCurrent }) {
  if (!/^[0-9a-f]{64}$/.test(resource?.contentVersion ?? "")) fail();
  const chunks = []; let offset = 0;
  do {
    if (!isCurrent()) fail();
    const length = Math.min(CHUNK, Math.max(1, MAX_BYTES - offset));
    const row = await read(offset, length);
    if (!isCurrent() || row.offset !== offset || !Number.isSafeInteger(row.byteLength) ||
        row.byteLength < 0 || row.byteLength > length || typeof row.eof !== "boolean" ||
        (!row.eof && row.byteLength !== length)) fail();
    const binary = atob(row.dataBase64);
    if (binary.length !== row.byteLength || btoa(binary) !== row.dataBase64) fail();
    chunks.push(Uint8Array.from(binary, character => character.charCodeAt(0)));
    offset += row.byteLength;
    if (row.eof) break;
    if (offset >= MAX_BYTES) fail();
  } while (offset < MAX_BYTES);
  const bytes = new Uint8Array(offset); let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
  if (!isCurrent() || hash !== resource.contentVersion) fail();
  // Keep BOMs during decoding, then strip exactly one, matching the native reader.
  let text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.startsWith("\uFEFF")) text = text.slice(1);
  // Confirm authority again after full hashing/decoding, before adopting a copy.
  await read(0, 1);
  if (!isCurrent()) fail();
  return text;
}

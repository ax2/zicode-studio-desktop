const encoder = new TextEncoder(), uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
function compare(a, b) {
  const left = encoder.encode(a.toLowerCase()), right = encoder.encode(b.toLowerCase());
  for (let i = 0; i < Math.min(left.length, right.length); i++) if (left[i] !== right[i]) return left[i] - right[i];
  return left.length - right.length;
}
// The generator must return the shared core's exact sorted SHA256SUMS format.
export async function checksumGeneratedResult(response, files, version) {
  const expected = `${files.map(file => `${file.sha256}  ${file.name}`).sort(compare).join("\n")}\n`, ref = response?.resultRef;
  const bytes = encoder.encode(expected);
  if (response?.result?.contractVersion !== "1.0.0-rc.1" || response.result.ok !== true || response.result.data?.text !== expected ||
      bytes.length > 32768 || ref?.schemaVersion !== 1 || ref.mimeType !== "text/plain" || !uuid.test(ref.resultId ?? "") ||
      ref.byteLength !== bytes.length || ref.packageVersion !== version) throw new Error("invalid_generated_manifest");
  const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
  if (hash !== ref.contentVersion) throw new Error("invalid_generated_manifest");
  return { text: expected, reference: structuredClone(ref) };
}

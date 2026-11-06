// Match Rust str::trim whitespace semantics; BOM is not whitespace here.
const blankLine = line => /^\p{White_Space}*$/u.test(line);
export function checksumReviewManifestWire(manifest) {
  return manifest.split(/\r?\n/u).filter(line => !blankLine(line)).join("\n");
}

// Validate the result against the exact manifest text and the Host-derived hashes.
// No row may invent a filename, comparison value or verdict.
export function checksumReviewResult(response, manifest, files) {
  if (response?.contractVersion !== "1.0.0-rc.1" || response.ok !== true || typeof response.data?.text !== "string" ||
      new TextEncoder().encode(response.data.text).length > 48 * 1024) throw new Error("invalid_manifest_review");
  const report = JSON.parse(response.data.text);
  const entries = manifest.split(/\r?\n/u).filter(line => !blankLine(line)).map(line => {
    if (!/^[0-9a-f]{64}  .+$/iu.test(line)) throw new Error("invalid_manifest_review");
    return { expected: line.slice(0, 64).toLowerCase(), name: line.slice(66) };
  });
  if (report?.schemaVersion !== 1 || !Array.isArray(report.entries) || report.entries.length !== entries.length ||
      entries.length < 1 || entries.length > 64) throw new Error("invalid_manifest_review");
  const hashes = new Map(files.map(file => [file.name.toLowerCase(), file.sha256]));
  return report.entries.map((row, index) => {
    const expected = entries[index], actual = hashes.get(expected.name.toLowerCase());
    const status = actual === undefined ? "not_provided" : actual === expected.expected ? "match" : "mismatch";
    if (!row || Object.keys(row).length !== 3 || row.name !== expected.name || row.expected !== expected.expected || row.status !== status)
      throw new Error("invalid_manifest_review");
    return { ...expected, status };
  });
}

export function checksumReviewFiles(result, names) {
  if (result?.ok !== true || result.schemaVersion !== 2 || result.material !== "file-integrity-report-list" ||
      !Array.isArray(result.files) || result.files.length < 1 || result.files.length > 4 || !Array.isArray(names) || names.length !== result.files.length)
    throw new Error("invalid_manifest_review");
  const files = result.files.map((row, index) => {
    const name = names[index];
    if (row?.index !== index || !/^[0-9a-f]{64}$/u.test(row.sha256 ?? "") || typeof name !== "string" || !name || name.length > 255 ||
        /[\\/:]/u.test(name) || [...name].some(char => { const c = char.codePointAt(0); return c < 32 || (c >= 127 && c <= 159); }))
      throw new Error("invalid_manifest_review");
    return { name, sha256: row.sha256 };
  });
  if (new Set(files.map(file => file.name.toLowerCase())).size !== files.length) throw new Error("invalid_manifest_review");
  return files;
}

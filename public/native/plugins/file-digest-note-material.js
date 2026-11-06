import { fileDigestComparison } from "./file-digest-comparison.js";
import { jsonReportMarkdown } from "./json-report-markdown.js";

// Build a bounded, inert report from validated digest fields only. File names
// have already been reduced to safe display names by the trusted parent.
export function createFileDigestNoteMaterial(value, names, input = {}) {
  const hex = (v, n) => typeof v === "string" && v.length === n && /^[0-9a-f]+$/.test(v);
  if (value?.ok !== true || value.schemaVersion !== 2 || value.material !== "file-integrity-report-list" ||
      !Array.isArray(value.files) || value.files.length < 1 || value.files.length > 4 ||
      !Array.isArray(names) || (names.length !== 0 && names.length !== value.files.length)) throw new Error("file_report_unavailable");
  const unsafe = char => { const code = char.codePointAt(0); return char === "\\" || char === "/" || code < 32 || (code >= 127 && code <= 159) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069); };
  const files = value.files.map((row, index) => {
    const name = names[index] ?? "";
    if (row?.index !== index || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 33554432 ||
        !hex(row.sha256, 64) || !hex(row.sha512, 128) || ![null, true, false].includes(row.matches) ||
        typeof name !== "string" || [...name].length > 255 || [...name].some(unsafe))
      throw new Error("file_report_unavailable");
    return { index, name, bytes: row.bytes, sha256: row.sha256, sha512: row.sha512, matches: row.matches };
  });
  const comparison = fileDigestComparison(input, files);
  const text = JSON.stringify({ schemaVersion: 2, material: "file-integrity-report-list", comparison, files }, null, 2);
  return { title: "File digest report", content: jsonReportMarkdown(text) };
}

// The expected value is captured from the same request that produced the
// result. Reject inconsistent comparisons instead of creating a misleading report.
export function fileDigestComparison(input, files) {
  const expected = input?.expected ?? "";
  if (typeof expected !== "string") throw new Error("file_report_unavailable");
  const value = expected.trim().toLowerCase();
  if (value && !/^(?:[0-9a-f]{64}|[0-9a-f]{128})$/.test(value)) throw new Error("file_report_unavailable");
  const algorithm = value ? (value.length === 64 ? "SHA-256" : "SHA-512") : null;
  for (const file of files) {
    const actual = algorithm === "SHA-256" ? file.sha256 : file.sha512;
    if (file.matches !== (algorithm ? actual === value : null)) throw new Error("file_report_unavailable");
  }
  return algorithm ? { algorithm, expected: value } : null;
}

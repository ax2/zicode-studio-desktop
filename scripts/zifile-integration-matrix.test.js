// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const matrix = JSON.parse(
  readFileSync(new URL("../docs/plugins/zifile-integration-matrix.json", import.meta.url), "utf8"),
);
describe("ZiFile integration scope receipt", () => {
  it("keeps every source format and operation visible with blockers", () => {
    expect(matrix.formats.map((row) => row.format)).toEqual([
      "Zip",
      "SevenZip",
      "Tar",
      "TarGzip",
      "TarZstd",
      "TarXz",
      "TarLzma",
      "TarBzip2",
      "TarLz4",
      "Gzip",
      "Zstandard",
      "Xz",
      "Lzma",
      "Bzip2",
      "Lz4",
      "Brotli",
      "Rar",
      "Cab",
    ]);
    const ids = new Set(matrix.blockers.map((item) => item.id));
    expect(ids.size).toBe(matrix.blockers.length);
    for (const row of matrix.formats) {
      expect(Object.keys(row.operations).sort()).toEqual([
        "create",
        "extract",
        "list",
        "rename",
        "test",
        "update",
      ]);
      for (const operation of Object.values(row.operations)) {
        expect(operation.accepted).toBe(false);
        expect(operation.blockers.length).toBeGreaterThan(0);
        for (const blocker of operation.blockers) expect(ids.has(blocker)).toBe(true);
      }
    }
    expect(matrix.studio.acceptedOperations).toBe(0);
    expect(matrix.studio.nativeWorkerSupported).toBe(false);
  });
  it("preserves provider format limitations and source identity", () => {
    const mutable = new Set([
      "Zip",
      "SevenZip",
      "Tar",
      "TarGzip",
      "TarZstd",
      "TarXz",
      "TarLzma",
      "TarBzip2",
      "TarLz4",
    ]);
    for (const row of matrix.formats) {
      for (const operation of ["update", "rename"]) {
        expect(row.operations[operation].providerDeclared).toBe(mutable.has(row.format));
        expect(row.operations[operation].studioStatus).toBe(
          mutable.has(row.format) ? "blocked" : "provider-unsupported",
        );
      }
    }
    expect(matrix.provider.protocolVersion).toBe(3);
    expect(matrix.provider.evidence).toHaveLength(4);
    for (const file of matrix.provider.evidence) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
});

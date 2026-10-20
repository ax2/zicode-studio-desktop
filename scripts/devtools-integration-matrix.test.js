// @vitest-environment node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const matrix = JSON.parse(
  readFileSync(resolve(root, "docs/plugins/devtools-all-tools-matrix.json"), "utf8"),
);
const snapshotRoot = resolve(root, matrix.catalogSnapshotPath);
const readSnapshot = (name) => readFileSync(resolve(snapshotRoot, name));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const catalog = JSON.parse(readSnapshot("tools.json"));
const migration = JSON.parse(readSnapshot("studio-plugin-migration.json"));

// The historical matrix includes two Trace versions observed after the frozen dev.105 catalog.
// This exception is provenance only; neither tool is accepted in full by Studio.
const historicalVersionExceptions = new Map([
  ["django-trace", { snapshot: "1.0.2", matrix: "1.0.3" }],
  ["java-trace", { snapshot: "1.0.2", matrix: "1.0.3" }],
]);

describe("Zi DevTools integration matrix provenance", () => {
  it("points to its hashed catalog and migration snapshot", () => {
    expect(matrix.catalogSnapshotPath).toBe("docs/plugins/catalog-snapshots/dev.105");
    expect(sha256(readSnapshot("tools.json"))).toBe(matrix.sourceCatalogSha256);
    expect(sha256(readSnapshot("studio-plugin-migration.json"))).toBe(matrix.sourceMigrationSha256);
    expect(catalog.version).toBe(matrix.sourceCatalogVersion);
    expect(migration.sourceCatalogVersion).toBe(matrix.sourceCatalogVersion);
  });

  it("accounts for every source tool, its blockers, and the two historical version exceptions", () => {
    const sourceById = new Map(catalog.tools.map((tool) => [tool.id, tool]));
    const rowsById = new Map(matrix.tools.map((tool) => [tool.sourceToolId, tool]));
    expect(sourceById.size).toBe(catalog.tools.length);
    expect(rowsById.size).toBe(matrix.tools.length);
    expect([...rowsById.keys()].sort()).toEqual([...sourceById.keys()].sort());
    expect(matrix.totalTools).toBe(catalog.tools.length);

    const exceptionsSeen = new Set();
    const statusCounts = {};
    for (const [id, row] of rowsById) {
      const source = sourceById.get(id);
      expect(row.sourceScope, id).toBe(source.scope);
      expect(row.sourceStatus, id).toBe(source.status);
      if (row.sourceToolVersion !== source.tool_version) {
        expect({ snapshot: source.tool_version, matrix: row.sourceToolVersion }, id).toEqual(
          historicalVersionExceptions.get(id),
        );
        exceptionsSeen.add(id);
      }
      for (const field of [
        "integrationStatus",
        "reason",
        "owner",
        "unblockCondition",
        "workaround",
      ]) {
        expect(row[field]?.trim().length, `${id}.${field}`).toBeGreaterThan(0);
      }
      statusCounts[row.integrationStatus] = (statusCounts[row.integrationStatus] ?? 0) + 1;
    }
    expect([...exceptionsSeen].sort()).toEqual([...historicalVersionExceptions.keys()].sort());
    expect(statusCounts).toEqual(matrix.counts);
    expect(matrix.tools.filter((row) => row.acceptedFullTool).length).toBe(
      matrix.fullToolsAccepted,
    );
  });

  it("detects scope and discovery changes without an explicit baseline flag", () => {
    const scratchRoot = resolve(root, ".cache/task-scratch");
    mkdirSync(scratchRoot, { recursive: true });
    const scratch = mkdtempSync(resolve(scratchRoot, "catalog-drift-"));
    const catalogPath = resolve(scratch, "tools.json");
    try {
      const changedCatalog = structuredClone(catalog);
      changedCatalog.tools[0].scope += " (changed)";
      changedCatalog.tools[0].discovery = {
        ...(changedCatalog.tools[0].discovery ?? {}),
        changed: true,
      };
      writeFileSync(catalogPath, JSON.stringify(changedCatalog));
      const result = spawnSync(
        process.execPath,
        [resolve(root, "scripts/compare-provider-catalog.mjs"), catalogPath],
        {
          encoding: "utf8",
        },
      );
      expect(result.status, result.stderr).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.drift).toBe(true);
      expect(
        report.changed.find((row) => row.id === changedCatalog.tools[0].id)?.scopeChanged,
      ).toBe(true);
      expect(report.snapshotComparison.scopeChanged.map((row) => row.id)).toContain(
        changedCatalog.tools[0].id,
      );
      expect(report.snapshotComparison.discoveryChanged.map((row) => row.id)).toContain(
        changedCatalog.tools[0].id,
      );
    } finally {
      unlinkSync(catalogPath);
      rmdirSync(scratch);
    }
  });

  it("does not flag the frozen catalog's two documented later matrix versions as new drift", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/compare-provider-catalog.mjs"),
        resolve(snapshotRoot, "tools.json"),
        "--fail-on-drift",
      ],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.drift).toBe(false);
    expect(report.knownHistoricalVersionDifferences).toEqual(["django-trace", "java-trace"]);
  });
});

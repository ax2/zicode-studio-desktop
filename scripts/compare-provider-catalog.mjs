import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const matrixPath = fileURLToPath(
  new URL("../docs/plugins/devtools-all-tools-matrix.json", import.meta.url),
);
const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const catalogPath = args.shift();
let snapshotPath;
let failOnDrift = false;
while (args.length) {
  const option = args.shift();
  if (option === "--baseline" && !snapshotPath && args.length) snapshotPath = args.shift();
  else if (option === "--fail-on-drift" && !failOnDrift) failOnDrift = true;
  else {
    console.error(
      "Usage: bun scripts/compare-provider-catalog.mjs <versioned-tools.json> [--baseline <frozen-tools.json>] [--fail-on-drift]",
    );
    process.exit(2);
  }
}
if (!catalogPath) {
  console.error(
    "Usage: bun scripts/compare-provider-catalog.mjs <versioned-tools.json> [--baseline <frozen-tools.json>] [--fail-on-drift]",
  );
  process.exit(2);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function readJson(path) {
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes.toString("utf8")), sha256: sha256(bytes) };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function indexedTools(rows, idField, versionField, statusField, label) {
  if (!Array.isArray(rows)) throw new Error(`${label}.tools must be an array`);
  const found = new Map();
  for (const row of rows) {
    const id = row?.[idField];
    const version = row?.[versionField];
    const status = row?.[statusField];
    if (
      typeof id !== "string" ||
      !id.trim() ||
      typeof version !== "string" ||
      !version.trim() ||
      !["implemented", "in-progress", "planned"].includes(status)
    ) {
      throw new Error(`${label} has an invalid tool id, version, or status`);
    }
    if (found.has(id)) throw new Error(`${label} has duplicate tool id: ${id}`);
    found.set(id, { version, status });
  }
  return found;
}

try {
  const source = readJson(catalogPath);
  const matrix = readJson(matrixPath);
  const current = indexedTools(source.value.tools, "id", "tool_version", "status", "catalog");
  const baseline = indexedTools(
    matrix.value.tools,
    "sourceToolId",
    "sourceToolVersion",
    "sourceStatus",
    "matrix",
  );
  if (baseline.size !== matrix.value.totalTools)
    throw new Error("matrix totalTools does not match its rows");

  const added = [...current.keys()].filter((id) => !baseline.has(id)).sort();
  const removed = [...baseline.keys()].filter((id) => !current.has(id)).sort();
  const matrixRows = new Map(matrix.value.tools.map((row) => [row.sourceToolId, row]));
  const sourceRows = new Map(source.value.tools.map((row) => [row.id, row]));
  const changed = [...current.entries()]
    .flatMap(([id, now]) => {
      const before = baseline.get(id);
      const scopeChanged = before && matrixRows.get(id).sourceScope !== sourceRows.get(id).scope;
      return before &&
        (before.version !== now.version || before.status !== now.status || scopeChanged)
        ? [
            {
              id,
              baselineVersion: before.version,
              currentVersion: now.version,
              baselineStatus: before.status,
              currentStatus: now.status,
              scopeChanged,
            },
          ]
        : [];
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const statusCounts = Object.fromEntries(
    ["implemented", "in-progress", "planned"].map((status) => [
      status,
      [...current.values()].filter((row) => row.status === status).length,
    ]),
  );
  const defaultSnapshotPath = resolve(projectRoot, matrix.value.catalogSnapshotPath, "tools.json");
  const comparisonPath = snapshotPath ?? defaultSnapshotPath;
  let snapshotComparison;
  let frozenRows;
  if (comparisonPath) {
    const snapshot = readJson(comparisonPath);
    if (!snapshotPath && snapshot.sha256 !== matrix.value.sourceCatalogSha256) {
      throw new Error("matrix frozen catalog SHA-256 does not match its snapshot");
    }
    if (!snapshotPath) frozenRows = new Map(snapshot.value.tools.map((row) => [row.id, row]));
    const previous = indexedTools(snapshot.value.tools, "id", "tool_version", "status", "snapshot");
    for (const [label, rows] of [
      ["catalog", source.value.tools],
      ["snapshot", snapshot.value.tools],
    ]) {
      for (const row of rows) {
        if (
          typeof row.scope !== "string" ||
          !row.scope.trim() ||
          (row.discovery != null &&
            (typeof row.discovery !== "object" || Array.isArray(row.discovery)))
        ) {
          throw new Error(`${label} has invalid scope or discovery: ${row.id}`);
        }
      }
    }
    const oldRows = new Map(snapshot.value.tools.map((row) => [row.id, row]));
    const newRows = new Map(source.value.tools.map((row) => [row.id, row]));
    const compareField = (field, serialize) =>
      [...newRows.entries()]
        .flatMap(([id, now]) => {
          const before = oldRows.get(id);
          if (!before) return [];
          const oldValue = serialize(before[field] ?? null),
            newValue = serialize(now[field] ?? null);
          return oldValue === newValue
            ? []
            : [{ id, baselineSha256: sha256(oldValue), currentSha256: sha256(newValue) }];
        })
        .sort((a, b) => a.id.localeCompare(b.id));
    const scopeChanged = compareField("scope", (value) => value);
    const discoveryChanged = compareField("discovery", (value) => JSON.stringify(canonical(value)));
    const versionStatusChanged = [...current.entries()]
      .flatMap(([id, now]) => {
        const before = previous.get(id);
        return before && (before.version !== now.version || before.status !== now.status)
          ? [
              {
                id,
                baselineVersion: before.version,
                currentVersion: now.version,
                baselineStatus: before.status,
                currentStatus: now.status,
              },
            ]
          : [];
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    snapshotComparison = {
      snapshotSha256: snapshot.sha256,
      snapshotToolCount: previous.size,
      added: [...current.keys()].filter((id) => !previous.has(id)).sort(),
      removed: [...previous.keys()].filter((id) => !current.has(id)).sort(),
      versionStatusChanged,
      scopeChanged,
      discoveryChanged,
    };
  }
  const knownHistoricalVersionDifferences = changed
    .filter((row) => {
      const frozen = frozenRows?.get(row.id);
      const now = sourceRows.get(row.id);
      return (
        frozen &&
        !row.scopeChanged &&
        row.baselineStatus === row.currentStatus &&
        now.tool_version === frozen.tool_version &&
        now.status === frozen.status &&
        now.scope === frozen.scope
      );
    })
    .map((row) => row.id);
  const matrixDrift =
    added.length + removed.length + changed.length - knownHistoricalVersionDifferences.length > 0;
  const snapshotDrift = snapshotComparison
    ? snapshotComparison.added.length +
        snapshotComparison.removed.length +
        snapshotComparison.versionStatusChanged.length +
        snapshotComparison.scopeChanged.length +
        snapshotComparison.discoveryChanged.length >
      0
    : false;
  const drift = matrixDrift || snapshotDrift;
  console.log(
    JSON.stringify(
      {
        catalogSha256: source.sha256,
        matrixSha256: matrix.sha256,
        baselineToolCount: baseline.size,
        catalogToolCount: current.size,
        statusCounts,
        drift,
        matrixDrift,
        snapshotDrift,
        added,
        removed,
        changed,
        knownHistoricalVersionDifferences,
        ...(snapshotComparison ? { snapshotComparison } : {}),
      },
      null,
      2,
    ),
  );
  if (drift && failOnDrift) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

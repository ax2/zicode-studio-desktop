// Receiver-owned semantic check for a frozen provider catalog revision.
// The generic receipt verifier checks every byte before these claims are read.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDevtoolsPackage } from "./verify-devtools-package.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function requireClaim(condition, code) {
  if (!condition) throw new Error(code);
}
function parse(bytes, code) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(code);
  }
}
function indexed(rows, key, code) {
  requireClaim(Array.isArray(rows), code);
  const entries = new Map();
  for (const row of rows) {
    requireClaim(
      typeof row?.[key] === "string" && row[key].length > 0 && !entries.has(row[key]),
      code,
    );
    entries.set(row[key], row);
  }
  return entries;
}
function sameIds(left, right, code) {
  requireClaim(left.size === right.size && [...left.keys()].every((id) => right.has(id)), code);
}

export function validateCatalogRevision({
  receipt,
  toolBytes,
  migrationBytes,
  mapBytes,
  comparisonBytes,
  copiedReceipts,
}) {
  const tools = parse(toolBytes, "catalog_json_invalid");
  const migration = parse(migrationBytes, "migration_json_invalid");
  const map = parse(mapBytes, "package_map_json_invalid");
  const comparison = parse(comparisonBytes, "catalog_comparison_json_invalid");
  const source = indexed(tools.tools, "id", "catalog_ids_invalid");
  const migrated = indexed(migration.tools, "sourceToolId", "migration_ids_invalid");
  const mapped = indexed(map.tools, "sourceToolId", "package_map_ids_invalid");
  requireClaim(source.size >= 154, "catalog_tool_count_incomplete");
  sameIds(source, migrated, "migration_ids_mismatch");
  sameIds(source, mapped, "package_map_ids_mismatch");
  requireClaim(
    receipt.kind === "ZiDevTools immutable source catalog directory revision" &&
      map.sourceToolCount === source.size &&
      tools.version === receipt.sourceCatalogVersion &&
      migration.sourceCatalogVersion === tools.version &&
      map.sourceCatalogVersion === tools.version,
    "catalog_version_mismatch",
  );
  requireClaim(
    migration.acceptedCapabilities === 0 &&
      map.acceptedCapabilities === 0 &&
      receipt.signatureVerified === false &&
      receipt.runtimeAccepted === false &&
      receipt.fullToolAcceptance === false,
    "catalog_acceptance_overstated",
  );
  for (const [id, tool] of source) {
    const row = mapped.get(id),
      migrationRow = migrated.get(id);
    requireClaim(
      row.sourceVersion === tool.tool_version &&
        row.sourceStatus === tool.status &&
        row.title === tool.name &&
        migrationRow.sourceVersion === tool.tool_version &&
        migrationRow.sourceStatus === tool.status &&
        JSON.stringify(row.candidateCapabilities) ===
          JSON.stringify(migrationRow.candidateCapabilities) &&
        JSON.stringify(row.candidateViewOperations ?? []) ===
          JSON.stringify(migrationRow.candidateViewOperations ?? []),
      "package_map_source_mismatch",
    );
    requireClaim(
      Array.isArray(row.operationScopes) && Array.isArray(migrationRow.operationScopes),
      `catalog_operation_scopes_invalid:${id}`,
    );
    const scopeKey = (scope) =>
      JSON.stringify([
        scope.operationId,
        scope.packageId,
        scope.packageVersion,
        scope.candidateDirectory,
        scope.verificationReceipt ?? null,
      ]);
    const concreteMigrationScopes = migrationRow.operationScopes.filter(
      (scope) => scope.candidateDirectory,
    );
    const mappedScopes = new Set(row.operationScopes.map(scopeKey));
    const migratedScopes = new Set(concreteMigrationScopes.map(scopeKey));
    requireClaim(
      mappedScopes.size === row.operationScopes.length &&
        migratedScopes.size === concreteMigrationScopes.length,
      `catalog_operation_scope_duplicate:${id}`,
    );
    for (const scope of row.operationScopes) {
      requireClaim(
        migratedScopes.has(scopeKey(scope)),
        `package_map_operation_mismatch:${id}:${scope.operationId}`,
      );
    }
    for (const scope of concreteMigrationScopes) {
      requireClaim(
        mappedScopes.has(scopeKey(scope)),
        `migration_operation_unmapped:${id}:${scope.operationId}`,
      );
    }
  }
  requireClaim(
    comparison.catalogSha256 === digest(toolBytes) &&
      comparison.catalogToolCount === source.size &&
      comparison.baselineToolCount >= 154 &&
      comparison.added?.length === 0 &&
      comparison.removed?.length === 0,
    "catalog_comparison_mismatch",
  );
  requireClaim(
    receipt.sourceDirectories?.length === 2 &&
      receipt.sourceDirectories[0].path === "sources/tools.json" &&
      receipt.sourceDirectories[0].sha256 === digest(toolBytes) &&
      receipt.sourceDirectories[0].toolCount === source.size &&
      receipt.sourceDirectories[1].path === "sources/studio-plugin-migration.json" &&
      receipt.sourceDirectories[1].sha256 === digest(migrationBytes) &&
      receipt.sourceDirectories[1].toolCount === source.size &&
      receipt.sourceDirectories[1].acceptedCapabilities === 0,
    "catalog_sources_mismatch",
  );
  const change = receipt.changeSummary;
  const sourceStatusCounts = Object.fromEntries(
    ["implemented", "in-progress", "planned"].map((status) => [
      status,
      [...source.values()].filter((tool) => tool.status === status).length,
    ]),
  );
  requireClaim(
    change?.added === 0 &&
      change.removed === 0 &&
      change.versionStatusChanged === comparison.versionStatusChanged?.length &&
      change.scopeChanged === comparison.scopeChanged?.length &&
      change.discoveryChanged === comparison.discoveryChanged?.length &&
      JSON.stringify(change.statusCounts) === JSON.stringify(comparison.statusCounts) &&
      JSON.stringify(change.statusCounts) === JSON.stringify(sourceStatusCounts),
    "catalog_change_summary_mismatch",
  );
  const revisionSha256 = digest(
    Buffer.concat([
      Buffer.from("zicode-devtools-catalog-revision-v1\0"),
      Buffer.from(
        digest(toolBytes) +
          "\0" +
          digest(migrationBytes) +
          "\0" +
          digest(mapBytes) +
          "\0" +
          digest(comparisonBytes),
      ),
    ]),
  );
  requireClaim(
    receipt.revisionSha256 === revisionSha256 &&
      /^devtools-catalog-\d{4}-\d{2}-\d{2}-[a-f0-9]{16}$/.test(receipt.revisionId) &&
      receipt.revisionId.endsWith(revisionSha256.slice(0, 16)),
    "catalog_revision_digest_mismatch",
  );
  requireClaim(
    Array.isArray(map.packages) &&
      map.packages.length > 0 &&
      JSON.stringify(map.packages) === JSON.stringify(receipt.packages),
    "catalog_packages_mismatch",
  );
  const packageKeys = new Set(),
    candidateToolIds = new Set();
  requireClaim(copiedReceipts.size === map.packages.length, "catalog_package_receipts_extra");
  for (const item of map.packages) {
    const key = `${item.packageId}@${item.packageVersion}`;
    requireClaim(
      !packageKeys.has(key) && Array.isArray(item.sourceToolIds) && item.sourceToolIds.length > 0,
      "catalog_package_identity_invalid",
    );
    packageKeys.add(key);
    const copiedPath = `package-receipts/${item.packageId}-${item.packageVersion}-verification.json`;
    requireClaim(
      copiedReceipts.has(copiedPath) &&
        digest(copiedReceipts.get(copiedPath)) === item.receiptSha256,
      "catalog_package_receipt_mismatch",
    );
    const copied = parse(copiedReceipts.get(copiedPath), "catalog_package_receipt_json_invalid");
    requireClaim(
      Array.isArray(copied.files) &&
        copied.files.length === item.fileCount &&
        copied.files.reduce((total, file) => total + (file.size ?? file.bytes ?? NaN), 0) ===
          item.totalBytes &&
        copied.directoryIndexSha256 === item.directoryIndexSha256,
      "catalog_package_receipt_claim_mismatch",
    );
    for (const id of item.sourceToolIds) {
      const row = mapped.get(id);
      requireClaim(
        row?.operationScopes.some(
          (scope) =>
            scope.packageId === item.packageId &&
            scope.packageVersion === item.packageVersion &&
            scope.candidateDirectory === item.path,
        ),
        "catalog_package_scope_mismatch",
      );
      candidateToolIds.add(id);
    }
  }
  for (const [id, row] of mapped) {
    for (const scope of row.operationScopes) {
      requireClaim(
        map.packages.some(
          (item) =>
            item.packageId === scope.packageId &&
            item.packageVersion === scope.packageVersion &&
            item.path === scope.candidateDirectory &&
            item.sourceToolIds.includes(id),
        ),
        "catalog_scope_package_missing",
      );
    }
  }
  return {
    verified: true,
    revisionId: receipt.revisionId,
    revisionSha256,
    sourceToolCount: source.size,
    candidateToolCount: candidateToolIds.size,
    packageCount: map.packages.length,
    sourceStatusCounts,
    signatureVerified: false,
    runtimeAccepted: false,
    fullToolAcceptance: false,
    readOnly: true,
  };
}

export async function verifyCatalogRevision(directory, receiptPath) {
  const inventory = await verifyDevtoolsPackage(directory, receiptPath);
  requireClaim(inventory.directoryIndex.status === "matched", "catalog_directory_index_unverified");
  const root = resolve(directory);
  const receipt = parse(await readFile(receiptPath), "catalog_receipt_json_invalid");
  requireClaim(basename(root) === receipt.revisionId, "catalog_directory_name_mismatch");
  const [toolBytes, migrationBytes, mapBytes, comparisonBytes] = await Promise.all(
    [
      "sources/tools.json",
      "sources/studio-plugin-migration.json",
      "package-map.json",
      "comparison/frozen-dev105.json",
    ].map((name) => readFile(join(root, name))),
  );
  const copiedReceipts = new Map();
  for (const entry of inventory.files.filter((file) => file.path.startsWith("package-receipts/"))) {
    copiedReceipts.set(entry.path, await readFile(join(root, entry.path)));
  }
  return {
    ...validateCatalogRevision({
      receipt,
      toolBytes,
      migrationBytes,
      mapBytes,
      comparisonBytes,
      copiedReceipts,
    }),
    fileCount: inventory.fileCount,
    logicalBytes: inventory.logicalBytes,
    directoryIndex: inventory.directoryIndex,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4)
      throw new Error("usage: verify-devtools-catalog-revision <directory> <external-receipt>");
    console.log(
      JSON.stringify(await verifyCatalogRevision(process.argv[2], process.argv[3]), null, 2),
    );
  } catch (error) {
    console.error(JSON.stringify({ verified: false, code: error.message }));
    process.exitCode = 1;
  }
}

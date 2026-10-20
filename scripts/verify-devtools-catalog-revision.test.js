// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  validateCatalogRevision,
  verifyCatalogRevision,
} from "./verify-devtools-catalog-revision.mjs";

const directory = resolve("tests/fixtures/devtools-catalog-2026-10-18-3c7c5aa8ad679a14");
const receiptPath = `${directory}-verification.json`;

function claims() {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const toolBytes = readFileSync(join(directory, "sources/tools.json"));
  const migrationBytes = readFileSync(join(directory, "sources/studio-plugin-migration.json"));
  const mapBytes = readFileSync(join(directory, "package-map.json"));
  const comparisonBytes = readFileSync(join(directory, "comparison/frozen-dev105.json"));
  const copiedReceipts = new Map(
    receipt.files
      .filter((row) => row.path.startsWith("package-receipts/"))
      .map((row) => [row.path, readFileSync(join(directory, row.path))]),
  );
  return { receipt, toolBytes, migrationBytes, mapBytes, comparisonBytes, copiedReceipts };
}

it("independently verifies the frozen 154-tool revision without accepting unsigned tools", async () => {
  expect(await verifyCatalogRevision(directory, receiptPath)).toMatchObject({
    verified: true,
    fileCount: 11,
    sourceToolCount: 154,
    candidateToolCount: 31,
    packageCount: 6,
    signatureVerified: false,
    runtimeAccepted: false,
    fullToolAcceptance: false,
    directoryIndex: { status: "matched" },
  });
});

it("rejects a catalog ID that does not bind the exact source, comparison and package map bytes", () => {
  const input = claims();
  input.receipt.revisionSha256 = "0".repeat(64);
  expect(() => validateCatalogRevision(input)).toThrow("catalog_revision_digest_mismatch");
});

it("rejects a package map that changes a source tool's version", () => {
  const input = claims();
  const map = JSON.parse(input.mapBytes.toString("utf8"));
  map.tools[0].sourceVersion = "999.0.0";
  input.mapBytes = Buffer.from(JSON.stringify(map));
  expect(() => validateCatalogRevision(input)).toThrow("package_map_source_mismatch");
});

it("rejects a mapped operation whose receipt differs from the migration source", () => {
  const input = claims();
  const map = JSON.parse(input.mapBytes.toString("utf8"));
  const tool = map.tools.find((row) => row.operationScopes.length > 0);
  tool.operationScopes[0].verificationReceipt = "release/another-receipt.json";
  input.mapBytes = Buffer.from(JSON.stringify(map));
  expect(() => validateCatalogRevision(input)).toThrow(
    `package_map_operation_mismatch:${tool.sourceToolId}:${tool.operationScopes[0].operationId}`,
  );
});

it("rejects a migration operation missing from the package map", () => {
  const input = claims();
  const map = JSON.parse(input.mapBytes.toString("utf8"));
  const tool = map.tools.find((row) => row.operationScopes.length > 0);
  const [removed] = tool.operationScopes.splice(0, 1);
  input.mapBytes = Buffer.from(JSON.stringify(map));
  expect(() => validateCatalogRevision(input)).toThrow(
    `migration_operation_unmapped:${tool.sourceToolId}:${removed.operationId}`,
  );
});

it("rejects duplicate operation claims in a source row", () => {
  const input = claims();
  const map = JSON.parse(input.mapBytes.toString("utf8"));
  const tool = map.tools.find((row) => row.operationScopes.length > 0);
  tool.operationScopes.push({ ...tool.operationScopes[0] });
  input.mapBytes = Buffer.from(JSON.stringify(map));
  expect(() => validateCatalogRevision(input)).toThrow(
    `catalog_operation_scope_duplicate:${tool.sourceToolId}`,
  );
});

it("rejects a copied package receipt whose bytes do not match the revision claim", () => {
  const input = claims();
  const [name] = input.copiedReceipts.keys();
  input.copiedReceipts.set(name, Buffer.from("{}"));
  expect(() => validateCatalogRevision(input)).toThrow("catalog_package_receipt_mismatch");
});

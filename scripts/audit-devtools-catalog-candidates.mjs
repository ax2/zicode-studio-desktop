// Read-only Studio intake audit. Provider root is an explicit input, never a runtime dependency.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  invalidPluginProfiles,
  missingPluginProfiles,
  unusedPluginProfiles,
} from "./check-plugin-manifest-profiles.mjs";
import { verifyCatalogRevision } from "./verify-devtools-catalog-revision.mjs";
import { verifyDevtoolsPackage } from "./verify-devtools-package.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const revisionId = "devtools-catalog-2026-10-18-3c7c5aa8ad679a14";
const fixture = resolve(root, "tests/fixtures", revisionId);
const receipt = resolve(root, "tests/fixtures", `${revisionId}-verification.json`);
const packageReceipt = (catalogDirectory, entry) =>
  resolve(
    catalogDirectory,
    "package-receipts",
    `${entry.packageId}-${entry.packageVersion}-verification.json`,
  );

function providerPath(providerRoot, relative) {
  if (
    typeof relative !== "string" ||
    !relative.startsWith("release/") ||
    relative.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error("provider_candidate_path_invalid");
  }
  const path = resolve(providerRoot, ...relative.split("/"));
  if (!path.startsWith(`${providerRoot}${sep}`)) throw new Error("provider_candidate_path_escape");
  return path;
}

export async function auditCandidates(
  providerRoot,
  catalogDirectory = fixture,
  catalogReceipt = receipt,
) {
  const provider = resolve(providerRoot);
  const catalogRoot = resolve(catalogDirectory);
  const catalog = await verifyCatalogRevision(catalogRoot, resolve(catalogReceipt));
  const map = JSON.parse(await readFile(resolve(catalogRoot, "package-map.json"), "utf8"));
  const packages = [];
  for (const entry of map.packages) {
    if (
      !/^[a-z0-9][a-z0-9.-]*$/.test(entry.packageId) ||
      !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-z0-9.-]+)?$/.test(entry.packageVersion)
    ) {
      throw new Error("provider_package_identity_invalid");
    }
    const directory = providerPath(provider, entry.path);
    const providerReceiptSha256 = createHash("sha256")
      .update(await readFile(providerPath(provider, entry.receiptPath)))
      .digest("hex");
    if (providerReceiptSha256 !== entry.receiptSha256) {
      throw new Error(`provider_candidate_receipt_mismatch:${entry.packageId}`);
    }
    const inventory = await verifyDevtoolsPackage(directory, packageReceipt(catalogRoot, entry));
    const manifest = JSON.parse(await readFile(resolve(directory, "plugin.json"), "utf8"));
    const manifestPreflightIssues = [
      ...missingPluginProfiles(manifest),
      ...unusedPluginProfiles(manifest),
      ...invalidPluginProfiles(manifest),
    ];
    const capabilities = manifest.contributes?.capabilities ?? [];
    const views = manifest.contributes?.views ?? [];
    const piTools = manifest.contributes?.piTools ?? [];
    const declared = new Set(capabilities.map((item) => item.id));
    const declaredViews = new Set(views.map((item) => item.id));
    const operations = map.tools.flatMap((tool) =>
      (tool.operationScopes ?? [])
        .filter(
          (scope) =>
            scope.packageId === entry.packageId && scope.packageVersion === entry.packageVersion,
        )
        .map((scope) => ({
          id: scope.operationId,
          candidateCapabilities: tool.candidateCapabilities,
          candidateViewOperations: tool.candidateViewOperations ?? [],
          executionSurface: scope.executionSurface ?? "capability",
          viewId: scope.viewId,
          verificationReceipt: scope.verificationReceipt,
        })),
    );
    const receiptReferencesMissing = operations.filter(
      (operation) => !operation.verificationReceipt,
    ).length;
    const receiptReferencesMismatched = operations.filter(
      (operation) =>
        operation.verificationReceipt && operation.verificationReceipt !== entry.receiptPath,
    );
    const namespace = entry.packageId.replace(/^com\.zicode\./, "");
    const qualifiedOperations = operations.map((operation) => {
      if (operation.executionSurface === "view") {
        return {
          id: operation.id,
          kind:
            operation.candidateViewOperations.includes(operation.id) &&
            declaredViews.has(operation.viewId)
              ? "view"
              : "unresolved",
        };
      }
      if (operation.executionSurface !== "capability") {
        return { id: operation.id, kind: "unresolved" };
      }
      const direct = operation.id;
      const qualified = `${namespace}.${operation.id}`;
      if (declared.has(direct) && operation.candidateCapabilities.includes(direct))
        return { id: direct, kind: "direct" };
      if (declared.has(qualified) && operation.candidateCapabilities.includes(qualified))
        return { id: qualified, kind: "qualified" };
      return { id: operation.id, kind: "unresolved" };
    });
    const mappedCapabilities = new Set(
      qualifiedOperations.filter((item) => item.kind !== "view").map((item) => item.id),
    );
    const mappedViewOperations = operations
      .filter((item) => item.executionSurface === "view")
      .map((item) => item.id);
    const unscopedCapabilities = [...declared].filter((id) => !mappedCapabilities.has(id));
    const unresolvedOperations = [
      ...new Set(
        qualifiedOperations.filter((item) => item.kind === "unresolved").map((item) => item.id),
      ),
    ];
    const missingPiDefinitions = [
      ...new Set(piTools.map((item) => item.capability).filter((id) => !declared.has(id))),
    ];
    const piToolNames = piTools.map((item) => item.name);
    if (
      manifest.id !== entry.packageId ||
      manifest.version !== entry.packageVersion ||
      inventory.fileCount !== entry.fileCount ||
      inventory.logicalBytes !== entry.totalBytes ||
      declared.size !== capabilities.length ||
      declaredViews.size !== views.length ||
      unscopedCapabilities.length ||
      unresolvedOperations.length ||
      JSON.stringify([...mappedViewOperations].sort()) !==
        JSON.stringify([...(entry.viewOperations ?? [])].sort()) ||
      missingPiDefinitions.length ||
      piToolNames.some((name) => typeof name !== "string" || !name) ||
      new Set(piToolNames).size !== piToolNames.length ||
      receiptReferencesMismatched.length
    ) {
      throw new Error(`provider_candidate_contract_mismatch:${entry.packageId}`);
    }
    packages.push({
      packageId: entry.packageId,
      packageVersion: entry.packageVersion,
      identityMatched: manifest.id === entry.packageId && manifest.version === entry.packageVersion,
      fileInventoryMatched:
        inventory.fileCount === entry.fileCount && inventory.logicalBytes === entry.totalBytes,
      directoryIndex: inventory.directoryIndex.status,
      sourceToolCount: entry.sourceToolIds.length,
      mappedOperations: operations.length,
      capabilityOperations: operations.length - mappedViewOperations.length,
      viewOperations: mappedViewOperations.length,
      shortOperationIdsBoundToCandidateCapabilities: qualifiedOperations.filter(
        (item) => item.kind === "qualified",
      ).length,
      manifestCapabilities: capabilities.length,
      piTools: piTools.length,
      directoryMetadata: capabilities.filter((item) => item.directory?.categoryId).length,
      directoryProfileDeclared: Boolean(manifest.requiredProfiles?.["tool.directory.v1"]),
      operationsWithoutReceiptReference: receiptReferencesMissing,
      unresolvedOperations,
      unscopedCapabilities,
      missingPiDefinitions,
      manifestPreflightIssues,
    });
  }
  return {
    readOnly: true,
    revisionId: catalog.revisionId,
    sourceToolCount: catalog.sourceToolCount,
    packageCount: packages.length,
    packages,
    readyForFullAcceptance: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const selectedCatalog =
    process.argv.length === 8 &&
    process.argv[4] === "--catalog-directory" &&
    process.argv[6] === "--catalog-receipt";
  if ((process.argv.length !== 4 && !selectedCatalog) || process.argv[2] !== "--provider-root") {
    console.error(
      "usage: node scripts/audit-devtools-catalog-candidates.mjs --provider-root <directory> [--catalog-directory <directory> --catalog-receipt <file>]",
    );
    process.exitCode = 2;
  } else {
    auditCandidates(process.argv[3], process.argv[5], process.argv[7])
      .then((result) => console.log(JSON.stringify(result, null, 2)))
      .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
      });
  }
}

// Read-only, repository-local intake of the 154-source-tool DevTools catalog.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCatalogRevision } from "./verify-devtools-catalog-revision.mjs";
import { verifyDevtoolsPackage } from "./verify-devtools-package.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = join(root, "tests/fixtures");
const revisionId = "devtools-catalog-2026-10-18-ba45d264d48bf094";
const previousBundle = join(fixtures,
  "devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle");
const localNew = new Map([
  ["com.zicode.devtools.agent-assist", join(fixtures,
    "devtools-view-operation-2026-10-18/agent-assist-preview-0.1.3-candidate-01")],
  ["com.zicode.devtools.image", join(fixtures, "devtools-image-resize-candidate-020")],
  ["com.zicode.devtools.spring-actuator", join(fixtures,
    "devtools-view-operation-2026-10-18/spring-actuator-0.1.3-candidate-01")],
]);

function sameIds(actual, expected) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export async function verifyLocalBa45Bundle() {
  const directory = join(fixtures, revisionId);
  const catalog = await verifyCatalogRevision(directory,
    join(fixtures, `${revisionId}-verification.json`));
  if (
    catalog.revisionSha256 !== "ba45d264d48bf09436b0e08dfa8f7bbb59eff96090a0c01d17061b2cf75391f7" ||
    catalog.sourceToolCount !== 154 || catalog.candidateToolCount !== 34 ||
    catalog.packageCount !== 10 || catalog.directoryIndex.status !== "matched"
  ) throw new Error("devtools_catalog_revision_unexpected");
  const map = JSON.parse(await readFile(join(directory, "package-map.json"), "utf8"));
  let capabilities = 0;
  let viewOperations = 0;
  for (const entry of map.packages) {
    const packageDirectory = localNew.get(entry.packageId) ??
      resolve(previousBundle, ...entry.path.split("/"));
    const packageReceipt = join(directory, "package-receipts",
      `${entry.packageId}-${entry.packageVersion}-verification.json`);
    const inventory = await verifyDevtoolsPackage(packageDirectory, packageReceipt);
    const manifest = JSON.parse(await readFile(join(packageDirectory, "plugin.json"), "utf8"));
    if (
      inventory.fileCount !== entry.fileCount ||
      inventory.logicalBytes !== entry.totalBytes ||
      inventory.directoryIndex.status !== "matched" ||
      inventory.directoryIndex.sha256 !== entry.directoryIndexSha256 ||
      manifest.id !== entry.packageId || manifest.version !== entry.packageVersion ||
      !sameIds((manifest.contributes?.capabilities ?? []).map((item) => item.id),
        entry.capabilities) ||
      !sameIds((manifest.contributes?.viewOperations ?? []).map((item) => item.id),
        entry.viewOperations ?? [])
    ) throw new Error(`devtools_local_package_mismatch:${entry.packageId}`);
    capabilities += entry.capabilities.length;
    viewOperations += (entry.viewOperations ?? []).length;
  }
  if (capabilities !== 55 || viewOperations !== 6)
    throw new Error("devtools_operation_count_mismatch");
  return {
    verified: true,
    revisionId,
    sourceToolCount: 154,
    candidateToolCount: 34,
    packageCount: 10,
    capabilityOperations: capabilities,
    viewOperations,
    signatureVerified: false,
    runtimeAccepted: false,
    fullToolAcceptance: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await verifyLocalBa45Bundle()));
  } catch (error) {
    console.error(JSON.stringify({ verified: false, code: error.message }));
    process.exitCode = 1;
  }
}

// Read-only preflight for frozen View candidates. Receipt matches are not runtime acceptance.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDevtoolsPackage } from "./verify-devtools-package.mjs";

const fixture = resolve(fileURLToPath(new URL("../tests/fixtures/devtools-view-operation-2026-10-18/", import.meta.url)));
const candidates = [
  {
    folder: "agent-assist-preview-0.1.3-candidate-01",
    pluginId: "com.zicode.devtools.agent-assist",
    index: "9b7e7dee63fbdad60b178d597754c05dfd587a824874ae33282352b3ef010c63",
    files: 13,
    bytes: 79409,
    operations: 2,
  },
  {
    folder: "spring-actuator-0.1.3-candidate-01",
    pluginId: "com.zicode.devtools.spring-actuator",
    index: "74f6bab2ed7c9ddbee2857aeac7cf4d875eda642900afbb0fb4fec31102f97cc",
    files: 49,
    bytes: 246194,
    operations: 4,
  },
];

export async function verifyFrozenViewCandidates(root = fixture) {
  const results = [];
  for (const expected of candidates) {
    const directory = join(root, expected.folder);
    const receipt = join(root, `${expected.folder}-verification.json`);
    const inventory = await verifyDevtoolsPackage(directory, receipt);
    if (
      inventory.fileCount !== expected.files ||
      inventory.logicalBytes !== expected.bytes ||
      inventory.directoryIndex.status !== "matched" ||
      inventory.directoryIndex.sha256 !== expected.index
    ) {
      throw new Error(`view_candidate_receipt_mismatch:${expected.folder}`);
    }
    const manifest = JSON.parse(await readFile(join(directory, "plugin.json"), "utf8"));
    if (
      manifest.id !== expected.pluginId ||
      manifest.version !== "0.1.3" ||
      manifest.requiredProfiles?.["view.operation.directory.v1"] !== "=1.0.0-preview.1" ||
      manifest.contributes?.viewOperations?.length !== expected.operations ||
      manifest.contributes?.capabilities?.length !== 0
    ) {
      throw new Error(`view_candidate_manifest_mismatch:${expected.folder}`);
    }
    results.push({
      pluginId: expected.pluginId,
      fileCount: inventory.fileCount,
      logicalBytes: inventory.logicalBytes,
      directoryIndexSha256: inventory.directoryIndex.sha256,
      viewOperationCount: expected.operations,
      signatureVerified: false,
      runtimeAccepted: false,
    });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ verified: true, candidates: await verifyFrozenViewCandidates() }));
  } catch (error) {
    console.error(JSON.stringify({ verified: false, code: error.message }));
    process.exitCode = 1;
  }
}

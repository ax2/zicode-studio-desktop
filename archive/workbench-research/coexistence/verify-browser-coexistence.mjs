import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { evaluateCoexistence } from "./browser-coexistence-metrics.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));

function verifyAssets(root, id, loaded, inventory) {
  const library = join(root, `profile-${id}`, "data", "visual-assets");
  const database = new Database(join(library, "catalog.sqlite"), { readonly: true });
  try {
    const assets = database
      .query("select a.name, r.digest from asset a join revision r on r.asset=a.id and r.version=1")
      .all();
    assert.equal(assets.length, loaded ? 16 : 0, `${id}: catalog asset count`);
    assert.equal(
      new Set(assets.map((asset) => asset.digest)).size,
      assets.length,
      `${id}: duplicate workload`,
    );
    assert.equal(
      readdirSync(library).filter((name) => name.endsWith(".blob")).length,
      assets.length,
      `${id}: blob count`,
    );
    for (const asset of assets) {
      const expected = inventory.items.find((item) => item.name === asset.name);
      assert(expected && expected.sha256 === asset.digest, `${id}: catalog/source mismatch`);
      assert.equal(
        hash(readFileSync(join(library, `${asset.digest}.blob`))),
        expected.sha256,
        `${id}: managed bytes changed`,
      );
      const preview = readFileSync(join(library, `${asset.digest}.png`));
      assert(
        preview.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        `${id}: PNG signature`,
      );
      assert(
        preview.length <= 512 * 1024 &&
          preview.readUInt32BE(16) > 0 &&
          preview.readUInt32BE(16) <= 256 &&
          preview.readUInt32BE(20) > 0 &&
          preview.readUInt32BE(20) <= 256,
        `${id}: preview bounds`,
      );
    }
    return { id, assets: assets.length, originalAndManagedBytesVerified: true };
  } finally {
    database.close();
  }
}

try {
  const [argument, ...extra] = Bun.argv.slice(2);
  assert(
    argument && extra.length === 0,
    "Usage: bun docs/visual-assets/verify-browser-coexistence.mjs <manifest.json>",
  );
  const manifest = json(resolve(argument));
  const root = resolve(dirname(resolve(argument)), manifest.evidenceDirectory);
  const policyPath = join(import.meta.dirname, "browser-coexistence-gates.json");
  const policy = json(policyPath);
  const policySha256 = hash(readFileSync(policyPath));
  assert.equal(
    manifest.policySha256,
    policySha256,
    "gate policy changed; review before accepting evidence",
  );
  assert.equal(
    hash(readFileSync(join(root, "samples.json"))),
    policy.workloadIndexSha256,
    "workload index changed",
  );
  const inventory = json(join(root, "samples.json"));
  const runs = {};
  for (const pair of manifest.pairs) {
    for (const id of [pair.baseline, pair.loaded]) {
      assert(/^[ab][1-9][0-9]*$/.test(id), "invalid run ID");
      const launch = json(join(root, `${id}-launch.json`));
      assert.equal(
        resolve(launch.profile),
        join(root, `profile-${id}`),
        "profile outside evidence directory",
      );
      runs[id] = {
        launch,
        result: json(join(root, `${id}-result.json`)),
        window: json(join(root, `${id}-window-state.json`)),
        resources: readdirSync(root)
          .filter((name) => name.startsWith(`${id}-resource-`) && name.endsWith(".json"))
          .map((name) => json(join(root, name))),
      };
    }
  }
  assert(/^[a-z0-9-]+\.json$/.test(manifest.machineFile), "invalid machine receipt filename");
  const metrics = evaluateCoexistence(policy, manifest, {
    inventory,
    runs,
    machine: json(join(root, manifest.machineFile)),
  });
  for (const item of inventory.items) {
    assert.equal(item.name, item.name.split(/[\\/]/).at(-1), "invalid sample filename");
    const original = readFileSync(join(root, "samples", item.name));
    assert.equal(original.length, item.bytes, "original byte count changed");
    assert.equal(hash(original), item.sha256, "original bytes changed");
  }
  const assets = manifest.pairs.flatMap((pair) => [
    verifyAssets(root, pair.baseline, false, inventory),
    verifyAssets(root, pair.loaded, true, inventory),
  ]);
  console.log(
    JSON.stringify(
      {
        ...metrics,
        policySha256,
        assets,
        renderedReviewRequired: true,
        fullIssueAcceptance: false,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(JSON.stringify({ metricsPassed: false, error: error.message }));
  process.exitCode = 1;
}

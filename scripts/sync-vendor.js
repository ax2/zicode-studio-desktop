import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeBuildOutput } from "./write-build-output.cjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  {
    source: resolve(root, "node_modules/chart.js/dist/chart.umd.js"),
    destination: resolve(root, "public/vendor/chart.umd.js"),
  },
];

for (const asset of assets) {
  mkdirSync(dirname(asset.destination), { recursive: true });
  writeBuildOutput(asset.destination, readFileSync(asset.source));
  console.log(
    `[sync-vendor] ${asset.source.slice(root.length + 1)} -> ${asset.destination.slice(root.length + 1)}`,
  );
}

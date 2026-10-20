import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const piVersion = JSON.parse(readFileSync(join(root, "scripts/pi-version.json"), "utf8")).version;
const dependencies = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).devDependencies;
const sdkPackages = ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"];
const mismatches = sdkPackages.filter((name) => dependencies?.[name] !== piVersion);

if (!/^\d+\.\d+\.\d+$/.test(piVersion) || mismatches.length > 0) {
  console.error(`[pi-sdk] Embedded Pi and extension SDK versions differ: pi=${piVersion}, ${sdkPackages.map((name) => `${name}=${dependencies?.[name] ?? "missing"}`).join(", ")}`);
  console.error(`[pi-sdk] Align with: bun add -d -E ${sdkPackages.map((name) => `${name}@${piVersion}`).join(" ")}`);
  process.exitCode = 1;
} else {
  console.log(`[pi-sdk] Embedded Pi and extension SDK versions match: ${piVersion}`);
}

#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { withCargoBin } = require("./cargo-path");

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--local")) {
  console.error("Usage: build-desktop.js [--local]");
  process.exit(1);
}
const local = args.includes("--local");

const bundlesByPlatform = {
  win32: "nsis",
  darwin: "dmg",
  linux: "appimage,deb",
};

const bundles = bundlesByPlatform[process.platform];
if (!bundles) {
  console.error(`[build-desktop] Unsupported platform: ${process.platform}`);
  process.exit(1);
}

const env = withCargoBin();

console.log(
  local
    ? "[build-desktop] Building reusable local debug output"
    : `[build-desktop] Building ${process.platform} bundles: ${bundles}`,
);
const buildArgs = local ? ["--debug", "--no-bundle"] : ["--bundles", bundles];
const result = spawnSync(process.execPath, ["run", "tauri", "build", ...buildArgs], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`[build-desktop] Failed to start Tauri: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

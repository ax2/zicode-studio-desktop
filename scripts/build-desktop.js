#!/usr/bin/env node

const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

const env = { ...process.env };
if (process.platform !== "win32" && env.HOME) {
  const cargoBin = path.join(env.HOME, ".cargo", "bin");
  env.PATH = [cargoBin, env.PATH].filter(Boolean).join(path.delimiter);
}

console.log(`[build-desktop] Building ${process.platform} bundles: ${bundles}`);
const result = spawnSync(
  process.execPath,
  ["run", "tauri", "build", "--bundles", bundles],
  {
    cwd: path.resolve(__dirname, ".."),
    env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  console.error(`[build-desktop] Failed to start Tauri: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

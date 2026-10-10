#!/usr/bin/env bun

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { withCargoBin } = require("./cargo-path");

const env = withCargoBin();

const result = spawnSync(process.execPath, ["run", "tauri", "dev"], {
  cwd: path.resolve(__dirname, ".."),
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`[dev-desktop] Failed to start Tauri: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

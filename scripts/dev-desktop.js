#!/usr/bin/env bun

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { withCargoBin } = require("./cargo-path");

const env = withCargoBin();
const root = path.resolve(__dirname, "..");
if (process.platform === "win32") {
  const shell = spawnSync("cargo", ["build", "--manifest-path", path.join(root, "shell", "Cargo.toml"), "--target-dir", path.join(root, "target")], {
    cwd: root, env, stdio: "inherit", windowsHide: true,
  });
  if (shell.error || shell.status !== 0) {
    console.error(`[dev-desktop] Explorer selection bridge failed: ${shell.error?.message ?? shell.status}`);
    process.exit(1);
  }
}

const result = spawnSync(process.execPath, ["run", "tauri", "dev"], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`[dev-desktop] Failed to start Tauri: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

#!/usr/bin/env bun

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { withCargoBin } = require("./cargo-path");

const env = withCargoBin();
const root = path.resolve(__dirname, "..");
const forwardedArgs = process.argv.slice(2);
const appArgumentMarker = forwardedArgs.indexOf("--app");
const tauriArgs = appArgumentMarker === -1 ? forwardedArgs : forwardedArgs.slice(0, appArgumentMarker);
const appArgs = appArgumentMarker === -1 ? [] : forwardedArgs.slice(appArgumentMarker + 1);
if (appArgumentMarker !== -1 && appArgs.length === 0) {
  console.error("[dev-desktop] --app requires at least one application argument");
  process.exit(2);
}
if (process.platform === "win32") {
  const shell = spawnSync("cargo", ["build", "--manifest-path", path.join(root, "shell", "Cargo.toml"), "--target-dir", env.CARGO_TARGET_DIR], {
    cwd: root, env, stdio: "inherit", windowsHide: true,
  });
  if (shell.error || shell.status !== 0) {
    console.error(`[dev-desktop] Explorer selection bridge failed: ${shell.error?.message ?? shell.status}`);
    process.exit(1);
  }
}

const command = ["run", "tauri", "dev", ...tauriArgs];
if (appArgs.length) command.push("--", "--", ...appArgs);
const result = spawnSync(process.execPath, command, {
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

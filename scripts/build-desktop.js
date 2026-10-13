#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
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
const root = path.resolve(__dirname, "..");

if (process.platform === "win32") {
  const profile = local ? "debug" : "release";
  const shellArgs = ["build", "--manifest-path", path.join(root, "shell", "Cargo.toml"), "--target-dir", path.join(root, "target")];
  if (!local) shellArgs.push("--release");
  const shell = spawnSync("cargo", shellArgs, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (shell.error || shell.status !== 0) {
    console.error(`[build-desktop] Explorer selection bridge failed: ${shell.error?.message ?? shell.status}`);
    process.exit(1);
  }
  const output = path.join(root, "target", profile, "zicode_studio_shell.dll");
  const staged = path.join(root, "src-tauri", "resources", "shell", "zicode_studio_shell.dll");
  fs.mkdirSync(path.dirname(staged), { recursive: true });
  fs.copyFileSync(output, staged);
}

console.log(
  local
    ? "[build-desktop] Building reusable local debug output"
    : `[build-desktop] Building ${process.platform} bundles: ${bundles}`,
);
const buildArgs = local ? ["--debug", "--no-bundle"] : ["--bundles", bundles];
if (process.platform === "win32") buildArgs.push("--config", "src-tauri/tauri.shell.windows.conf.json");
const result = spawnSync(process.execPath, ["run", "tauri", "build", ...buildArgs], {
  cwd: root,
  env,
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`[build-desktop] Failed to start Tauri: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);

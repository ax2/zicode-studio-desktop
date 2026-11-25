#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { withCargoBin } = require("./cargo-path");

const args = process.argv.slice(2);
const local = args.includes("--local");
const shellOnly = args.includes("--shell-only");
const rustTimings = args.includes("--rust-timings");
if (args.some((arg) => !["--local", "--shell-only", "--rust-timings"].includes(arg)) ||
    (shellOnly && (local || rustTimings))) {
  console.error("Usage: build-desktop.js [--local] [--rust-timings] | build-desktop.js --shell-only");
  process.exit(1);
}
if (shellOnly && process.platform !== "win32") {
  console.error("[build-desktop] Explorer selection bridge requires Windows");
  process.exit(1);
}

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
  const shellArgs = ["build", "--locked", "--manifest-path", path.join(root, "shell", "Cargo.toml"), "--target-dir", env.CARGO_TARGET_DIR];
  if (!local) shellArgs.push("--release");
  const shell = spawnSync("cargo", shellArgs, { cwd: root, env, stdio: "inherit", windowsHide: true });
  if (shell.error || shell.status !== 0) {
    console.error(`[build-desktop] Explorer selection bridge failed: ${shell.error?.message ?? shell.status}`);
    process.exit(1);
  }
  const output = path.join(env.CARGO_TARGET_DIR, profile, "zicode_studio_shell.dll");
  if (!local) {
    const staged = path.join(root, "src-tauri", "resources", "shell", "zicode_studio_shell.dll");
    fs.mkdirSync(path.dirname(staged), { recursive: true });
    fs.copyFileSync(output, staged);
  }
}

if (shellOnly) process.exit(0);

console.log(
  local
    ? "[build-desktop] Building reusable local debug output"
    : `[build-desktop] Building ${process.platform} bundles: ${bundles}`,
);
const buildArgs = local ? ["--debug", "--no-bundle"] : ["--bundles", bundles];
if (local) {
  // The offline WebView2 installer is only consumed by the NSIS install hook.
  // Keep all runtime/UI preparation while allowing an installed Windows runtime
  // to run a local build without downloading a separate installer.
  const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"));
  const beforeBuildCommand = config.build.beforeBuildCommand
    .split(/\s*&&\s*/)
    .filter((step) => step !== "bun run fetch:webview2")
    .join(" && ");
  buildArgs.push("--config", JSON.stringify({ build: { beforeBuildCommand } }));
}

// A local no-bundle build already has the Shell DLL beside the EXE in target/debug.
// Bundling it again tries to overwrite a file Explorer may have loaded.
if (process.platform === "win32" && !local) buildArgs.push("--config", "src-tauri/tauri.shell.windows.conf.json");
if (rustTimings) {
  buildArgs.push("--", "--timings");
  console.log("[build-desktop] Cargo timing reports:", path.join(env.CARGO_TARGET_DIR, "cargo-timings"));
}
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
if (result.status !== 0 || !local || process.platform !== "win32") {
  process.exit(result.status ?? 1);
}

const configDir = path.join(root, "src-tauri");
const config = JSON.parse(fs.readFileSync(path.join(configDir, "tauri.conf.json"), "utf8"));
const { stageLocalResources } = require("./stage-local-resources");
const stagingStarted = Date.now();
stageLocalResources(configDir, path.join(env.CARGO_TARGET_DIR, "debug"), config.bundle.resources)
  .then(updated => console.log("[build-desktop] Local runtime resources updated:", updated, `(${Date.now() - stagingStarted} ms)`))
  .catch(error => {
    console.error("[build-desktop] Local runtime resources failed:", error.message);
    process.exitCode = 1;
  });

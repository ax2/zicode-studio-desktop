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
  const shellArgs = ["build", "--manifest-path", path.join(root, "shell", "Cargo.toml"), "--target-dir", env.CARGO_TARGET_DIR];
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

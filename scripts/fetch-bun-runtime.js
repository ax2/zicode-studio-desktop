#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { unzipSync } = require("fflate");
const { downloadLockedAsset } = require("./download-locked-asset");
const { installStagedDirectory, recoverStagedDirectory } = require("./install-staged-directory");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(__dirname, "bun-runtime-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "bun-runtime");
const OUT_DIR = path.join(ROOT, "src-tauri", "resources", "bun");
const VERSION_MARKER = path.join(OUT_DIR, ".version");

function fail(message) {
  console.error(`[fetch-bun-runtime] FAIL: ${message}`);
  process.exit(1);
}

function targetKey() {
  if (process.env.PI_TARGET_PLATFORM) return process.env.PI_TARGET_PLATFORM;
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const architecture = process.arch === "arm64" ? "arm64" : process.arch;
  return `${platform}-${architecture}`;
}

function hostTargetKey() {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const architecture = process.arch === "arm64" ? "arm64" : process.arch;
  return `${platform}-${architecture}`;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isInstalled(marker, executablePath) {
  try {
    const binary = fs.lstatSync(executablePath);
    return (
      binary.isFile() &&
      binary.size > 0 &&
      fs.readFileSync(VERSION_MARKER, "utf8").trim() === marker
    );
  } catch {
    return false;
  }
}

function installStagedRuntime(executableName, marker, writeExecutable) {
  installStagedDirectory(OUT_DIR, "fetch-bun-runtime", (staging) => {
    const stagedExecutable = path.join(staging, executableName);
    writeExecutable(stagedExecutable);
    const stagedFile = fs.lstatSync(stagedExecutable);
    if (!stagedFile.isFile() || stagedFile.size === 0) {
      throw new Error("Staged Bun executable is empty or invalid");
    }
    fs.writeFileSync(path.join(staging, ".version"), `${marker}\n`, "utf8");
  });
}

async function main() {
  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  const target = targetKey();
  const asset = lock.assets?.[target];
  if (!asset?.name || !asset?.sha256) fail(`Unsupported target ${target}`);
  const marker = JSON.stringify({ version: lock.version, target, sha256: asset.sha256 });
  const executableName = target.startsWith("windows-") ? "bun.exe" : "bun";
  const executablePath = path.join(OUT_DIR, executableName);
  recoverStagedDirectory(OUT_DIR, "fetch-bun-runtime");
  if (isInstalled(marker, executablePath)) {
    console.log(`[fetch-bun-runtime] Bun ${lock.version} is already installed; skipping.`);
    return;
  }
  if (target === hostTargetKey() && globalThis.Bun?.version === lock.version) {
    installStagedRuntime(executableName, marker, (stagedExecutable) => {
      fs.copyFileSync(process.execPath, stagedExecutable);
      if (!target.startsWith("windows-")) fs.chmodSync(stagedExecutable, 0o755);
    });
    console.log(
      `[fetch-bun-runtime] reused the matching Bun ${lock.version} installed for this build.`,
    );
    return;
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const archivePath = path.join(CACHE_DIR, asset.name);
  if (fs.existsSync(archivePath) && sha256(archivePath) !== asset.sha256) {
    fs.rmSync(archivePath, { force: true });
  }
  if (!fs.existsSync(archivePath)) {
    const url = `https://github.com/oven-sh/bun/releases/download/${lock.tag}/${asset.name}`;
    console.log(`[fetch-bun-runtime] downloading ${url}`);
    try {
      await downloadLockedAsset(url, archivePath);
    } catch (error) {
      fs.rmSync(archivePath, { force: true });
      fail(`download failed: ${error.message}`);
    }
  }
  const actual = sha256(archivePath);
  if (actual !== asset.sha256) fail(`SHA-256 mismatch: expected ${asset.sha256}, got ${actual}`);
  const archive = unzipSync(new Uint8Array(fs.readFileSync(archivePath)));
  const entry = Object.entries(archive).find(
    ([name]) => path.posix.basename(name) === executableName,
  );
  if (!entry) fail(`${executableName} is missing from ${asset.name}`);
  installStagedRuntime(executableName, marker, (stagedExecutable) => {
    fs.writeFileSync(stagedExecutable, entry[1]);
    if (!target.startsWith("windows-")) fs.chmodSync(stagedExecutable, 0o755);
  });
  console.log(`[fetch-bun-runtime] installed Bun ${lock.version} -> ${executablePath}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));

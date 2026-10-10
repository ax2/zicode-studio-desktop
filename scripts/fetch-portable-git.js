#!/usr/bin/env node
/**
 * Install the pinned official Git for Windows PortableGit distribution into
 * the Tauri resources directory. PortableGit includes git.exe and bash.exe,
 * so a packaged app never depends on a system Git or Bash installation.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { downloadLockedAsset } = require("./download-locked-asset");
const { installStagedDirectory, recoverStagedDirectory } = require("./install-staged-directory");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(__dirname, "portable-git-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "portable-git");
const OUT_DIR = path.join(ROOT, "src-tauri", "resources", "portable-git");
const VERSION_MARKER = path.join(OUT_DIR, ".version");

function info(message) {
  console.log(`[fetch-portable-git] ${message}`);
}

function fail(message) {
  console.error(`[fetch-portable-git] FAIL: ${message}`);
  process.exit(1);
}

function targetKey() {
  const override = process.env.PI_TARGET_PLATFORM;
  if (override) return override.startsWith("windows-") ? override : null;
  if (process.platform !== "win32") return null;
  if (process.arch === "x64") return "windows-x64";
  if (process.arch === "arm64") return "windows-arm64";
  fail(`Unsupported Windows architecture: ${process.arch}`);
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function isInstalled(marker) {
  try {
    return (
      fs.readFileSync(VERSION_MARKER, "utf8").trim() === marker &&
      [path.join("cmd", "git.exe"), path.join("bin", "bash.exe")].every((relativePath) => {
        const binary = fs.lstatSync(path.join(OUT_DIR, relativePath));
        return binary.isFile() && binary.size > 0;
      })
    );
  } catch {
    return false;
  }
}

async function main() {
  const key = targetKey();
  if (!key) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (name !== ".gitkeep")
        fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
    }
    info("non-Windows target; cleared Windows-only PortableGit resources.");
    return;
  }

  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  const asset = lock.assets?.[key];
  if (!lock.tag || !lock.version || !asset?.name || !asset?.sha256) {
    fail(`Missing complete lock data for ${key} in ${LOCK_FILE}`);
  }
  const marker = JSON.stringify({ version: lock.version, target: key, sha256: asset.sha256 });

  recoverStagedDirectory(OUT_DIR, "fetch-portable-git");
  if (isInstalled(marker)) {
    info(`PortableGit ${lock.version} is already installed; skipping.`);
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const archivePath = path.join(CACHE_DIR, asset.name);
  if (fs.existsSync(archivePath) && sha256OfFile(archivePath) !== asset.sha256) {
    fs.rmSync(archivePath, { force: true });
  }

  if (!fs.existsSync(archivePath)) {
    const url = `https://github.com/git-for-windows/git/releases/download/${lock.tag}/${asset.name}`;
    info(`downloading ${url}`);
    try {
      await downloadLockedAsset(url, archivePath);
    } catch (error) {
      fs.rmSync(archivePath, { force: true });
      fail(`download failed: ${error.message}`);
    }
  } else {
    info(`using cached archive: ${archivePath}`);
  }

  const actualSha = sha256OfFile(archivePath);
  if (actualSha !== asset.sha256) {
    fs.rmSync(archivePath, { force: true });
    fail(`SHA-256 mismatch: expected ${asset.sha256}, got ${actualSha}`);
  }
  info("SHA-256 verified.");

  installStagedDirectory(OUT_DIR, "fetch-portable-git", (staging) => {
    const extraction = spawnSync(archivePath, [`-o${staging}`, "-y"], {
      stdio: "inherit",
      windowsHide: true,
    });
    if (extraction.status !== 0) {
      throw new Error(
        `PortableGit extraction failed (exit ${extraction.status}): ${extraction.error?.message ?? "unknown error"}`,
      );
    }

    for (const relativePath of [path.join("cmd", "git.exe"), path.join("bin", "bash.exe")]) {
      const binary = fs.lstatSync(path.join(staging, relativePath));
      if (!binary.isFile() || binary.size === 0) {
        throw new Error(`extraction succeeded but ${relativePath} is empty or invalid`);
      }
    }
    fs.writeFileSync(path.join(staging, ".version"), `${marker}\n`, "utf8");
  });
  info(`installed PortableGit ${lock.version} -> ${OUT_DIR}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));

#!/usr/bin/env node
/**
 * Install the pinned official Git for Windows PortableGit distribution into
 * the Tauri resources directory. PortableGit includes git.exe and bash.exe,
 * so a packaged app never depends on a system Git or Bash installation.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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

function downloadTo(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { "User-Agent": "zicode-studio-desktop-build" } });
    request.on("response", (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadTo(response.headers.location, destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", (error) => {
        file.close();
        fs.rmSync(destination, { force: true });
        reject(error);
      });
    });
    request.on("error", reject);
  });
}

function isInstalled(version) {
  if (!fs.existsSync(VERSION_MARKER)) return false;
  const installedVersion = fs.readFileSync(VERSION_MARKER, "utf8").trim();
  return (
    installedVersion === version &&
    fs.existsSync(path.join(OUT_DIR, "cmd", "git.exe")) &&
    fs.existsSync(path.join(OUT_DIR, "bin", "bash.exe"))
  );
}

async function main() {
  const key = targetKey();
  if (!key) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    info("non-Windows target; keeping the resource directory and skipping PortableGit.");
    return;
  }

  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  const asset = lock.assets?.[key];
  if (!lock.tag || !lock.version || !asset?.name || !asset?.sha256) {
    fail(`Missing complete lock data for ${key} in ${LOCK_FILE}`);
  }

  if (isInstalled(lock.version)) {
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
      await downloadTo(url, archivePath);
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

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const extraction = spawnSync(archivePath, [`-o${OUT_DIR}`, "-y"], {
    stdio: "inherit",
    windowsHide: true,
  });
  if (extraction.status !== 0) {
    fail(`PortableGit extraction failed (exit ${extraction.status})`);
  }

  for (const relativePath of [path.join("cmd", "git.exe"), path.join("bin", "bash.exe")]) {
    if (!fs.existsSync(path.join(OUT_DIR, relativePath))) {
      fail(`extraction succeeded but ${relativePath} is missing`);
    }
  }
  fs.writeFileSync(VERSION_MARKER, lock.version, "utf8");
  info(`installed PortableGit ${lock.version} -> ${OUT_DIR}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));

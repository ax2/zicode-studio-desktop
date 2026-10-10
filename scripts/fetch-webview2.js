#!/usr/bin/env node
/**
 * Fetch the pinned official Microsoft WebView2 offline installer.
 * The NSIS hook runs this bundled installer when WebView2 is absent, avoiding
 * Tauri's build-time dependency on Microsoft's dynamic redirect endpoint.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { downloadLockedAsset } = require("./download-locked-asset");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(__dirname, "webview2-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "webview2");
const OUT_DIR = path.join(ROOT, "src-tauri", "resources", "webview2");

function info(message) {
  console.log(`[fetch-webview2] ${message}`);
}

function fail(message) {
  console.error(`[fetch-webview2] FAIL: ${message}`);
  process.exit(1);
}

function targetKey() {
  const override = process.env.PI_TARGET_PLATFORM;
  if (override) return override.startsWith("windows-") ? override : null;
  if (process.platform !== "win32") return null;
  if (process.arch === "x64") return "windows-x64";
  fail(`Unsupported Windows architecture: ${process.arch}`);
}

async function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function stageInstaller(cachePath, temporary) {
  try {
    const entry = fs.lstatSync(cachePath);
    if (entry.isFile() && !entry.isSymbolicLink()) {
      fs.linkSync(cachePath, temporary);
      return;
    }
  } catch (error) {
    if (fs.existsSync(temporary)) throw error;
    // Filesystems without hard-link support still use the verified copy path.
  }
  fs.copyFileSync(cachePath, temporary, fs.constants.COPYFILE_EXCL);
}

async function dedupeInstalled(cachePath, outputPath, expectedSha) {
  const cache = resourceEntry(cachePath);
  if (!cache?.isFile() || cache.isSymbolicLink()) return "unavailable";
  const source = fs.statSync(cachePath, { bigint: true });
  const target = fs.statSync(outputPath, { bigint: true });
  // The installed target was just hashed above. One inode means the cache is
  // already the same verified bytes; avoid reading a second 195 MB file.
  if (source.dev !== target.dev) return "unavailable";
  if (source.ino === target.ino) return "already";
  if (await sha256OfFile(cachePath) !== expectedSha) return "unavailable";
  const temporary = path.join(OUT_DIR, `${crypto.randomUUID()}.tmp`);
  try {
    fs.linkSync(cachePath, temporary);
    if (await sha256OfFile(temporary) !== expectedSha) {
      throw new Error("Staged WebView2 SHA-256 mismatch");
    }
    fs.renameSync(temporary, outputPath);
    return "deduped";
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function resourceEntry(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function pruneOldInstallers(currentName) {
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (name === currentName || name === ".gitkeep") continue;
    const stalePath = path.join(OUT_DIR, name);
    if (fs.lstatSync(stalePath).isDirectory()) {
      fail(`Unexpected directory in WebView2 resources: ${name}`);
    }
    fs.unlinkSync(stalePath);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dedupeOnly = args.length === 1 && args[0] === "--dedupe-only";
  if (args.length && !dedupeOnly) fail("Usage: fetch-webview2.js [--dedupe-only]");
  const key = targetKey();
  if (dedupeOnly && !key) fail("Deduplication is available only for a Windows target");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!key) {
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (name !== ".gitkeep")
        fs.rmSync(path.join(OUT_DIR, name), { recursive: true, force: true });
    }
    info("non-Windows target; cleared Windows-only WebView2 resources.");
    return;
  }

  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  const asset = lock.assets?.[key];
  if (!lock.version || !asset?.name || !asset?.url || !asset?.sha256) {
    fail(`Missing complete lock data for ${key} in ${LOCK_FILE}`);
  }
  if (asset.name.includes("/") || asset.name.includes("\\") || !asset.name.endsWith(".exe")) {
    fail(`Invalid WebView2 asset name for ${key}`);
  }

  const outputPath = path.join(OUT_DIR, asset.name);
  const existing = resourceEntry(outputPath);
  if (existing?.isDirectory()) fail(`Unexpected WebView2 resource directory: ${asset.name}`);
  if (existing?.isFile() && !existing.isSymbolicLink() && await sha256OfFile(outputPath) === asset.sha256) {
    const cachePath = path.join(CACHE_DIR, asset.name);
    let dedupeStatus = "unavailable";
    try {
      dedupeStatus = await dedupeInstalled(cachePath, outputPath, asset.sha256);
    } catch (error) {
      if (dedupeOnly) throw error;
      info(`optional hard-link reuse skipped: ${error.code || error.message}`);
    }
    if (dedupeOnly && dedupeStatus === "unavailable") {
      fail("A matching same-volume WebView2 cache is unavailable for deduplication");
    }
    if (!dedupeOnly) pruneOldInstallers(asset.name);
    if (dedupeStatus === "deduped") info("reused cached installer data through a hard link.");
    info(`WebView2 ${lock.version} is already installed; skipping.`);
    return;
  }
  if (dedupeOnly) fail("The installed WebView2 resource is missing or does not match the lock");

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, asset.name);
  if (fs.existsSync(cachePath) && await sha256OfFile(cachePath) !== asset.sha256) {
    fs.rmSync(cachePath, { force: true });
  }
  if (!fs.existsSync(cachePath)) {
    info(`downloading ${asset.url}`);
    try {
      await downloadLockedAsset(asset.url, cachePath);
    } catch (error) {
      fs.rmSync(cachePath, { force: true });
      fail(`download failed: ${error.message}`);
    }
  }

  const actualSha = await sha256OfFile(cachePath);
  if (actualSha !== asset.sha256) {
    fs.rmSync(cachePath, { force: true });
    fail(`SHA-256 mismatch: expected ${asset.sha256}, got ${actualSha}`);
  }
  const temporary = path.join(OUT_DIR, `${crypto.randomUUID()}.tmp`);
  try {
    stageInstaller(cachePath, temporary);
    if (await sha256OfFile(temporary) !== asset.sha256) {
      throw new Error("Staged WebView2 SHA-256 mismatch");
    }
    fs.renameSync(temporary, outputPath);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
  pruneOldInstallers(asset.name);
  info(`SHA-256 verified; installed WebView2 ${lock.version} -> ${outputPath}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));

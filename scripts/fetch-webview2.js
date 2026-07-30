#!/usr/bin/env node
/**
 * Fetch the pinned official Microsoft WebView2 offline installer.
 * The NSIS hook runs this bundled installer when WebView2 is absent, avoiding
 * Tauri's build-time dependency on Microsoft's dynamic redirect endpoint.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");

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
  if (override) return override;
  if (process.platform !== "win32") return null;
  if (process.arch === "x64") return "windows-x64";
  fail(`Unsupported Windows architecture: ${process.arch}`);
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function downloadTo(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { "User-Agent": "zicode-studio-desktop-build" },
    });
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

async function main() {
  const key = targetKey();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (!key) {
    info("non-Windows target; keeping the resource directory and skipping WebView2.");
    return;
  }

  const lock = JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  const asset = lock.assets?.[key];
  if (!lock.version || !asset?.name || !asset?.url || !asset?.sha256) {
    fail(`Missing complete lock data for ${key} in ${LOCK_FILE}`);
  }

  const outputPath = path.join(OUT_DIR, asset.name);
  if (fs.existsSync(outputPath) && sha256OfFile(outputPath) === asset.sha256) {
    info(`WebView2 ${lock.version} is already installed; skipping.`);
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, asset.name);
  if (fs.existsSync(cachePath) && sha256OfFile(cachePath) !== asset.sha256) {
    fs.rmSync(cachePath, { force: true });
  }
  if (!fs.existsSync(cachePath)) {
    info(`downloading ${asset.url}`);
    try {
      await downloadTo(asset.url, cachePath);
    } catch (error) {
      fs.rmSync(cachePath, { force: true });
      fail(`download failed: ${error.message}`);
    }
  }

  const actualSha = sha256OfFile(cachePath);
  if (actualSha !== asset.sha256) {
    fs.rmSync(cachePath, { force: true });
    fail(`SHA-256 mismatch: expected ${asset.sha256}, got ${actualSha}`);
  }
  fs.copyFileSync(cachePath, outputPath);
  info(`SHA-256 verified; installed WebView2 ${lock.version} -> ${outputPath}`);
}

main().catch((error) => fail(error.stack || error.message || String(error)));

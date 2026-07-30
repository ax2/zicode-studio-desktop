#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPOSITORY = "earendil-works/pi-mono";
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const LOCK_PATH = path.join(__dirname, "pi-version.json");
const REQUIRED_ASSETS = [
  "pi-darwin-arm64.tar.gz",
  "pi-darwin-x64.tar.gz",
  "pi-linux-arm64.tar.gz",
  "pi-linux-x64.tar.gz",
  "pi-windows-arm64.zip",
  "pi-windows-x64.zip",
];

function normalizeVersion(value) {
  const version = String(value ?? "")
    .trim()
    .replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid Pi version: ${value}`);
  }
  return version;
}

function buildLock(release) {
  const version = normalizeVersion(release?.tag_name);
  const assets = new Map((release?.assets ?? []).map((asset) => [asset.name, asset]));
  const sha256 = {};
  for (const name of REQUIRED_ASSETS) {
    const asset = assets.get(name);
    if (!asset) throw new Error(`Pi v${version} is missing required release asset: ${name}`);
    const match = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest ?? ""));
    if (!match) {
      throw new Error(`Pi v${version} release asset has no trusted SHA-256 digest: ${name}`);
    }
    sha256[name] = match[1].toLowerCase();
  }
  return {
    version,
    sha256,
    _comment:
      "Locked pi release and GitHub-published SHA-256 digests for supported desktop targets.",
  };
}

async function fetchRelease(requestedVersion) {
  const endpoint =
    !requestedVersion || requestedVersion === "latest"
      ? `${RELEASE_API}/latest`
      : `${RELEASE_API}/tags/v${normalizeVersion(requestedVersion)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "zicode-studio-desktop",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub release lookup failed (${response.status} ${response.statusText})`);
  }
  return response.json();
}

function writeLock(lock) {
  const temporaryPath = `${LOCK_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, LOCK_PATH);
}

function runVerificationScript(name, args = []) {
  const result = spawnSync(process.execPath, ["run", path.join(__dirname, name), ...args], {
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${name} failed with exit code ${result.status}`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const lockOnly = args.includes("--lock-only");
  const requestedVersion = args.find((arg) => !arg.startsWith("--")) ?? "latest";
  const release = await fetchRelease(requestedVersion);
  const lock = buildLock(release);
  const current = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8"));
  console.log(`[update-pi] ${current.version} -> ${lock.version}`);
  for (const [name, digest] of Object.entries(lock.sha256)) {
    console.log(`[update-pi] ${name}: ${digest}`);
  }
  if (dryRun) {
    console.log("[update-pi] dry run; lock file was not changed.");
    return;
  }
  writeLock(lock);
  console.log(`[update-pi] updated ${path.relative(process.cwd(), LOCK_PATH)}`);
  if (!lockOnly) {
    runVerificationScript("fetch-pi-binary.js");
    runVerificationScript("smoke-pi-rpc.js", ["--update"]);
    runVerificationScript("smoke-pi-rpc.js");
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[update-pi] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { REQUIRED_ASSETS, buildLock, normalizeVersion };

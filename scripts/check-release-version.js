#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`[check-release-version] ${message}`);
  process.exit(1);
}

function appVersionForTag(tag) {
  const version = tag.replace(/^refs\/tags\//, "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(version)) {
    fail(`invalid release tag: ${tag}`);
  }

  const prerelease = version.match(/^(\d+\.\d+\.\d+)-(alpha|beta|rc)\.(\d+)$/);
  if (!prerelease) return version;

  const offsets = { alpha: 30000, beta: 10000, rc: 20000 };
  const encoded = offsets[prerelease[2]] + Number.parseInt(prerelease[3], 10);
  if (encoded > 65535) {
    fail(`prerelease number is too large for Windows packaging: ${version}`);
  }
  return `${prerelease[1]}-${encoded}`;
}

function packageVersionFromToml(file) {
  const contents = fs.readFileSync(file, "utf8");
  const packageSection = contents.match(/\[package\]([\s\S]*?)(?:\n\[|$)/);
  const version = packageSection?.[1].match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) fail(`cannot read package version from ${file}`);
  return version;
}

function packageVersionFromCargoLock(file, packageName) {
  const contents = fs.readFileSync(file, "utf8");
  const blocks = contents.match(/\[\[package\]\][\s\S]*?(?=\n\[\[package\]\]|$)/g) ?? [];
  const block = blocks.find((candidate) =>
    new RegExp(`^name\\s*=\\s*"${packageName}"$`, "m").test(candidate),
  );
  const version = block?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (!version) fail(`cannot read ${packageName} version from ${file}`);
  return version;
}

const tag = process.argv[2];
if (!tag) fail("usage: bun run scripts/check-release-version.js <vX.Y.Z>");

const expected = appVersionForTag(tag);
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"),
);
const versions = {
  "package.json": packageJson.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": packageVersionFromToml(
    path.join(ROOT, "src-tauri", "Cargo.toml"),
  ),
  "src-tauri/Cargo.lock": packageVersionFromCargoLock(
    path.join(ROOT, "src-tauri", "Cargo.lock"),
    "zicode-studio-desktop",
  ),
};

const mismatches = Object.entries(versions).filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  console.error(`[check-release-version] tag ${tag} requires app version ${expected}:`);
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version}`);
  }
  process.exit(1);
}

console.log(`[check-release-version] ${tag} matches app version ${expected}.`);

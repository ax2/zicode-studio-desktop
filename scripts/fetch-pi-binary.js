#!/usr/bin/env node
/**
 * Fetch the platform-specific pi binary tarball from pi-mono GitHub
 * releases and extract it into `src-tauri/resources/pi/` so the Tauri
 * bundle can ship a self-contained pi runtime.
 *
 * Why this exists
 * ---------------
 * ZiCode Studio Desktop used to find `pi` on the user's PATH, harvest API keys from
 * their login shell, and probe several install locations. That created a
 * long tail of "works on dev box, broken on Finder-launched .app" bugs.
 * By embedding a known pi version inside the .app, we make pi-studio's
 * runtime fully self-contained: it neither requires nor consults a
 * user-installed pi.
 *
 * Source of truth: `scripts/pi-version.json` (`version`, required `sha256`
 * per-asset). Bumping the version is an explicit, reviewable change.
 *
 * Output: `src-tauri/resources/pi/` containing the extracted release tree
 * (binary `pi` / `pi.exe`, theme/, assets/, node_modules/, etc.) plus a
 * `.version` marker file used for idempotency.
 *
 * Idempotency
 * -----------
 * If `src-tauri/resources/pi/.version` matches the locked version, target,
 * and checksum AND the expected binary path exists, the script exits 0 immediately.
 * Useful so Tauri's build/dev hooks can run it unconditionally without paying
 * the download cost on every invocation.
 */

const fs = require("node:fs");
const path = require("node:path");
const _os = require("node:os");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { downloadLockedAsset, MAX_ARCHIVE_BYTES } = require("./download-locked-asset");
const { installStagedDirectory, recoverStagedDirectory } = require("./install-staged-directory");

const ROOT = path.resolve(__dirname, "..");
const VERSION_FILE = path.join(__dirname, "pi-version.json");
const CACHE_DIR = path.join(ROOT, ".cache", "pi-binaries");
const OUT_DIR = path.join(ROOT, "src-tauri", "resources", "pi");
const VERSION_MARKER = path.join(OUT_DIR, ".version");
const SUPPORTED_TARGETS = new Set([
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "windows-arm64",
  "windows-x64",
]);

function info(msg) {
  console.log(`[fetch-pi] ${msg}`);
}

function warn(msg) {
  console.warn(`[fetch-pi] WARN: ${msg}`);
}

function fail(msg) {
  console.error(`[fetch-pi] FAIL: ${msg}`);
  process.exit(1);
}

function platformAssetName() {
  const platform = process.platform;
  const arch = process.arch;
  // Optional override useful for CI / multi-arch packaging where the host
  // platform is not the target. Format: "darwin-arm64", "linux-x64", etc.
  const override = process.env.PI_TARGET_PLATFORM;
  let key;
  if (override) {
    key = override;
  } else if (platform === "darwin" && arch === "arm64") {
    key = "darwin-arm64";
  } else if (platform === "darwin" && arch === "x64") {
    key = "darwin-x64";
  } else if (platform === "linux" && arch === "x64") {
    key = "linux-x64";
  } else if (platform === "linux" && arch === "arm64") {
    key = "linux-arm64";
  } else if (platform === "win32" && arch === "x64") {
    key = "windows-x64";
  } else if (platform === "win32" && arch === "arm64") {
    key = "windows-arm64";
  } else {
    fail(
      `Unsupported platform=${platform} arch=${arch}. ` +
        `Set PI_TARGET_PLATFORM to one of: darwin-arm64, darwin-x64, linux-x64, linux-arm64, windows-x64, windows-arm64.`,
    );
  }
  if (!SUPPORTED_TARGETS.has(key)) {
    fail(`Unsupported Pi target: ${key}`);
  }
  const isWindows = key.startsWith("windows-");
  return {
    key,
    archiveName: isWindows ? `pi-${key}.zip` : `pi-${key}.tar.gz`,
    binaryName: isWindows ? "pi.exe" : "pi",
    isZip: isWindows,
  };
}

function loadLockedVersion() {
  let raw;
  try {
    raw = fs.readFileSync(VERSION_FILE, "utf8");
  } catch (err) {
    fail(`Could not read ${VERSION_FILE}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    fail(`Invalid JSON in ${VERSION_FILE}: ${err.message}`);
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.version !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(parsed.version)
  ) {
    fail(`Invalid "version" in ${VERSION_FILE}`);
  }
  return {
    version: parsed.version,
    sha256: parsed.sha256 && typeof parsed.sha256 === "object" ? parsed.sha256 : {},
  };
}

function missingRuntimeEntry(root, binaryName) {
  // Pi 1.x embeds its JS dependencies and ships Photon beside the binary.
  // Older release archives still require their external node_modules tree.
  const embeddedDependencies =
    Number(JSON.parse(fs.readFileSync(VERSION_FILE, "utf8")).version.split(".")[0]) >= 1;
  const files = [
    binaryName,
    "package.json",
    path.join("docs", "rpc.md"),
    path.join("theme", "dark.json"),
    path.join("theme", "light.json"),
    ...(embeddedDependencies ? ["photon_rs_bg.wasm"] : []),
  ];
  for (const relativePath of files) {
    try {
      const entry = fs.lstatSync(path.join(root, relativePath));
      if (!entry.isFile() || entry.size === 0) return relativePath;
    } catch {
      return relativePath;
    }
  }
  for (const relativePath of ["assets", ...(embeddedDependencies ? [] : ["node_modules"])]) {
    try {
      if (!fs.lstatSync(path.join(root, relativePath)).isDirectory()) return relativePath;
    } catch {
      return relativePath;
    }
  }
  return null;
}

function isUpToDate(marker, binaryName) {
  if (!fs.existsSync(VERSION_MARKER)) return false;
  let current;
  try {
    current = fs.readFileSync(VERSION_MARKER, "utf8").trim();
  } catch {
    return false;
  }
  if (current !== marker) return false;
  return missingRuntimeEntry(OUT_DIR, binaryName) === null;
}

function pruneSupersededArchives(version, archiveName) {
  if (!fs.existsSync(CACHE_DIR)) return;
  const suffix = `-${archiveName}`;
  const partialSuffix = `${suffix}.part`;
  const minimumAgeMs = 7 * 24 * 60 * 60 * 1000;
  let removedBytes = 0;
  let entries;
  try {
    entries = fs.readdirSync(CACHE_DIR, { withFileTypes: true });
  } catch (error) {
    warn(`could not inspect Pi archive cache: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const partial = entry.name.endsWith(partialSuffix);
    if (!partial && !entry.name.endsWith(suffix)) continue;
    const cachedVersion = entry.name.slice(0, -(partial ? partialSuffix : suffix).length);
    if (
      (!partial && cachedVersion === version) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(cachedVersion)
    ) continue;
    const archivePath = path.join(CACHE_DIR, entry.name);
    try {
      const metadata = fs.statSync(archivePath);
      // A concurrent build may have just downloaded a different lock version.
      // Leave recent archives alone even when they are not this build's lock.
      if (Date.now() - metadata.mtimeMs < minimumAgeMs) continue;
      fs.unlinkSync(archivePath);
      removedBytes += metadata.size;
    } catch (error) {
      warn(`could not prune superseded Pi archive ${entry.name}: ${error.message}`);
    }
  }
  if (removedBytes > 0) {
    info(`pruned superseded ${archiveName} cache files (${(removedBytes / 1024 / 1024).toFixed(1)} MiB).`);
  }
}

async function downloadTo(url, dest) {
  const partial = `${dest}.part`;
  fs.rmSync(partial, { force: true });
  function commitPartial() {
    if (fs.statSync(partial).size > MAX_ARCHIVE_BYTES) {
      fs.rmSync(partial, { force: true });
      throw new Error("Pi archive exceeds the download size limit");
    }
    fs.renameSync(partial, dest);
  }
  if (process.platform === "win32") {
    const bits = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Import-Module BitsTransfer; Start-BitsTransfer -Source $env:ZICODE_PI_DOWNLOAD_SOURCE -Destination $env:ZICODE_PI_DOWNLOAD_DEST",
      ],
      {
        stdio: "inherit",
        timeout: 600_000,
        env: {
          ...process.env,
          ZICODE_PI_DOWNLOAD_SOURCE: url,
          ZICODE_PI_DOWNLOAD_DEST: partial,
        },
      },
    );
    if (bits.status === 0) {
      commitPartial();
      return;
    }
    warn(`BITS download failed; falling back to curl (exit ${bits.status}).`);
    fs.rmSync(partial, { force: true });
  }

  const curl = spawnSync(
    "curl",
    [
      "--fail",
      "--location",
      "--retry",
      "3",
      "--connect-timeout",
      "30",
      "--max-time",
      "600",
      "--max-filesize",
      String(MAX_ARCHIVE_BYTES),
      "--user-agent",
      "zicode-studio-desktop",
      "--output",
      partial,
      url,
    ],
    { stdio: "inherit" },
  );
  if (curl.status === 0) {
    commitPartial();
    return;
  }
  if (curl.error?.code !== "ENOENT") {
    fs.rmSync(partial, { force: true });
    throw curl.error ?? new Error(`curl exited with code ${curl.status}`);
  }

  // Minimal environments may not ship curl. Use the bounded streaming
  // downloader already shared by other pinned build resources.
  await downloadLockedAsset(url, dest);
}

function sha256OfFile(filePath) {
  const hash = crypto.createHash("sha256");
  const handle = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const count = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(handle);
  }
  return hash.digest("hex");
}

function flattenWrapperDir(outDir, wrapperName) {
  // Archives wrap the entire payload in a single directory named e.g. "pi/".
  // We extract into outDir and then promote that wrapper's contents up one
  // level so callers get a flat layout.
  //
  // Careful: when wrapperName itself collides with a file inside the wrapper
  // (the bun-compiled `pi` binary inside `pi/`), we cannot naively rename
  // children into outDir because the wrapper dir would be the rename target
  // for its own binary child. Rename the wrapper to a temp name first.
  const wrapper = path.join(outDir, wrapperName);
  if (!fs.existsSync(wrapper) || !fs.statSync(wrapper).isDirectory()) return;
  const tmpName = `${wrapperName}__pi_studio_tmp_${process.pid}`;
  const tmp = path.join(outDir, tmpName);
  fs.renameSync(wrapper, tmp);
  for (const entry of fs.readdirSync(tmp)) {
    fs.renameSync(path.join(tmp, entry), path.join(outDir, entry));
  }
  fs.rmdirSync(tmp);
}

function extractTarGz(archivePath, outDir) {
  // Use system tar — present on macOS and Linux runners, and reasonable to
  // require on dev machines targeting those platforms.
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", outDir], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`tar extraction failed (exit ${result.status})`);
  }
  flattenWrapperDir(outDir, "pi");
}

function sleepSync(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait is fine here: extraction retry loop, ms is small.
  }
}

function extractZipWindows(archivePath, outDir) {
  // Strategy:
  //   1) Prefer `tar.exe` (bundled with Windows 10 1803+, including
  //      GitHub Actions windows-latest runners). It can unpack .zip via
  //      libarchive, is much faster than Expand-Archive, and does not
  //      hold exclusive locks on the source archive the way
  //      Microsoft.PowerShell.Archive does.
  //   2) Fall back to PowerShell `Expand-Archive`, but with
  //      $ErrorActionPreference='Stop' so errors actually propagate as a
  //      non-zero exit code (otherwise the script silently continues
  //      and only fails at the post-extraction binary-existence check).
  //      Retry a few times on the classic "file is being used by another
  //      process" error caused by antivirus scanning the freshly
  //      downloaded archive.
  const tarResult = spawnSync("tar", ["-xf", archivePath, "-C", outDir], {
    stdio: "inherit",
  });
  if (tarResult.status === 0) return;
  if (tarResult.error && tarResult.error.code !== "ENOENT") {
    warn(`tar.exe extraction failed (${tarResult.error.message}); falling back to Expand-Archive.`);
  } else if (tarResult.status !== null) {
    warn(`tar.exe extraction exited ${tarResult.status}; falling back to Expand-Archive.`);
  }

  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const psResult = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "$ErrorActionPreference='Stop'; Expand-Archive -Force -LiteralPath $env:ZICODE_PI_ARCHIVE -DestinationPath $env:ZICODE_PI_DEST",
      ],
      {
        stdio: "inherit",
        env: { ...process.env, ZICODE_PI_ARCHIVE: archivePath, ZICODE_PI_DEST: outDir },
      },
    );
    if (psResult.status === 0) return;
    if (attempt < maxAttempts) {
      warn(
        `Expand-Archive failed (exit ${psResult.status}); retrying in 1s (attempt ${attempt}/${maxAttempts})…`,
      );
      sleepSync(1000);
    } else {
      throw new Error(
        `zip extraction failed on Windows after ${maxAttempts} attempts (exit ${psResult.status})`,
      );
    }
  }
}

function extractZip(archivePath, outDir) {
  if (process.platform === "win32") {
    extractZipWindows(archivePath, outDir);
  } else {
    const result = spawnSync("unzip", ["-q", "-o", archivePath, "-d", outDir], {
      stdio: "inherit",
    });
    if (result.status !== 0) {
      throw new Error(`zip extraction failed (exit ${result.status})`);
    }
  }
  // Note: Windows zip archives may or may not have a wrapper dir depending
  // on how they were created. Run flatten unconditionally; it's a no-op if
  // there's no wrapper.
  flattenWrapperDir(outDir, "pi");
}

async function main() {
  const { version, sha256 } = loadLockedVersion();
  const asset = platformAssetName();
  const lockedSha = sha256[asset.archiveName];
  if (typeof lockedSha !== "string" || !/^[a-f0-9]{64}$/i.test(lockedSha)) {
    fail(`Missing or invalid SHA-256 for ${asset.archiveName} in ${VERSION_FILE}`);
  }
  const expectedSha = lockedSha.toLowerCase();
  const marker = JSON.stringify({ version, target: asset.key, sha256: expectedSha });

  info(`locked pi version: ${version}`);
  info(`target asset: ${asset.archiveName}`);

  recoverStagedDirectory(OUT_DIR, "fetch-pi");
  if (isUpToDate(marker, asset.binaryName)) {
    pruneSupersededArchives(version, asset.archiveName);
    info(`already up to date at ${OUT_DIR}; skipping.`);
    return;
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cachedArchive = path.join(CACHE_DIR, `${version}-${asset.archiveName}`);

  if (fs.existsSync(cachedArchive)) {
    const actual = sha256OfFile(cachedArchive);
    if (actual !== expectedSha) {
      warn(
        `cached archive checksum mismatch (expected ${expectedSha}, got ${actual}); re-downloading.`,
      );
      fs.unlinkSync(cachedArchive);
    } else {
      info(`using cached archive: ${cachedArchive}`);
    }
  }

  if (!fs.existsSync(cachedArchive)) {
    const url = `https://github.com/earendil-works/pi-mono/releases/download/v${version}/${asset.archiveName}`;
    info(`downloading ${url}`);
    try {
      await downloadTo(url, cachedArchive);
    } catch (err) {
      fail(
        `download failed: ${err.message}\n` +
          `  - check network connectivity\n` +
          `  - verify v${version} exists at https://github.com/earendil-works/pi-mono/releases\n` +
          `  - if the version was just published, the asset may take a few minutes to propagate`,
      );
    }
  }

  const actual = sha256OfFile(cachedArchive);
  if (actual !== expectedSha) {
    try {
      fs.unlinkSync(cachedArchive);
    } catch {}
    fail(
      `sha256 mismatch for ${asset.archiveName}: expected ${expectedSha}, got ${actual}. ` +
        `Cached archive removed.`,
    );
  }
  info("sha256 verified.");

  info(`extracting ${asset.archiveName} into a staging directory`);
  installStagedDirectory(OUT_DIR, "fetch-pi", (staging) => {
    if (asset.isZip) {
      extractZip(cachedArchive, staging);
    } else {
      extractTarGz(cachedArchive, staging);
    }

    const missing = missingRuntimeEntry(staging, asset.binaryName);
    if (missing) throw new Error(`Pi archive is missing required runtime entry: ${missing}`);
    const stagedBinary = path.join(staging, asset.binaryName);
    // tar preserves +x; zip on Windows handles .exe natively.
    if (!asset.isZip) fs.chmodSync(stagedBinary, 0o755);

    // Ad-hoc re-sign before publication so a broken signature never replaces
    // a previously working macOS runtime without a visible warning.
    if (process.platform === "darwin") {
      try {
        execFileSync("codesign", ["--force", "--deep", "--sign", "-", stagedBinary]);
        info(`codesign: ad-hoc signed ${stagedBinary}`);
      } catch (error) {
        info(`codesign: warning — could not re-sign ${stagedBinary}: ${error.message}`);
      }
    }
    fs.writeFileSync(path.join(staging, ".version"), `${marker}\n`, "utf8");
  });
  info(`installed pi ${version} -> ${path.join(OUT_DIR, asset.binaryName)}`);
  pruneSupersededArchives(version, asset.archiveName);
}

main().catch((err) => {
  fail(`unexpected error: ${err.stack || err.message || err}`);
});

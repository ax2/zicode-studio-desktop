import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { verifyExecutableTarget } from "./executable-architecture.mjs";
import {
  missingReleaseBundlesMessage,
  releaseBundleDirectory,
  validateReleaseBundleName,
  validateReleaseBundleTypes,
} from "./release-artifact-policy.mjs";
import { matchingReleaseAsset, readDraftReleaseAssets } from "./release-draft-assets.mjs";

const bundleTypes = {
  nsis: { directory: "nsis", extension: ".exe" },
  dmg: { directory: "dmg", extension: ".dmg" },
  appimage: { directory: "appimage", extension: ".AppImage" },
  deb: { directory: "deb", extension: ".deb" },
};

const requested = process.argv[2]?.split(",").map((value) => value.trim());
const tag = process.env.RELEASE_TAG;
const repository = process.env.GITHUB_REPOSITORY;
if (!requested?.length || !tag || !repository) {
  throw new Error("Expected bundle types, RELEASE_TAG and GITHUB_REPOSITORY");
}
validateReleaseBundleTypes(process.env.PI_TARGET_PLATFORM, requested);

const bundleDirectory = releaseBundleDirectory(
  process.cwd(),
  process.env.CARGO_TARGET_DIR,
  process.env.CARGO_BUILD_TARGET,
);

const files = [];
const executableName = `zicode-studio-desktop${process.env.PI_TARGET_PLATFORM === "windows-x64" ? ".exe" : ""}`;
const executable = path.join(path.dirname(bundleDirectory), executableName);
if (!fs.existsSync(executable)) throw new Error(`Release executable missing: ${executable}`);
verifyExecutableTarget(executable, process.env.PI_TARGET_PLATFORM);
for (const type of requested) {
  const bundle = bundleTypes[type];
  if (!bundle) throw new Error(`Unsupported release bundle type: ${type}`);
  const directory = path.join(bundleDirectory, bundle.directory);
  const matches = fs.existsSync(directory)
    ? fs
        .readdirSync(directory)
        .filter((name) => name.endsWith(bundle.extension))
        .map((name) => path.join(directory, name))
        .filter((filePath) => fs.lstatSync(filePath).isFile())
    : [];
  if (matches.length !== 1) {
    throw new Error(`Expected one ${type} bundle in ${directory}, found ${matches.length}`);
  }
  const filePath = matches[0];
  validateReleaseBundleName(process.env.PI_TARGET_PLATFORM, type, filePath);
  if (fs.statSync(filePath).size === 0) throw new Error(`Empty release bundle: ${filePath}`);
  files.push(filePath);
}

function releaseAssets() {
  return readDraftReleaseAssets(repository, tag);
}

const digests = new Map();
async function fileDigest(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function localDigest(filePath) {
  if (!digests.has(filePath)) digests.set(filePath, await fileDigest(filePath));
  return digests.get(filePath);
}

async function downloadedDigest(assetName) {
  const temporary = path.join(os.tmpdir(), `zicode-release-asset-${randomUUID()}`);
  try {
    execFileSync(
      "gh",
      [
        "release",
        "download",
        tag,
        "--repo",
        repository,
        "--pattern",
        assetName,
        "--output",
        temporary,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60 * 1000 },
    );
    return await fileDigest(temporary);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

let pending = [];
for (let attempt = 0; attempt < 6; attempt += 1) {
  const assets = releaseAssets();
  pending = [];
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const asset = matchingReleaseAsset(assets, path.basename(filePath));
    if (!asset || asset.size !== stat.size) {
      pending.push(filePath);
      continue;
    }
    if (typeof asset.digest === "string" && asset.digest.startsWith("sha256:")) {
      if (asset.digest !== `sha256:${await localDigest(filePath)}`) pending.push(filePath);
    } else {
      try {
        if ((await downloadedDigest(asset.name)) !== (await localDigest(filePath))) {
          pending.push(filePath);
        }
      } catch {
        pending.push(filePath);
      }
    }
  }
  if (pending.length === 0) break;
  if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 2000));
}
if (pending.length) {
  throw new Error(missingReleaseBundlesMessage(pending));
}
for (const filePath of files) {
  console.log(
    JSON.stringify({
      localName: path.basename(filePath),
      bytes: fs.statSync(filePath).size,
      sha256: await localDigest(filePath),
      verifiedDraftTag: tag,
    }),
  );
}
console.log(`Verified ${files.length} local bundle(s) against draft release ${tag}.`);

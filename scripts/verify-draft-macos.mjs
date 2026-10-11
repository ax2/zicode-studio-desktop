import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyMacosDmg } from "./verify-macos-dmg.mjs";

const tag = process.env.RELEASE_TAG;
const target = process.env.PI_TARGET_PLATFORM;
const repository = process.env.GITHUB_REPOSITORY;
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !repository) throw new Error("Invalid release identity");
const suffix = { "darwin-arm64": "aarch64", "darwin-x64": "x64" }[target];
if (!suffix) throw new Error("Expected a macOS target");
const version = tag.slice(1);
const name = `ZiCode.Studio.Desktop_${version}_${suffix}.dmg`;
const metadata = JSON.parse(
  execFileSync(
    "gh",
    ["release", "view", tag, "--repo", repository, "--json", "isDraft,tagName,assets"],
    { encoding: "utf8", timeout: 30_000 },
  ),
);
if (!metadata.isDraft || metadata.tagName !== tag)
  throw new Error("Expected unchanged draft release");
const matches = metadata.assets.filter((asset) => asset.name === name);
if (matches.length !== 1) throw new Error("Expected exactly one architecture-specific DMG");
const asset = matches[0];
if (!/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "")) throw new Error("Missing server digest");
const directory = resolve("dmg-verification");
mkdirSync(directory, { recursive: true });
const dmg = join(directory, name);
execFileSync(
  "gh",
  ["release", "download", tag, "--repo", repository, "--pattern", name, "--output", dmg],
  { stdio: "inherit", timeout: 10 * 60_000 },
);
const hash = createHash("sha256");
for await (const chunk of createReadStream(dmg)) hash.update(chunk);
const digest = `sha256:${hash.digest("hex")}`;
if (statSync(dmg).size !== asset.size || digest !== asset.digest)
  throw new Error("DMG size/digest mismatch");
const piLock = JSON.parse(readFileSync("scripts/pi-version.json", "utf8"));
const verified = verifyMacosDmg(dmg, target, version, piLock.version);
const receipt = {
  tag,
  source: process.env.RELEASE_SOURCE_SHA,
  name,
  assetId: asset.id,
  bytes: asset.size,
  digest,
  verified,
  checkedUtc: new Date().toISOString(),
};
writeFileSync(join(directory, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));

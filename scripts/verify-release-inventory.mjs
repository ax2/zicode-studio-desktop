import { readDraftReleaseAssets } from "./release-draft-assets.mjs";

// Optional, independently verified delivery; never a wildcard ZIP exemption.
const FILE_TOOLS = {
  tag: "v0.6.5",
  name: "zicode-studio-v0.6.5-file-tools.zip",
  digest: "sha256:a06c5e9759bf028eb1b95da8a29ac5cfbeae68487b10f068c0253661e4f87163",
};

export function verifyReleaseInventory(assets, { tag, platform = "windows" }) {
  if (!["windows", "all"].includes(platform)) throw new Error("Unsupported release platform");
  if (!Array.isArray(assets)) throw new Error("Release assets are unavailable");
  const installers = { exe: 0, dmgArm64: 0, dmgX64: 0, appimage: 0, deb: 0 };
  let optionalAttachments = 0;
  for (const asset of assets) {
    if (asset?.name === FILE_TOOLS.name) {
      if (tag !== FILE_TOOLS.tag || asset.digest !== FILE_TOOLS.digest || optionalAttachments !== 0) {
        throw new Error("File tools attachment does not match its verified tag, name and GitHub digest");
      }
      optionalAttachments += 1;
      continue;
    }
    const name = asset?.name;
    if (typeof name !== "string") throw new Error("Invalid release asset name");
    if (name.endsWith("_x64-setup.exe")) installers.exe += 1;
    else if (name.endsWith("_aarch64.dmg")) installers.dmgArm64 += 1;
    else if (name.endsWith("_x64.dmg")) installers.dmgX64 += 1;
    else if (name.endsWith("_amd64.AppImage")) installers.appimage += 1;
    else if (name.endsWith("_amd64.deb")) installers.deb += 1;
    else throw new Error(`Unexpected release asset: ${name}`);
  }
  const expected = platform === "windows"
    ? { exe: 1, dmgArm64: 0, dmgX64: 0, appimage: 0, deb: 0 }
    : { exe: 1, dmgArm64: 1, dmgX64: 1, appimage: 1, deb: 1 };
  if (Object.entries(expected).some(([kind, count]) => installers[kind] !== count)) {
    throw new Error(`Draft must contain exactly the expected ${platform} installer set`);
  }
  return { installerCount: Object.values(installers).reduce((sum, count) => sum + count, 0), optionalAttachments };
}

if (import.meta.main) {
  const { GITHUB_REPOSITORY: repository, RELEASE_TAG: tag, RELEASE_PLATFORM: platform = "windows" } = process.env;
  if (!repository || !tag) throw new Error("Set GITHUB_REPOSITORY and RELEASE_TAG before verification");
  const result = verifyReleaseInventory(readDraftReleaseAssets(repository, tag), { tag, platform });
  console.log(`Verified draft ${tag}: ${result.installerCount} installer(s), ${result.optionalAttachments} pinned optional attachment(s).`);
}

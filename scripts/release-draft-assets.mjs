import { execFileSync } from "node:child_process";

export function readDraftReleaseAssets(repository, tag, execute = execFileSync) {
  // The tag REST endpoint only returns published releases. The CLI resolves
  // an authenticated draft by tag without exposing the token to this process.
  const response = execute(
    "gh",
    ["release", "view", tag, "--repo", repository, "--json", "isDraft,assets"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
  );
  const release = JSON.parse(response);
  if (release.isDraft !== true || !Array.isArray(release.assets)) {
    throw new Error("Release is not a draft or its assets are unavailable");
  }
  return release.assets;
}

export function matchingReleaseAsset(assets, localName) {
  // GitHub replaces ASCII spaces in uploaded Tauri filenames with periods.
  // Accept only the exact name or that observed normalization, then retain
  // the independent size and SHA-256 comparison in the caller.
  const uploadedName = localName.replace(/ /g, ".");
  const matches = assets.filter((asset) => asset.name === localName || asset.name === uploadedName);
  if (matches.length > 1) throw new Error(`Ambiguous release asset: ${localName}`);
  return matches[0];
}

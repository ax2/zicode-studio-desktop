import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const expected = JSON.parse(
  readFileSync(new URL("./release-repository.json", import.meta.url), "utf8"),
).repository;
if (typeof expected !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(expected)) {
  throw new Error("Invalid release repository configuration");
}

function remoteUrls(...args) {
  return execFileSync("git", ["remote", "get-url", ...args, "origin"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
}

function repositoryFromUrl(remote) {
  const scp = /^git@github\.com:([^\s]+)$/i.exec(remote);
  if (scp) return scp[1].replace(/\.git$/i, "");
  try {
    const url = new URL(remote);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    if (url.protocol !== "https:" && url.protocol !== "ssh:") return null;
    return url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  } catch {
    return null;
  }
}

const mode = process.argv[2];
if (mode !== "--local" && mode !== "--ci") {
  throw new Error("Usage: check-release-repository.mjs --local|--ci");
}
const actual =
  mode === "--ci"
    ? [process.env.GITHUB_REPOSITORY]
    : [...remoteUrls(), ...remoteUrls("--push", "--all")].map(repositoryFromUrl);
if (
  actual.length === 0 ||
  actual.some((repository) => repository?.toLowerCase() !== expected.toLowerCase())
) {
  throw new Error(
    `Release repository mismatch: expected ${expected}, found ${actual.map((repository) => repository || "<unrecognized>").join(", ")}`,
  );
}
console.log(`Release repository ${expected} confirmed.`);

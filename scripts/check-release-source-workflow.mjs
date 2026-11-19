import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// The v0.6.7 release line adopted the verified publisher before main added this
// compatibility check. Other workflow revisions need a fresh review on main.
const reviewedReleaseWorkflow = "2a333065442f7561bb4469a397f4ff23fc3e2244";

export function requireReviewedWorkflow(candidate, dispatch) {
  if (/^[a-f0-9]{40}$/.test(candidate) && (candidate === dispatch || candidate === reviewedReleaseWorkflow)) return;
  throw Error("This tag does not contain a reviewed release workflow. Select a tag with the verified publisher, or update the reviewed workflow on main.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = (...args) => execFileSync("git", args, {encoding:"utf8"}).trim();
  requireReviewedWorkflow(git("rev-parse", "--verify", "HEAD:.github/workflows/release.yml"), git("hash-object", process.argv[2]));
  for (const path of ["scripts/export-windows-candidate.ps1", "src-tauri/tauri.shell.windows.conf.json"]) {
    git("cat-file", "-e", "HEAD:" + path);
  }
}

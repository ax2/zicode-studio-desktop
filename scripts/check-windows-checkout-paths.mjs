import { execFileSync } from "node:child_process";
import { win32 } from "node:path";

const MAX_PATH = 260;
const [requestedRoot, revision = "HEAD", ...extra] = process.argv.slice(2);

function main() {
  const root = requestedRoot && win32.normalize(requestedRoot);
  if (!root || !win32.isAbsolute(root) || win32.parse(root).root === "\\" ||
      root.startsWith("\\\\?\\") || root.startsWith("\\\\.\\") || extra.length) {
    console.error("Usage: bun scripts/check-windows-checkout-paths.mjs <absolute Windows checkout root> [revision]");
    return 2;
  }

  let paths;
  try {
    const git = (args) => execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tree = git(["rev-parse", "--verify", "--end-of-options", revision + "^{tree}"]).trim();
    paths = git(["ls-tree", "--full-tree", "-r", "--name-only", "-z", tree]).split("\0").filter(Boolean);
  } catch {
    console.error("Could not read the Git tree for " + JSON.stringify(revision) + ". Use an available revision in a Git checkout.");
    return 2;
  }

  let longest = 0;
  const exceeding = [];
  for (const path of paths) {
    const length = win32.join(root, path).length;
    longest = Math.max(longest, length);
    if (length >= MAX_PATH) exceeding.push({ path, length });
  }
  console.log("Checkout root: " + JSON.stringify(root));
  console.log("Longest absolute path: " + longest + " UTF-16 code units");
  console.log(exceeding.length + " / " + paths.length + " tracked paths are too long for classic MAX_PATH (" + MAX_PATH + " including the trailing NUL).");
  for (const { path, length } of exceeding.sort((a, b) => b.length - a.length).slice(0, 5)) {
    console.log(length + " " + JSON.stringify(path));
  }
  return exceeding.length ? 1 : 0;
}

process.exitCode = main();

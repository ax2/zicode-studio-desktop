// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-windows-checkout-paths.mjs", import.meta.url));
const filename = "nested/空 格📄.txt";
const tempRoot = resolve(tmpdir());
const prefix = "studio-checkout-budget-";
let repository;

beforeAll(() => {
  repository = mkdtempSync(join(tempRoot, prefix));
  const git = (...args) => execFileSync("git", [
    "-c", "core.hooksPath=" + join(repository, "no-hooks"),
    "-c", "core.autocrlf=false", "-c", "commit.gpgSign=false",
    "-c", "user.name=Checkout test", "-c", "user.email=checkout@example.invalid",
    ...args,
  ], { cwd: repository });
  git("init", "--quiet");
  writeFileSync(join(repository, "README.md"), "Fixture\n");
  git("add", "README.md");
  git("commit", "--quiet", "-m", "Short tree");
  mkdirSync(join(repository, "nested"));
  writeFileSync(join(repository, filename), "Fixture\n");
  git("add", "--", filename);
  git("commit", "--quiet", "-m", "Longer path with space and Unicode");
});

afterAll(() => {
  if (repository && dirname(repository) === tempRoot && basename(repository).startsWith(prefix)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

const run = (...args) => spawnSync(process.execPath, [script, ...args], {
  cwd: join(repository, "nested"), encoding: "utf8",
});
const safeRoot = "C:\\" + "a".repeat(259 - win32.join("C:\\a", filename).length + 1);

it("counts real tracked paths from a Git subdirectory and accepts the last safe length", () => {
  const result = run(safeRoot);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Longest absolute path: 259 UTF-16 code units");
  expect(result.stdout).toContain("0 / 2 tracked paths");
});

it("warns at 260 and preserves the names of paths with spaces, Chinese and a surrogate pair", () => {
  const result = run(safeRoot + "a");
  expect(result.status, result.stderr).toBe(1);
  expect(result.stdout).toContain("Longest absolute path: 260 UTF-16 code units");
  expect(result.stdout).toContain("1 / 2 tracked paths");
  expect(result.stdout).toContain("260 " + JSON.stringify(filename));
});

it("uses the requested Git tree instead of files present in the working directory", () => {
  const result = run(safeRoot + "a", "HEAD^");
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("0 / 1 tracked paths");
  expect(result.stdout).not.toContain(filename);
});

it("reports an unusable root or revision with an error separate from the path budget", () => {
  const noRoot = run("relative\\checkout");
  expect(noRoot.status).toBe(2);
  expect(noRoot.stderr).toContain("absolute Windows checkout root");
  const noTree = run(safeRoot, "--help");
  expect(noTree.status).toBe(2);
  expect(noTree.stderr).toContain("Could not read the Git tree");
});

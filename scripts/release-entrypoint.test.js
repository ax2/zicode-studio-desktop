// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const runs = [];
afterEach(() => {
  for (const root of runs.splice(0)) rmSync(root, { recursive: true, force: true });
});
function repo() {
  const root = mkdtempSync(join(tmpdir(), "studio-release-entry-"));
  runs.push(root);
  const source = join(root, "source"),
    remote = join(root, "remote.git"),
    scripts = join(source, "scripts");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(source, "docs/releases"), { recursive: true });
  mkdirSync(join(source, "src-tauri"));
  const env = {
    ...process.env,
    GIT_ALLOW_PROTOCOL: "file",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "unused.gitconfig"),
    GIT_TERMINAL_PROMPT: "0",
  };
  const opts = { cwd: source, env, encoding: "utf8" };
  const git = (...args) => execFileSync("git", args, opts).trim();
  git("init", "--quiet", "-b", "release");
  git("init", "--quiet", "--bare", remote);
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", remote);
  const put = (name, data) => writeFileSync(join(source, name), data);
  for (const file of ["release.sh", "check-release-version.js", "check-release-notes-inputs.mjs"])
    copyFileSync(fileURLToPath(new URL(file, import.meta.url)), join(scripts, file));
  // Repository identity is the only substituted gate. All git operations are real and file-only.
  put(
    "scripts/check-release-repository.mjs",
    'if(process.env.GIT_ALLOW_PROTOCOL!=="file")process.exit(1);',
  );
  put(
    "package.json",
    JSON.stringify({
      name: "fixture",
      version: "0.6.7",
      scripts: Object.fromEntries(
        ["test", "typecheck", "lint", "check:design"].map((k) => [k, 'node -e "console.log(123)"']),
      ),
    }),
  );
  put("src-tauri/tauri.conf.json", '{"version":"0.6.7"}');
  put("src-tauri/Cargo.toml", '[package]\nname = "zicode-studio-desktop"\nversion = "0.6.7"\n');
  put("src-tauri/Cargo.lock", '[[package]]\nname = "zicode-studio-desktop"\nversion = "0.6.7"\n');
  put("bun.lock", "");
  put("docs/releases/v0.6.7.md", "Frozen release notes");
  put(
    "docs/releases/v0.6.7.issues.json",
    JSON.stringify({ milestones: ["v0.6.7"], extraCompleted: [], known: [], exclude: {} }),
  );
  git("add", ".");
  git("commit", "--quiet", "-m", "Freeze candidate");
  let bash = "bash";
  if (process.platform === "win32") {
    const found = execFileSync("where.exe", ["git.exe"], opts).trim().split(/\r?\n/);
    bash = found.map((p) => join(dirname(dirname(p)), "bin", "bash.exe")).find(existsSync) || bash;
  }
  return {
    git,
    source,
    run: () => spawnSync(bash, ["scripts/release.sh", "v0.6.7"], { ...opts, timeout: 60000 }),
  };
}
it("tags an already frozen commit and pushes only to the disposable file remote", () => {
  const { git, run } = repo(),
    before = git("rev-parse", "HEAD"),
    result = run();
  expect(result.status, result.stderr + result.stdout).toBe(0);
  expect(git("rev-parse", "HEAD")).toBe(before);
  expect(git("rev-parse", "v0.6.7")).toBe(before);
  expect(git("ls-remote", "--tags", "origin", "refs/tags/v0.6.7")).toContain(before);
  expect(git("status", "--porcelain")).toBe("");
}, 65000);
it.each([
  "v0.6.7.md",
  "v0.6.7.issues.json",
])("missing %s stops before costly gates and never sends a tag", (file) => {
  const { git, run } = repo();
  git("rm", `docs/releases/${file}`);
  git("commit", "--quiet", "-m", "missing input");
  const result = run();
  expect(result.status).not.toBe(0);
  expect(result.stderr + result.stdout).toContain("Missing release input");
  expect(result.stdout).not.toContain("Running release gates");
  expect(git("ls-remote", "--tags", "origin")).toBe("");
}, 65000);

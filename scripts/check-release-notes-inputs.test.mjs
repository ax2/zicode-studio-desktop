import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("checks the selected product inputs without consulting the tag workflow", t => {
  const root = mkdtempSync(join(tmpdir(), "studio-candidate-inputs-"));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  for (const subdir of ["docs/releases", "scripts", "src-tauri"]) mkdirSync(join(root, subdir), {recursive:true});
  const script = fileURLToPath(new URL("./check-release-notes-inputs.mjs", import.meta.url));
  const output = join(root, "outputs");
  const check = (platform, publishing = false, tag = "v1.2.3") =>
    spawnSync(process.execPath, [script, tag, platform, String(publishing)], {
      cwd: root, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output },
    });
  assert.match(check("windows").stderr, /Missing release input/);
  writeFileSync(join(root, "docs/releases/v1.2.3.md"), "Version notes");
  writeFileSync(join(root, "docs/releases/v1.2.3.issues.json"), '{"milestones":["v1.2.3"],"extraCompleted":[],"known":[],"exclude":{}}');
  assert.equal(check("macos-intel").status, 0);
  assert.match(check("windows").stderr, /export-windows-candidate/);
  writeFileSync(join(root, "scripts/export-windows-candidate.ps1"), "# fixture");
  assert.match(check("all").stderr, /tauri.shell.windows.conf/);
  writeFileSync(join(root, "src-tauri/tauri.shell.windows.conf.json"), "{}");
  assert.equal(check("windows").status, 0);
  assert.equal(check("all").status, 0);
  assert.match(check("windows", true).stderr, /Windows upgrade baseline is required/);
  assert.equal(check("macos-intel", true).status, 0);
  assert.equal(check("windows", false).status, 0);

  const plan = { milestones: ["v1.2.3"], extraCompleted: [], known: [], exclude: {} };
  const planFile = join(root, "docs/releases/v1.2.3.issues.json");
  const setBaseline = (version, sha256) =>
    writeFileSync(planFile, JSON.stringify({ ...plan, windowsUpgradeFrom: { version, sha256 } }));
  setBaseline("1.2.3", "a".repeat(64));
  assert.match(check("windows", true).stderr, /Invalid Windows upgrade baseline/);
  setBaseline("1.2.2", "not-a-digest");
  assert.match(check("windows", true).stderr, /Invalid Windows upgrade baseline/);
  setBaseline("1.2.2", "b".repeat(64));
  assert.equal(check("windows", true).status, 0);
  assert.equal(readFileSync(output, "utf8"), `windows_baseline_version=1.2.2\nwindows_baseline_sha256=${"b".repeat(64)}\n`);

  writeFileSync(join(root, "docs/releases/v0.7.7.md"), "Historical notes");
  writeFileSync(join(root, "docs/releases/v0.7.7.issues.json"), JSON.stringify({ ...plan, milestones: ["v0.7.7"] }));
  assert.equal(check("windows", true, "v0.7.7").status, 0);
});

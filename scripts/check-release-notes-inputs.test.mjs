import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("checks the selected product inputs without consulting the tag workflow", t => {
  const root = mkdtempSync(join(tmpdir(), "studio-candidate-inputs-"));
  t.after(() => rmSync(root, {recursive:true, force:true}));
  for (const subdir of ["docs/releases", "scripts", "src-tauri"]) mkdirSync(join(root, subdir), {recursive:true});
  const script = fileURLToPath(new URL("./check-release-notes-inputs.mjs", import.meta.url));
  const check = platform => spawnSync(process.execPath, [script, "v1.2.3", platform], {cwd:root, encoding:"utf8"});
  assert.match(check("windows").stderr, /Missing release input/);
  writeFileSync(join(root, "docs/releases/v1.2.3.md"), "Version notes");
  writeFileSync(join(root, "docs/releases/v1.2.3.issues.json"), '{"milestones":["v1.2.3"]}');
  assert.equal(check("macos-intel").status, 0);
  assert.match(check("windows").stderr, /export-windows-candidate/);
  writeFileSync(join(root, "scripts/export-windows-candidate.ps1"), "# fixture");
  assert.match(check("all").stderr, /tauri.shell.windows.conf/);
  writeFileSync(join(root, "src-tauri/tauri.shell.windows.conf.json"), "{}");
  assert.equal(check("windows").status, 0);
  assert.equal(check("all").status, 0);
});

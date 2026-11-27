import assert from "node:assert/strict";
import { test } from "node:test";
import { changedFiles, classify } from "./windows-light-checks.mjs";

const base = "b".repeat(40);

test("a documentation-only change leaves an always-present job with no product checks", () => {
  assert.deepEqual(classify(["README.md", "docs/example.md", "docs/releases/v0.7.9.issues.json"]), {
    files: ["README.md", "docs/example.md", "docs/releases/v0.7.9.issues.json"],
    rust: false, design: false, piAlignment: false, lintAll: false,
    lint: [], types: [], vitest: [], nodeTests: [],
  });
});

test("Notes TSX runs types, lint, design and its feature tests without Rust", () => {
  const file = "frontend/src/features/notes/NotesApp.tsx";
  const plan = classify([file]);
  assert.deepEqual(plan.types, ["typecheck"]);
  assert.deepEqual(plan.lint, [file]);
  assert.deepEqual(plan.vitest, ["frontend/src/features/notes/"]);
  assert.equal(plan.design, true);
  assert.equal(plan.rust, false);
});

test("the production tool-center bundle selects source feature tests and no bundle lint", () => {
  const plan = classify(["public/native/react/tool-center.js"]);
  assert.deepEqual(plan.lint, []);
  assert.ok(plan.vitest.includes("frontend/src/features/toolCenter/"));
  assert.ok(plan.vitest.includes("public/native/layout-contract.test.js"));
  assert.equal(plan.rust, false);
});

test("terminal JS and CSS both select the projects feature that builds them", () => {
  for (const extension of ["js", "css"]) {
    const plan = classify([`public/native/react/project-terminal-engine.${extension}`]);
    assert.ok(plan.vitest.includes("frontend/src/features/projects/"));
    assert.ok(!plan.vitest.includes("frontend/src/features/projectTerminalEngine/"));
  }
});

test("mobile changes select the tests that import the generated modules", () => {
  for (const name of ["mobile-experience", "mobile-task-notifications", "mobile-storage-persistence"]) {
    const testFile = `public/native/features/${name}.test.js`;
    assert.ok(classify([`public/native/react/${name}.js`]).vitest.includes(testFile));
    assert.ok(classify(["frontend/src/features/mobileExperience/index.ts"]).vitest.includes(testFile));
  }
});

test("Rust and native build wiring get a Windows check without unrelated frontend tests", () => {
  for (const file of ["src-tauri/src/main.rs", "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.lock", ".cargo/config.toml", "vendor/tray-icon/src/lib.rs", "scripts/build-desktop.js"]) {
    assert.equal(classify([file]).rust, true, file);
  }
  for (const file of ["public/native/browser/browser-app.js", "frontend/src/features/habits/HabitsApp.tsx",
    ".github/workflows/release.yml", "src-tauri/README.md", "docs/ci.md", "bun.lock"]) {
    assert.equal(classify([file]).rust, false, file);
  }
  const plan = classify(["src-tauri/src/host_server.rs", "src-tauri/permissions/default.toml"]);
  assert.deepEqual(plan.types, []);
  assert.deepEqual(plan.vitest, []);
  assert.equal(plan.design, false);
});

test("browser engine scripts and workflow changes select production and workflow regressions", () => {
  const browser = classify(["src-tauri/src/browser/capture.js"]);
  assert.equal(browser.rust, true);
  assert.deepEqual(browser.vitest, ["public/native/browser/"]);
  const workflow = classify([".github/workflows/windows-light-checks.yml", "scripts/windows-light-checks.mjs"]);
  assert.deepEqual(workflow.vitest, ["scripts/workflow-triggers.test.js"]);
  assert.deepEqual(workflow.nodeTests, ["scripts/windows-light-checks.test.mjs"]);
  assert.equal(workflow.rust, false);
});

test("dependency and TypeScript config changes select shared checks without Rust", () => {
  const plan = classify(["bun.lock", "tsconfig.extensions-source.json"]);
  assert.equal(plan.rust, false);
  assert.equal(plan.lintAll, true);
  assert.ok(plan.vitest.includes("scripts/workflow-triggers.test.js"));
  assert.ok(plan.types.includes("typecheck"));
  assert.ok(plan.types.includes("typecheck:extensions-source"));
});

test("push diffs from the event's previous tip, including renamed and deleted paths", () => {
  const calls = [];
  const files = changedFiles({ before: base }, "push", (...args) => {
    calls.push(args);
    if (args[0] === "cat-file") return { status: 0 };
    return { status: 0, stdout: "docs/原 文件.md\0frontend/src/features/notes/Old.tsx\0public/native/browser/new.js\0" };
  });
  assert.deepEqual(files, ["docs/原 文件.md", "frontend/src/features/notes/Old.tsx", "public/native/browser/new.js"]);
  assert.deepEqual(calls[1], ["diff", "--no-renames", "--name-only", "-z", base, "HEAD", "--"]);
});

test("pull requests compare the base SHA to the checked-out merge and fetch a shallow base once", () => {
  const calls = [];
  const files = changedFiles({ pull_request: { base: { sha: base } } }, "pull_request", (...args) => {
    calls.push(args);
    return args[0] === "cat-file" ? { status: 1 } : { status: 0, stdout: "public/style.css\0" };
  });
  assert.deepEqual(files, ["public/style.css"]);
  assert.deepEqual(calls, [
    ["cat-file", "-e", `${base}^{commit}`],
    ["fetch", "--no-tags", "--depth=1", "origin", base],
    ["diff", "--no-renames", "--name-only", "-z", base, "HEAD", "--"],
  ]);
});

test("base is validated and an unsuccessful Git fetch cannot appear docs-only", () => {
  assert.equal(changedFiles({ before: "--output=bad" }, "push", () => assert.fail("unexpected Git call")), null);
  assert.equal(changedFiles({ before: "0".repeat(40) }, "push", () => assert.fail("unexpected Git call")), null);
  assert.equal(changedFiles({ before: base }, "push", () => ({ status: 1 })), null);
});

test("a domain dictionary change runs localization and dictionary diagnostics", () => {
  const plan = classify(["public/locales/zh-CN/blog.js"]);
  assert.ok(plan.vitest.includes("public/i18n"));
  assert.ok(plan.nodeTests.includes("scripts/i18n-dictionary-errors.test.mjs"));
  assert.equal(plan.rust, false);
});

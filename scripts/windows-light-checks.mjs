#!/usr/bin/env node
// Keep the always-present Windows job cheap by selecting checks after checkout.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import featureEntries from "./react-feature-entries.cjs";

const platformTypes = [
  "typecheck",
  "typecheck:external-clients",
  "typecheck:finance-core",
  "typecheck:chat-inbox-core",
  "typecheck:platform-core",
  "typecheck:extensions-source",
];
const shellTests = ["public/native/layout-contract.test.js", "public/native/localization-contract.test.js"];
const sharedTests = [...shellTests, "frontend/src/shared/", "scripts/workflow-triggers.test.js"];
const workflowTests = ["scripts/workflow-triggers.test.js"];
const plannerTests = "scripts/windows-light-checks.test.mjs";
const isCommit = value => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) && !/^0+$/.test(value);
const designAsset = /\.(?:css|html|tsx|jsx)$/;
const lintAsset = /\.(?:[cm]?js|jsx|ts|tsx|jsonc?|css)$/;
const noLint = /^(?:public\/(?:vendor|native\/react)\/|src-tauri\/(?:resources|gen)\/|extensions\/dist\/|tests\/fixtures\/devtools-)/;
const rustArea = /^(?:src-tauri\/|\.cargo\/|vendor\/tray-icon\/|Cargo\.(?:toml|lock)$|rust-toolchain(?:\.toml)?$|scripts\/(?:build-desktop\.|build-windows-shell\.|check-rust\.|pi-version\.json$))/;

function selectBundleTests(tests, name) {
  const entry = Object.hasOwn(featureEntries, name) && featureEntries[name];
  if (entry) tests.add(`frontend/src/features/${entry.split("/")[0]}/`);
  if (name === "vendor") tests.add("frontend/src/shared/");
  const integration = `public/native/features/${name}.test.js`;
  if (existsSync(new URL(`../${integration}`, import.meta.url))) tests.add(integration);
}

export function classify(paths) {
  const files = [...new Set(paths)].sort();
  const broad = files.some(file =>
    /^(?:package\.json|bun\.lock|vitest\.config\.[^/]+|tsconfig(?:\.[^/]+)?\.json)$/.test(file));
  const types = new Set(broad ? platformTypes : []);
  const vitest = new Set(broad ? sharedTests : []);
  const nodeTests = new Set();
  const lint = [];
  let design = broad;
  let rust = false;
  let piAlignment = broad;

  for (const file of files) {
    if (rustArea.test(file) && !/\.(?:md|txt)$/.test(file)) rust = true;
    if (file.startsWith("frontend/")) types.add("typecheck");
    if (file.startsWith("extensions/") && !file.startsWith("extensions/dist/")) {
      types.add("typecheck:extensions-source");
      if (file.startsWith("extensions/finance/")) types.add("typecheck:finance-core");
      if (file.startsWith("extensions/chat-inbox/")) types.add("typecheck:chat-inbox-core");
      if (/^extensions\/[^/]+\.ts$/.test(file)) {
        types.add("typecheck:external-clients");
        types.add("typecheck:platform-core");
      }
    }
    if ((file.startsWith("frontend/") || file.startsWith("public/")) && designAsset.test(file)) design = true;
    if (/^(?:scripts\/pi-version\.json|extensions\/package\.json|frontend\/package\.json)$/.test(file)) piAlignment = true;
    if (file === "biome.json" || (lintAsset.test(file) && /^(?:frontend\/|public\/|extensions\/|scripts\/)/.test(file) && !noLint.test(file))) {
      lint.push(file);
    }

    const feature = file.match(/^(frontend\/src\/features\/[^/]+\/|public\/native\/(?:browser|features|plugins|transport|extensions|models|composer|notifications)\/|extensions\/(?:finance|chat-inbox)\/)/);
    const bundle = file.match(/^public\/native\/react\/([\w-]+)\.(?:js|css)$/);
    if (feature) {
      vitest.add(feature[1]);
      if (file.startsWith("frontend/src/features/")) {
        for (const [name, entry] of Object.entries(featureEntries)) {
          if (`frontend/src/features/${entry}`.startsWith(feature[1])) selectBundleTests(vitest, name);
        }
      }
    } else if (file.startsWith("frontend/src/")) vitest.add("frontend/src/shared/");
    else if (bundle) {
      selectBundleTests(vitest, bundle[1]);
      for (const test of shellTests) vitest.add(test);
    } else if (file.startsWith("public/locales/") || file === "scripts/i18n-dictionary-errors.mjs") {
      vitest.add("public/i18n");
      nodeTests.add("scripts/i18n-dictionary-errors.test.mjs");
    } else if (file === "public/i18n.js" || file === "public/themes.js" || /^public\/[^/]+\.(?:css|html)$/.test(file)) {
      for (const test of shellTests) vitest.add(test);
    } else if (/^public\/native\/[^/]+\.js$/.test(file)) {
      vitest.add(file.endsWith(".test.js") ? file : file.replace(/\.js$/, ".test.js"));
      for (const test of shellTests) vitest.add(test);
    } else if (/^extensions\/[^/]+\.ts$/.test(file)) {
      vitest.add(file.endsWith(".test.ts") ? file : file.replace(/\.ts$/, ".test.ts"));
    }

    if (file.startsWith("src-tauri/src/browser/") && file.endsWith(".js")) vitest.add("public/native/browser/");
    if (file.startsWith("tests/fixtures/devtools-")) vitest.add("public/native/plugins/");
    if (file.startsWith(".github/workflows/") || file.startsWith("scripts/windows-light-checks.")
        || file === "scripts/react-feature-entries.cjs" || file === "scripts/build-react.js") {
      for (const test of workflowTests) vitest.add(test);
      nodeTests.add(plannerTests);
    } else if (/^scripts\/[^/]+\.(?:[cm]?js)$/.test(file)) {
      const stem = file.replace(/(?:\.test)?\.(?:[cm]?js)$/, "");
      vitest.add(`${stem}.test.js`);
      nodeTests.add(`${stem}.test.mjs`);
    }
  }

  return {
    files,
    rust,
    design,
    piAlignment,
    lintAll: broad || files.includes("biome.json"),
    lint,
    types: [...types],
    vitest: [...vitest],
    nodeTests: [...nodeTests],
  };
}

function invokeGit(...args) {
  // Git sends UTF-8 names when -z is used. Never interpolate paths into a shell.
  return spawnSync("git", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}

export function changedFiles(event, name, git = invokeGit) {
  const before = name === "pull_request" ? event.pull_request?.base?.sha : event.before;
  if (!isCommit(before)) return null;
  if (git("cat-file", "-e", `${before}^{commit}`).status !== 0) {
    if (git("fetch", "--no-tags", "--depth=1", "origin", before).status !== 0) return null;
  }
  const diff = git("diff", "--no-renames", "--name-only", "-z", before, "HEAD", "--");
  return diff.status === 0 ? diff.stdout.split("\0").filter(Boolean) : null;
}

const needsDependencies = plan => plan.lintAll || plan.lint.length > 0 ||
  plan.types.length > 0 || plan.vitest.length > 0;
const hasBunChecks = plan => plan.rust || plan.design || plan.piAlignment || needsDependencies(plan);
const localFile = path => existsSync(`./${path}`);

function report(plan) {
  const sections = [
    plan.types.length > 0 && "TypeScript",
    (plan.lintAll || plan.lint.length > 0) && "Lint",
    plan.design && "Design",
    plan.piAlignment && "Pi/SDK alignment",
    plan.vitest.length > 0 && "Targeted Vitest",
    plan.nodeTests.some(localFile) && "Targeted Node tests",
    plan.rust && "Windows Cargo check and host policy",
  ].filter(Boolean);
  const note =
    sections.length ? `Selected ${sections.join(", ")} for ${plan.files.length} changed path(s).` :
      `No product checks needed for ${plan.files.length} changed path(s).`;
  console.log(note);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${note}\n`);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.signal})`);
  }
}

export function checks(plan) {
  for (const script of plan.types) run("bun", ["run", script]);
  if (plan.lintAll) run("bun", ["run", "lint"]);
  else {
    const lint = plan.lint.filter(localFile);
    for (let index = 0; index < lint.length; index += 40) {
      run("bun", ["x", "--no-install", "biome", "lint", "--no-errors-on-unmatched",
        ...lint.slice(index, index + 40).map(path => `./${path}`)]);
    }
  }
  if (plan.design) run("bun", ["run", "check:design"]);
  if (plan.piAlignment) run("bun", ["run", "check:pi-sdk-alignment"]);
  if (plan.vitest.length) {
    run(process.execPath, ["./node_modules/vitest/vitest.mjs", "run", "--passWithNoTests", ...plan.vitest]);
  }
  const nodeTests = plan.nodeTests.filter(localFile);
  if (nodeTests.length) run(process.execPath, ["--test", ...nodeTests]);
  if (plan.rust) {
    run("bun", ["run", "check:permissions"]);
    run("bun", ["run", "check:windows-subprocesses"]);
  }
}

function main() {
  const [mode, file] = process.argv.slice(2);
  if (!file) throw new Error("Specify a check plan path");
  if (mode === "plan") {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const changes = changedFiles(event, process.env.GITHUB_EVENT_NAME);
    if (changes === null) {
      throw new Error("Cannot read the exact Git change range for Windows lightweight checks");
    }
    const plan = classify(changes);
    writeFileSync(file, `${JSON.stringify(plan, null, 2)}\n`);
    report(plan);
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `bun_checks=${hasBunChecks(plan)}\ndependencies=${needsDependencies(plan)}\nrust=${plan.rust}\n`);
    }
  } else if (mode === "check") {
    checks(JSON.parse(readFileSync(file, "utf8")));
  } else {
    throw new Error("Unknown lightweight check mode");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

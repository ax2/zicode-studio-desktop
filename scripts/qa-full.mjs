#!/usr/bin/env node
// Run the three browser QA sweeps in one command. The workspace defaults to
// ZICODE_WORKSPACE, the first CLI argument, or the first workspace directory
// under %LOCALAPPDATA%\zicode\workspaces; each script resolves a folder name
// to a stable UUID and discovers the most recent session automatically.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const workspacesRoot = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, "zicode", "workspaces")
  : null;

function defaultWorkspace() {
  if (!workspacesRoot) return null;
  try {
    return (
      readdirSync(workspacesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)[0] ?? null
    );
  } catch {
    return null;
  }
}

function runScript(script, args) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [["scripts", script].join("/"), ...args],
      { stdio: "inherit", env: process.env },
    );
    child.on("close", (code) => resolve(code ?? 1));
  });
}

const workspace =
  process.env.ZICODE_WORKSPACE || process.argv[2] || defaultWorkspace();
if (!workspace) {
  console.error(
    "[qa-full] Could not determine a workspace. Pass one explicitly or set ZICODE_WORKSPACE.",
  );
  process.exit(2);
}
console.log(`[qa-full] workspace: ${workspace}`);

const allScripts = [
  "visual-qa.mjs",
  "qa-a11y.mjs",
  "qa-keyboard.mjs",
  "qa-onboarding.mjs",
  "qa-composer-model.mjs",
  "qa-lan-qr.mjs",
  "qa-notes-flow.mjs",
  "qa-artifacts-flow.mjs",
  "qa-automation-flow.mjs",
  "qa-backup-flow.mjs",
  "qa-articles-flow.mjs",
  "qa-task-flow.mjs",
  "qa-workspace-trash-ui.mjs",
  "qa-locale.mjs",
  "qa-chat-templates.mjs",
];
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length) : process.env.QA_ONLY;
const normalizedOnly = only?.replace(/\.mjs$/, "");
const scripts = normalizedOnly
  ? allScripts.filter((script) => script.replace(/\.mjs$/, "") === normalizedOnly)
  : allScripts;
if (normalizedOnly && scripts.length === 0) {
  console.error(`[qa-full] unknown script "${only}". Use --only=<name> or QA_ONLY=<name>.`);
  process.exit(2);
}
if (normalizedOnly) console.log(`[qa-full] running only ${normalizedOnly}`);
for (const script of scripts) {
  const code = await runScript(script, [workspace]);
  if (code !== 0) {
    console.error(`[qa-full] ${script} FAILED (exit ${code})`);
    process.exit(code);
  }
  console.log(`[qa-full] ${script} passed`);
}
console.log("[qa-full] all browser QA sweeps passed");

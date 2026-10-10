import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "src-tauri/Cargo.toml";
const TOOLCHAIN_TEST = "project_tasks::multilanguage_tests::checks_real_cargo_and_go_projects";
const TARGET_REPOSITORY = JSON.parse(
  readFileSync(join(ROOT, "scripts", "release-repository.json"), "utf8"),
).repository;
if (typeof TARGET_REPOSITORY !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(TARGET_REPOSITORY)) {
  throw new Error("Invalid developer platform repository configuration");
}

export const CHECKS = [
  { id: "embedded-pi-resource", command: "bun", args: ["run", "fetch:pi"] },
  { id: "bundled-extension-resources", command: "bun", args: ["run", "build:extensions"] },
  { id: "typescript", command: "bun", args: ["run", "typecheck"] },
  {
    id: "external-clients-typescript",
    command: "bun",
    args: ["run", "typecheck:external-clients"],
  },
  { id: "finance-core-typescript", command: "bun", args: ["run", "typecheck:finance-core"] },
  {
    id: "chat-inbox-core-typescript",
    command: "bun",
    args: ["run", "typecheck:chat-inbox-core"],
  },
  { id: "platform-core-typescript", command: "bun", args: ["run", "typecheck:platform-core"] },
  {
    id: "extension-entrypoints-typescript",
    command: "bun",
    args: ["run", "typecheck:extensions-source"],
  },
  { id: "lint-design", command: "bun", args: ["run", "check"] },
  { id: "javascript-full-suite", command: "bun", args: ["run", "test"] },
  {
    id: "project-ui-gateways",
    command: "bun",
    args: [
      "run",
      "vitest",
      "run",
      "frontend/src",
      "public/native/plugins/notes-gateway.test.js",
      "public/native/features/project-work-navigation.test.js",
      "public/super-agent/task-store.test.js",
      "public/super-agent/native-dispatch.test.js",
      "public/super-agent/task-state.test.js",
      "public/components/super-agent-runtime.test.js",
      "extensions/task-repository.test.ts",
      "extensions/task-drafts.test.ts",
      "extensions/picot-config.test.ts",
      "extensions/model-channels.test.ts",
      "public/native/transport/project-task-gateway.test.js",
      "public/native/transport/project-terminal-gateway.test.js",
      "public/native/transport/project-environment-gateway.test.js",
      "public/native/transport/control-gateway.test.js",
      "public/native/transport/data-gateway.test.js",
      "scripts/developer-platform-checks.test.js",
      "scripts/release-artifact-policy.test.js",
      "scripts/executable-architecture.test.js",
      "scripts/smoke-runtime-environment.test.js",
    ],
  },
  { id: "tauri-permissions", command: "bun", args: ["run", "check:permissions"] },
  { id: "windows-subprocess-policy", command: "bun", args: ["run", "check:windows-subprocesses"] },
  { id: "translations", command: "bun", args: ["scripts/check-i18n-coverage.mjs"] },
  {
    id: "rust-check",
    command: "cargo",
    args: ["check", "--manifest-path", MANIFEST, "--locked", "--all-targets"],
  },
  { id: "rust-tests", command: "cargo", args: ["test", "--manifest-path", MANIFEST, "--locked"] },
  {
    id: "embedded-pi-host-plugin",
    command: "cargo",
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::plugin_broker_tests::embedded_pi_invokes_the_real_host_plugin_broker",
      "--", "--ignored", "--exact"],
  },
  {
    id: "cargo-go-lifecycle",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      MANIFEST,
      "--locked",
      TOOLCHAIN_TEST,
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
  },
  {
    id: "clippy",
    command: "cargo",
    args: [
      "clippy",
      "--manifest-path",
      MANIFEST,
      "--locked",
      "--all-targets",
      "--",
      "-D",
      "warnings",
    ],
  },
  {
    id: "python-venv-lifecycle",
    command: "cargo",
    args: [
      "test",
      "--manifest-path",
      MANIFEST,
      "--locked",
      "project_tasks::python_tests::runs_unittest_with_a_real_project_environment",
      "--",
      "--ignored",
      "--exact",
      "--nocapture",
    ],
  },
  {
    id: "rust-format",
    command: "cargo",
    args: ["fmt", "--manifest-path", MANIFEST, "--", "--check"],
    advisory: true,
  },
];

export function outcome(result, advisory = false) {
  const ok = !result.error && !result.signal && result.status === 0;
  return ok ? "passed" : advisory ? "warning" : "failed";
}

export function aggregateStatus(steps) {
  if (!steps.length || steps.some((step) => !["passed", "warning"].includes(step.status)))
    return "failed";
  return steps.some((step) => step.status === "warning") ? "passed_with_warnings" : "passed";
}

export function runStep(step, { cwd, directory, env, spawn = spawnSync }) {
  const started = Date.now();
  const log = `${step.id}.log`;
  const fd = openSync(join(directory, log), "w");
  let result;
  try {
    result = spawn(step.command, step.args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      timeout: 30 * 60 * 1000,
    });
  } catch (error) {
    result = { error, status: null };
  } finally {
    closeSync(fd);
  }
  return {
    id: step.id,
    command: [step.command, ...step.args],
    status: outcome(result, step.advisory),
    advisory: Boolean(step.advisory),
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    errorCode: result.error?.code ?? (result.error ? "spawn_failed" : null),
    durationMs: Date.now() - started,
    log,
  };
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 128 * 1024,
  });
  return { status: outcome(result), value: result.status === 0 ? result.stdout.trim() : null };
}

export function summary(report) {
  const lines = [
    "# Developer platform checks",
    "",
    `Status: **${report.status}**`,
    "",
    `Platform: ${report.platform} / ${report.architecture}`,
    `Revision: ${report.revision ?? "unknown"}`,
    `Working tree modified: ${report.dirty ?? "unknown"}`,
    ...(report.ci
      ? [
          `CI repository: ${report.ci.repository}`,
          `CI target repository: ${report.ci.targetRepository}`,
          `CI repository matches target: ${report.ci.repositoryMatchesTarget}`,
          `CI run: ${report.ci.runId} (attempt ${report.ci.runAttempt})`,
          `CI event/ref: ${report.ci.event} / ${report.ci.ref}`,
          `CI source verified: ${report.ci.sourceVerified}`,
          `CI expected platform: ${report.ci.expectedPlatform} / ${report.ci.expectedArchitecture}`,
          `CI runner matches target: ${report.ci.runnerMatchesTarget}`,
          `CI expected Rust target: ${report.ci.expectedRustTarget}`,
          `CI Rust host: ${report.ci.rustHost ?? "unknown"}`,
          `CI Cargo build target: ${report.ci.cargoBuildTarget ?? "default"}`,
          `CI toolchain matches target: ${report.ci.toolchainMatchesTarget}`,
        ]
      : []),
    `Started: ${report.startedAt}`,
    "",
    "| Check | Result | Exit code | Log |",
    "| --- | --- | --- | --- |",
  ];
  for (const step of report.steps)
    lines.push(
      `| ${step.id} | ${step.status} | ${step.exitCode ?? "unknown"} | [log](${step.log}) |`,
    );
  lines.push("", "## Tool versions", "", "| Tool | Version | Result |", "| --- | --- | --- |");
  for (const [tool, result] of Object.entries(report.tools ?? {})) {
    lines.push(
      `| ${tool} | ${(result.value ?? "unknown").split("\n")[0].replaceAll("|", "\\|")} | ${result.status} |`,
    );
  }
  lines.push(
    "",
    "Scope: automated source, component, Host protocol and disposable-project lifecycle checks.",
    "Not covered: rendered WebView layouts, screenshots, installer/upgrade/uninstall, signing, or a release.",
    "",
  );
  return lines.join("\n");
}

export function main(args = process.argv.slice(2)) {
  if (args.length && (args.length !== 2 || args[0] !== "--out")) {
    console.error("Usage: bun run check:platform [--out parent-directory]");
    return 2;
  }
  const directory = join(
    resolve(args[1] ?? join(tmpdir(), "zicode-platform-checks")),
    `${process.platform}-${process.arch}-${randomUUID()}`,
  );
  mkdirSync(directory, { recursive: true });
  const revision = capture("git", ["rev-parse", "HEAD"]);
  const dirty = capture("git", ["status", "--porcelain", "--untracked-files=normal"]);
  const rustHostResult = process.env.GITHUB_ACTIONS === "true" ? capture("rustc", ["-vV"]) : null;
  const rustHost = rustHostResult?.value?.match(/^host:\s+(\S+)$/m)?.[1] ?? null;
  const cargoBuildTarget = process.env.CARGO_BUILD_TARGET?.trim() || null;
  const ci =
    process.env.GITHUB_ACTIONS === "true"
      ? {
          repository: process.env.GITHUB_REPOSITORY ?? null,
          targetRepository: TARGET_REPOSITORY,
          repositoryMatchesTarget:
            process.env.GITHUB_REPOSITORY?.toLowerCase() === TARGET_REPOSITORY.toLowerCase(),
          runId: process.env.GITHUB_RUN_ID ?? null,
          runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
          event: process.env.GITHUB_EVENT_NAME ?? null,
          ref: process.env.GITHUB_REF ?? null,
          sha: process.env.GITHUB_SHA ?? null,
          shaMatchesCheckout: Boolean(revision.value && process.env.GITHUB_SHA === revision.value),
          expectedPlatform: process.env.ZICODE_CI_EXPECTED_PLATFORM ?? null,
          expectedArchitecture: process.env.ZICODE_CI_EXPECTED_ARCH ?? null,
          runnerMatchesTarget:
            process.env.ZICODE_CI_EXPECTED_PLATFORM === process.platform &&
            process.env.ZICODE_CI_EXPECTED_ARCH === process.arch,
          expectedRustTarget: process.env.ZICODE_CI_EXPECTED_RUST_TARGET ?? null,
          rustHost,
          cargoBuildTarget,
          toolchainMatchesTarget:
            Boolean(rustHost && process.env.ZICODE_CI_EXPECTED_RUST_TARGET === rustHost) &&
            (!cargoBuildTarget || cargoBuildTarget === rustHost),
          sourceVerified: false,
        }
      : null;
  if (ci)
    ci.sourceVerified = Boolean(
      ci.repositoryMatchesTarget &&
        ci.runId &&
        ci.runAttempt &&
        ci.event &&
        ci.ref &&
        ci.shaMatchesCheckout &&
        dirty.status === "passed" &&
        !dirty.value,
    );
  const report = {
    schemaVersion: 5,
    status: "running",
    platform: process.platform,
    architecture: process.arch,
    revision: revision.value,
    dirty: dirty.status === "passed" ? Boolean(dirty.value) : null,
    ci,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    tools: {},
    steps: [],
  };
  const save = () => {
    writeFileSync(join(directory, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(join(directory, "summary.md"), summary(report));
  };
  console.log(`Evidence: ${directory}`);
  save();
  if (ci && (!ci.sourceVerified || !ci.runnerMatchesTarget || !ci.toolchainMatchesTarget)) {
    report.status = "failed";
    report.finishedAt = new Date().toISOString();
    save();
    console.error(
      "CI source, runner or Rust target could not be verified; skipping platform checks.",
    );
    return 1;
  }
  for (const [tool, versionArgs] of [
    ["node", ["--version"]],
    ["bun", ["--version"]],
    ["cargo", ["--version"]],
    ["rustc", ["--version"]],
    ["git", ["--version"]],
    ["go", ["version"]],
    [process.platform === "win32" ? "python" : "python3", ["--version"]],
  ]) {
    report.tools[tool] = capture(tool, versionArgs);
  }
  // jsdom expects no default Node Web Storage on newer local Node versions.
  // CI pins Node 22; pass this only on versions where it is needed and supported.
  const env = { ...process.env };
  if (Number(report.tools.node.value?.match(/^v(\d+)/)?.[1] ?? "0") >= 25) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ""} --no-experimental-webstorage`.trim();
  }
  for (const step of CHECKS) {
    console.log(`Checking ${step.id}…`);
    report.steps.push(runStep(step, { cwd: ROOT, directory, env }));
    save();
  }
  report.status = aggregateStatus([
    ...report.steps,
    ...Object.values(report.tools),
    revision,
    dirty,
    ...(ci
      ? [
          {
            status:
              ci.sourceVerified && ci.runnerMatchesTarget && ci.toolchainMatchesTarget
                ? "passed"
                : "failed",
          },
        ]
      : []),
  ]);
  report.finishedAt = new Date().toISOString();
  save();
  console.log(`${report.status}: ${join(directory, "summary.md")}`);
  return report.status === "failed" ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = main();

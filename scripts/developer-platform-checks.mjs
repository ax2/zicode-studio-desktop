import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = "src-tauri/Cargo.toml";
const TOOLCHAIN_TEST = "project_tasks::multilanguage_tests::checks_real_cargo_and_go_projects";
const RESOURCE_WORKER_TEST = "host_server::plugin_resources::worker::tests::actual_http_authorized_resource_worker_cancel_quota_disconnect_and_recovery";
const validSha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const TARGET_REPOSITORY = JSON.parse(
  readFileSync(join(ROOT, "scripts", "release-repository.json"), "utf8"),
).repository;
if (typeof TARGET_REPOSITORY !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(TARGET_REPOSITORY)) {
  throw new Error("Invalid developer platform repository configuration");
}

// This frozen candidate intentionally omits two profiles; its exact failures are
// asserted by check-plugin-manifest-profiles.test.js.
const NEGATIVE_PROFILE_FIXTURES = new Set(["devtools-url-text-resource-candidate02"]);

export function pluginManifestProfileFixtures(root = ROOT) {
  const directory = join(root, "tests", "fixtures");
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) =>
      entry.isDirectory() &&
      !NEGATIVE_PROFILE_FIXTURES.has(entry.name) &&
      existsSync(join(directory, entry.name, "plugin.json")))
    .map((entry) => `tests/fixtures/${entry.name}/plugin.json`)
    .sort();
}

export const CHECKS = [
  { id: "embedded-pi-resource", command: "bun", args: ["run", "fetch:pi"] },
  { id: "bundled-extension-resources", command: "bun", args: ["run", "build:extensions"] },
  {
    id: "plugin-manifest-profile-preflight",
    command: "bun",
    args: [
      "run",
      "check:plugin-manifest-profiles",
      ...pluginManifestProfileFixtures(),
    ],
  },
  {
    id: "devtools-view-candidate-receipts",
    command: "bun",
    args: ["run", "scripts/verify-devtools-view-candidates.mjs"],
  },
  {
    id: "devtools-ba45-local-bundle",
    command: "bun",
    args: ["run", "scripts/verify-devtools-ba45-bundle.mjs"],
  },
  {
    id: "devtools-view-navigation-candidates",
    command: "bun",
    args: ["run", "vitest", "run", "public/native/plugins/devtools-view-operation-candidates.test.js"],
  },
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
    id: "worker-debug-binary",
    command: "cargo",
    args: ["build", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop"],
  },
  {
    id: "resource-worker-http",
    command: "cargo",
    receipt: "resource-worker-http-receipt.json",
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      RESOURCE_WORKER_TEST, "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_RESOURCE_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_HOST_RESOURCE_EVIDENCE: join(directory, "resource-worker-http-receipt.json"),
    }),
  },
  {
    id: "devtools-image-020-host-worker",
    command: "cargo",
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::plugin_resources::worker::tests::actual_http_devtools_image_resize_candidate_host_flow",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, env }) => ({
      ZICODE_TEST_RESOURCE_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_IMAGE_CANDIDATE_DIR: join(cwd, "tests/fixtures/devtools-image-resize-candidate-020"),
    }),
  },
  {
    id: "embedded-pi-host-plugin",
    command: "cargo",
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::plugin_broker_tests::embedded_pi_invokes_the_real_host_plugin_broker",
      "--", "--ignored", "--exact"],
  },
  {
    id: "devtools-inspect-pi-worker",
    command: "cargo",
    receipt: "devtools-inspect-pi-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.preparedResources === true &&
      receipt.candidateFamily === "inspect" &&
      receipt.operationCount === 7 &&
      receipt.fullCandidateAccepted === false,
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::inspect_pi_tests::embedded_pi_inspect_all_operations_and_enforces_permission_changes",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_CANDIDATE_PI_RECEIPT: join(directory, "devtools-inspect-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    }),
  },
  {
    id: "devtools-inspect-012-host-worker",
    command: "cargo",
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::inspect_011_host_tests::current_inspect_012_runs_all_eight_operations_in_real_host_worker",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_INSPECT_012_DIR: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/inspect-0.1.2-candidate-01"),
      ZICODE_TEST_INSPECT_012_RECEIPT: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.inspect-0.1.2-verification.json"),
    }),
  },
  {
    id: "devtools-inspect-012-pi-worker",
    command: "cargo",
    receipt: "devtools-inspect-012-pi-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.preparedResources === true &&
      receipt.candidateFamily === "inspect" &&
      receipt.operationCount === 8 &&
      receipt.phases?.length === 10 &&
      receipt.deniedCalls?.length === 40 &&
      receipt.fullCandidateAccepted === false,
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::inspect_pi_tests::embedded_pi_inspect_012_eight_operations_and_permission_lifecycle",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_INSPECT_012_DIR: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/inspect-0.1.2-candidate-01"),
      ZICODE_TEST_INSPECT_012_RECEIPT: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.inspect-0.1.2-verification.json"),
      ZICODE_TEST_INSPECT_012_PI_EVIDENCE_DIR: join(directory, "devtools-inspect-012"),
      ZICODE_TEST_CANDIDATE_PI_RECEIPT: join(directory, "devtools-inspect-012-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    }),
  },
  {
    id: "devtools-text-041-pi-worker",
    command: "cargo",
    receipt: "devtools-text-041-pi-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.preparedResources === true &&
      receipt.candidateFamily === "text" &&
      receipt.operationCount === 7 &&
      receipt.phases?.length === 10 &&
      receipt.rows?.length === 7 &&
      receipt.deniedCalls?.length === 35 &&
      receipt.controlCalls?.length === 6 &&
      receipt.controlCalls?.every((call) => call.pluginId === "com.zicode.devtools.inspect" && call.passed === true) &&
      receipt.businessError?.code === "INVALID_INPUT" &&
      receipt.fullCandidateAccepted === false,
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::text_pi_tests::embedded_pi_text_041_seven_operations_and_permission_lifecycle",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_TEXT_041_DIR: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/text-plugin-0.4.1-candidate-02"),
      ZICODE_TEST_TEXT_041_RECEIPT: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.text-0.4.1-verification.json"),
      ZICODE_TEST_TEXT_041_PI_EVIDENCE_DIR: join(directory, "devtools-text-041"),
      ZICODE_TEST_CANDIDATE_PI_RECEIPT: join(directory, "devtools-text-041-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    }),
  },
  {
    id: "devtools-trace-011-pi-worker",
    command: "cargo",
    receipt: "devtools-trace-011-pi-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.preparedResources === true &&
      receipt.candidateFamily === "trace" &&
      receipt.operationCount === 2 &&
      receipt.phases?.length === 10 &&
      receipt.rows?.length === 2 &&
      receipt.deniedCalls?.length === 10 &&
      receipt.controlCalls?.length === 5 &&
      receipt.fullCandidateAccepted === false,
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::trace_pi_tests::embedded_pi_trace_011_both_operations_and_permission_lifecycle",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_TRACE_011_DIR: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/trace-0.1.1-candidate-01"),
      ZICODE_TEST_TRACE_011_RECEIPT: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.trace-0.1.1-verification.json"),
      ZICODE_TEST_TRACE_011_PI_EVIDENCE_DIR: join(directory, "devtools-trace-011"),
      ZICODE_TEST_CANDIDATE_PI_RECEIPT: join(directory, "devtools-trace-011-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    }),
  },
  {
    id: "devtools-transforms-011-pi-worker",
    command: "cargo",
    receipt: "devtools-transforms-011-pi-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.preparedResources === true &&
      receipt.candidateFamily === "transforms" &&
      receipt.operationCount === 23 &&
      receipt.phases?.length === 10 &&
      receipt.rows?.length === 23 &&
      receipt.deniedCalls?.length === 115 &&
      receipt.controlCalls?.length === 5 &&
      receipt.fullCandidateAccepted === false,
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::transforms_pi_tests::embedded_pi_transforms_011_all_operations_and_permission_lifecycle",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_TRANSFORMS_011_DIR: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/transforms-0.1.1-candidate-01"),
      ZICODE_TEST_TRANSFORMS_011_RECEIPT: join(cwd, "tests/fixtures/devtools-catalog-2026-10-18-ba45d264d48bf094/package-receipts/com.zicode.devtools.transforms-0.1.1-verification.json"),
      ZICODE_TEST_TRANSFORMS_011_PI_EVIDENCE_DIR: join(directory, "devtools-transforms-011"),
      ZICODE_TEST_CANDIDATE_PI_RECEIPT: join(directory, "devtools-transforms-011-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    }),
  },
  {
    id: "devtools-json-host-worker",
    command: "cargo",
    receipt: "devtools-json-host-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.candidateFamily === "json-object" &&
      receipt.candidateIndexSha256 === "51599cd787f007e4fbd4b6eeed8d669fa6ef1fef7598a2c3713752db4695ffe7" &&
      receipt.fileCount === 37 &&
      receipt.sourceAndReceiverExecuted === true &&
      receipt.unconfirmedRejected === true &&
      receipt.jsonSaved === true &&
      receipt.fullCandidateAccepted === false &&
      validSha256(receipt.workerSha256),
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::plugin_results::json_http_tests::delivered_json_candidate_runs_confirmed_object_transfer_and_save",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_JSON_DIR: join(cwd, "tests/fixtures/devtools-json-object-candidate06"),
      ZICODE_TEST_JSON_RECEIPT: join(cwd, "tests/fixtures/devtools-json-object-candidate06.verification.json"),
      ZICODE_TEST_JSON_HOST_RECEIPT: join(directory, "devtools-json-host-receipt.json"),
    }),
  },
  {
    id: "devtools-json-pi-worker",
    command: "cargo",
    receipt: "devtools-json-pi-receipt.json",
    validateReceipt: (receipt) =>
      receipt.mechanismPassed === true &&
      receipt.preparedResources === true &&
      receipt.candidateFamily === "json-object" &&
      receipt.candidateIndexSha256 === "51599cd787f007e4fbd4b6eeed8d669fa6ef1fef7598a2c3713752db4695ffe7" &&
      receipt.capabilityCount === 2 &&
      receipt.piToolCount === 1 &&
      receipt.phaseCount === 2 &&
      receipt.jsonResultCaptured === true &&
      receipt.fullCandidateAccepted === false &&
      validSha256(receipt.workerSha256) &&
      validSha256(receipt.piSha256) &&
      validSha256(receipt.brokerSha256),
    args: ["test", "--manifest-path", MANIFEST, "--locked", "--bin", "zicode-studio-desktop",
      "host_server::devtools_json_candidate_pi_tests::frozen_json_candidate_search_load_execute_and_revoke_in_embedded_pi",
      "--", "--ignored", "--exact", "--nocapture"],
    environment: ({ cwd, directory, env }) => ({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath(cwd, process.platform, env.CARGO_BUILD_TARGET, env.CARGO_TARGET_DIR),
      ZICODE_TEST_JSON_PI_RECEIPT: join(directory, "devtools-json-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    }),
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

export function workerBinaryPath(cwd, platform = process.platform, rustTarget = null, cargoTarget = null) {
  const target = cargoTarget?.trim() || "target";
  const targetDirectory = isAbsolute(target) ? target : join(cwd, target);
  return join(targetDirectory, ...(rustTarget?.trim() ? [rustTarget.trim()] : []), "debug",
    platform === "win32" ? "zicode-studio-desktop.exe" : "zicode-studio-desktop");
}

export function runStep(step, { cwd, directory, env, spawn = spawnSync }) {
  const started = Date.now();
  const log = `${step.id}.log`;
  const fd = openSync(join(directory, log), "w");
  let result;
  try {
    result = spawn(step.command, step.args, {
      cwd,
      env: { ...env, ...(step.environment?.({ cwd, directory, env }) ?? {}) },
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
  let receiptError = null;
  if (result.status === 0 && step.receipt) {
    try {
      const receipt = JSON.parse(readFileSync(join(directory, step.receipt), "utf8"));
      if (receipt?.passed !== true || (step.validateReceipt && !step.validateReceipt(receipt)))
        receiptError = "receipt_failed";
    } catch (error) {
      receiptError = error?.code === "ENOENT" ? "receipt_missing" : "receipt_invalid";
    }
  }
  return {
    id: step.id,
    command: [step.command, ...step.args],
    status: receiptError ? "failed" : outcome(result, step.advisory),
    advisory: Boolean(step.advisory),
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    errorCode: receiptError ?? result.error?.code ?? (result.error ? "spawn_failed" : null),
    receipt: !receiptError && result.status === 0 ? step.receipt ?? null : null,
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
  const diagnostic = String(result.stderr || result.error?.message || "")
    .replace(/\s+/g, " ").trim().slice(0, 512);
  return {
    status: outcome(result),
    value: result.status === 0 ? result.stdout.trim() : null,
    exitCode: result.status ?? null,
    signal: result.signal ?? null,
    errorCode: result.error?.code ?? null,
    diagnostic: diagnostic || null,
  };
}

function sourceProbe(result) {
  const { status, exitCode, signal, errorCode, diagnostic } = result;
  return { status, exitCode, signal, errorCode, diagnostic };
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
    ...(report.sourceChecks ? [
      "",
      "## Source probes",
      "",
      "| Probe | Result | Exit code | Signal | Error code | Diagnostic |",
      "| --- | --- | --- | --- | --- | --- |",
      ...Object.entries(report.sourceChecks).map(([name, probe]) =>
        `| ${name} | ${probe.status} | ${probe.exitCode ?? "unknown"} | ${probe.signal ?? "none"} | ${probe.errorCode ?? "none"} | ${(probe.diagnostic ?? "none").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("|", "\\|")} |`),
    ] : []),
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
    `Rust test harness threads: ${report.rustTestThreads ?? "default"}`,
    "",
    "| Check | Result | Exit code | Log |",
    "| --- | --- | --- | --- |",
  ];
  for (const step of report.steps)
    lines.push(
      `| ${step.id} | ${step.status}${step.errorCode ? ` (${step.errorCode})` : ""} | ${step.exitCode ?? "unknown"} | [log](${step.log}) |`,
    );
  const resourceWorker = report.steps.find((step) => step.id === "resource-worker-http");
  if (resourceWorker?.status === "passed" && resourceWorker.receipt)
    lines.push("", `Resource Worker: [structured receipt](${resourceWorker.receipt}).`);
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
    schemaVersion: 6,
    rustTestThreads: process.env.RUST_TEST_THREADS || null,
    status: "running",
    platform: process.platform,
    architecture: process.arch,
    revision: revision.value,
    dirty: dirty.status === "passed" ? Boolean(dirty.value) : null,
    sourceChecks: { gitRevision: sourceProbe(revision), gitStatus: sourceProbe(dirty) },
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

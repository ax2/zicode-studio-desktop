import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateStatus,
  CHECKS,
  outcome,
  runStep,
  summary,
  workerBinaryPath,
} from "./developer-platform-checks.mjs";

describe("developer platform evidence", () => {
  it("checks every frontend feature and treats missing native permissions as a failure", () => {
    const full = CHECKS.find((step) => step.id === "javascript-full-suite");
    expect(full).toMatchObject({ command: "bun", args: ["run", "test"] });
    expect(full.advisory).not.toBe(true);
    const ui = CHECKS.find((step) => step.id === "project-ui-gateways");
    expect(ui.args).toContain("frontend/src");
    const permissions = CHECKS.find((step) => step.id === "tauri-permissions");
    expect(permissions).toMatchObject({ command: "bun", args: ["run", "check:permissions"] });
    expect(permissions.advisory).not.toBe(true);
    const profiles = CHECKS.find((step) => step.id === "plugin-manifest-profile-preflight");
    expect(profiles.command).toBe("bun");
    expect(profiles.args.slice(0, 2)).toEqual(["run", "check:plugin-manifest-profiles"]);
    const positiveFixtures = readdirSync(join("tests", "fixtures"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "devtools-url-text-resource-candidate02")
      .map((entry) => `tests/fixtures/${entry.name}/plugin.json`)
      .filter((path) => existsSync(path)).sort();
    expect(profiles.args.slice(2)).toEqual(positiveFixtures);
    expect(positiveFixtures).toContain("tests/fixtures/studio-tool-open-profile/plugin.json");
    expect(positiveFixtures).toContain("tests/fixtures/devtools-json-object-candidate06/plugin.json");
    expect(positiveFixtures).not.toContain("tests/fixtures/devtools-url-text-resource-candidate02/plugin.json");
    expect(profiles.advisory).not.toBe(true);
    const viewReceipts = CHECKS.find((step) => step.id === "devtools-view-candidate-receipts");
    expect(viewReceipts).toMatchObject({
      command: "bun",
      args: ["run", "scripts/verify-devtools-view-candidates.mjs"],
    });
    expect(viewReceipts.advisory).not.toBe(true);
    expect(CHECKS.indexOf(viewReceipts)).toBeLessThan(CHECKS.findIndex((step) => step.id === "rust-tests"));
    const localBundle = CHECKS.find((step) => step.id === "devtools-ba45-local-bundle");
    expect(localBundle).toMatchObject({
      command: "bun",
      args: ["run", "scripts/verify-devtools-ba45-bundle.mjs"],
    });
    expect(localBundle.advisory).not.toBe(true);
    expect(CHECKS.indexOf(localBundle)).toBeLessThan(CHECKS.findIndex((step) => step.id === "rust-tests"));
    const viewNavigation = CHECKS.find((step) => step.id === "devtools-view-navigation-candidates");
    expect(viewNavigation).toMatchObject({
      command: "bun",
      args: ["run", "vitest", "run", "public/native/plugins/devtools-view-operation-candidates.test.js"],
    });
    expect(viewNavigation.advisory).not.toBe(true);
    expect(CHECKS.indexOf(viewReceipts)).toBeLessThan(CHECKS.indexOf(viewNavigation));
    expect(CHECKS.indexOf(viewNavigation)).toBeLessThan(CHECKS.findIndex((step) => step.id === "rust-tests"));
    expect(aggregateStatus([
      { status: "passed" },
      { status: outcome({ status: 1 }, permissions.advisory) },
    ])).toBe("failed");
  });
  it("does not report missing, signalled or incomplete executions as passed", () => {
    for (const result of [
      { status: null },
      { status: 0, error: { code: "ENOENT" } },
      { status: null, signal: "SIGTERM" },
      { status: 1 },
    ])
      expect(outcome(result)).toBe("failed");
    expect(outcome({ status: 0 })).toBe("passed");
    expect(outcome({ status: 1 }, true)).toBe("warning");
    expect(aggregateStatus([])).toBe("failed");
    expect(aggregateStatus([{ status: "running" }])).toBe("failed");
    expect(aggregateStatus([{ status: "passed" }, { status: "skipped" }])).toBe("failed");
    expect(aggregateStatus([{ status: "passed" }, { status: "warning" }])).toBe(
      "passed_with_warnings",
    );
  });

  it("explicitly runs the ignored real-tool lifecycle test and uses locked Rust dependencies", () => {
    const pi = CHECKS.find((step) => step.id === "embedded-pi-host-plugin");
    expect(pi.args).toContain("host_server::plugin_broker_tests::embedded_pi_invokes_the_real_host_plugin_broker");
    expect(pi.args).toContain("--ignored");
    expect(pi.args).toContain("--exact");
    expect(pi.advisory).not.toBe(true);
    expect(CHECKS.findIndex((step) => step.id === "embedded-pi-resource")).toBeLessThan(CHECKS.indexOf(pi));
    expect(CHECKS.findIndex((step) => step.id === "bundled-extension-resources")).toBeLessThan(CHECKS.indexOf(pi));
    const resource = CHECKS.find((step) => step.id === "resource-worker-http");
    expect(resource.args.some((arg) => arg.endsWith("actual_http_authorized_resource_worker_cancel_quota_disconnect_and_recovery"))).toBe(true);
    expect(resource.args).toContain("--ignored");
    expect(resource.args).toContain("--exact");
    expect(resource.advisory).not.toBe(true);
    expect(CHECKS.findIndex((step) => step.id === "rust-tests")).toBeLessThan(CHECKS.indexOf(resource));
    const image = CHECKS.find((step) => step.id === "devtools-image-020-host-worker");
    expect(image.args).toContain("host_server::plugin_resources::worker::tests::actual_http_devtools_image_resize_candidate_host_flow");
    expect(image.args).toContain("--ignored");
    expect(image.args).toContain("--exact");
    expect(image.advisory).not.toBe(true);
    expect(CHECKS.indexOf(resource)).toBeLessThan(CHECKS.indexOf(image));
    expect(image.environment({ cwd: "/checkout", env: {} })).toEqual({
      ZICODE_TEST_RESOURCE_WORKER_EXE: workerBinaryPath("/checkout"),
      ZICODE_TEST_IMAGE_CANDIDATE_DIR: join("/checkout", "tests/fixtures/devtools-image-resize-candidate-020"),
    });
    const workerBinary = CHECKS.find((step) => step.id === "worker-debug-binary");
    expect(workerBinary).toMatchObject({
      command: "cargo",
      args: ["build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--bin", "zicode-studio-desktop"],
    });
    expect(CHECKS.findIndex((step) => step.id === "rust-tests")).toBeLessThan(CHECKS.indexOf(workerBinary));
    expect(CHECKS.indexOf(workerBinary)).toBeLessThan(CHECKS.indexOf(resource));
    const inspect = CHECKS.find((step) => step.id === "devtools-inspect-pi-worker");
    expect(inspect.args).toContain("host_server::inspect_pi_tests::embedded_pi_inspect_all_operations_and_enforces_permission_changes");
    expect(inspect.args).toContain("--ignored");
    expect(inspect.args).toContain("--exact");
    expect(inspect.receipt).toBe("devtools-inspect-pi-receipt.json");
    expect(CHECKS.indexOf(resource)).toBeLessThan(CHECKS.indexOf(inspect));
    expect(CHECKS.findIndex((step) => step.id === "embedded-pi-host-plugin")).toBeLessThan(CHECKS.indexOf(inspect));
    expect(inspect.environment({ cwd: "/checkout", directory: "/evidence", env: {} })).toEqual({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath("/checkout"),
      ZICODE_TEST_CANDIDATE_PI_RECEIPT: join("/evidence", "devtools-inspect-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    });
    const inspect012Host = CHECKS.find((step) => step.id === "devtools-inspect-012-host-worker");
    const inspect012Pi = CHECKS.find((step) => step.id === "devtools-inspect-012-pi-worker");
    expect(inspect012Host.args).toContain("host_server::inspect_011_host_tests::current_inspect_012_runs_all_eight_operations_in_real_host_worker");
    expect(inspect012Pi.args).toContain("host_server::inspect_pi_tests::embedded_pi_inspect_012_eight_operations_and_permission_lifecycle");
    expect(inspect012Pi.receipt).toBe("devtools-inspect-012-pi-receipt.json");
    expect(CHECKS.indexOf(inspect012Host)).toBeLessThan(CHECKS.indexOf(inspect012Pi));
    for (const step of [inspect012Host, inspect012Pi]) {
      expect(step.args).toContain("--ignored");
      expect(step.args).toContain("--exact");
      expect(step.advisory).not.toBe(true);
      const environment = step.environment({ cwd: "/checkout", directory: "/evidence", env: {} });
      expect(environment.ZICODE_TEST_INSPECT_012_DIR).toContain("inspect-0.1.2-candidate-01");
      expect(environment.ZICODE_TEST_INSPECT_012_RECEIPT).toContain("com.zicode.devtools.inspect-0.1.2-verification.json");
    }
    const text041Pi = CHECKS.find((step) => step.id === "devtools-text-041-pi-worker");
    expect(text041Pi.args).toContain("host_server::text_pi_tests::embedded_pi_text_041_seven_operations_and_permission_lifecycle");
    expect(text041Pi.receipt).toBe("devtools-text-041-pi-receipt.json");
    expect(text041Pi.advisory).not.toBe(true);
    const text041Environment = text041Pi.environment({ cwd: "/checkout", directory: "/evidence", env: {} });
    expect(text041Environment.ZICODE_TEST_TEXT_041_DIR).toContain("text-plugin-0.4.1-candidate-02");
    expect(text041Environment.ZICODE_TEST_TEXT_041_RECEIPT).toContain("com.zicode.devtools.text-0.4.1-verification.json");
    expect(text041Environment.ZICODE_TEST_CANDIDATE_PI_RECEIPT).toBe(join("/evidence", "devtools-text-041-pi-receipt.json"));
    const trace011Pi = CHECKS.find((step) => step.id === "devtools-trace-011-pi-worker");
    expect(trace011Pi.args).toContain("host_server::trace_pi_tests::embedded_pi_trace_011_both_operations_and_permission_lifecycle");
    expect(trace011Pi.receipt).toBe("devtools-trace-011-pi-receipt.json");
    expect(trace011Pi.advisory).not.toBe(true);
    const trace011Environment = trace011Pi.environment({ cwd: "/checkout", directory: "/evidence", env: {} });
    expect(trace011Environment.ZICODE_TEST_TRACE_011_DIR).toContain("trace-0.1.1-candidate-01");
    expect(trace011Environment.ZICODE_TEST_TRACE_011_RECEIPT).toContain("com.zicode.devtools.trace-0.1.1-verification.json");
    expect(trace011Environment.ZICODE_TEST_CANDIDATE_PI_RECEIPT).toBe(join("/evidence", "devtools-trace-011-pi-receipt.json"));
    const transforms011Pi = CHECKS.find((step) => step.id === "devtools-transforms-011-pi-worker");
    expect(transforms011Pi.args).toContain("host_server::transforms_pi_tests::embedded_pi_transforms_011_all_operations_and_permission_lifecycle");
    expect(transforms011Pi.receipt).toBe("devtools-transforms-011-pi-receipt.json");
    expect(transforms011Pi.advisory).not.toBe(true);
    const transforms011Environment = transforms011Pi.environment({ cwd: "/checkout", directory: "/evidence", env: {} });
    expect(transforms011Environment.ZICODE_TEST_TRANSFORMS_011_DIR).toContain("transforms-0.1.1-candidate-01");
    expect(transforms011Environment.ZICODE_TEST_TRANSFORMS_011_RECEIPT).toContain("com.zicode.devtools.transforms-0.1.1-verification.json");
    expect(transforms011Environment.ZICODE_TEST_CANDIDATE_PI_RECEIPT).toBe(join("/evidence", "devtools-transforms-011-pi-receipt.json"));
    const jsonHost = CHECKS.find((step) => step.id === "devtools-json-host-worker");
    const jsonPi = CHECKS.find((step) => step.id === "devtools-json-pi-worker");
    expect(jsonHost.args).toContain("host_server::plugin_results::json_http_tests::delivered_json_candidate_runs_confirmed_object_transfer_and_save");
    expect(jsonPi.args).toContain("host_server::devtools_json_candidate_pi_tests::frozen_json_candidate_search_load_execute_and_revoke_in_embedded_pi");
    for (const step of [jsonHost, jsonPi]) {
      expect(step.args).toContain("--ignored");
      expect(step.args).toContain("--exact");
      expect(step.advisory).not.toBe(true);
    }
    expect(CHECKS.indexOf(workerBinary)).toBeLessThan(CHECKS.indexOf(jsonHost));
    expect(CHECKS.indexOf(jsonHost)).toBeLessThan(CHECKS.indexOf(jsonPi));
    expect(jsonHost.environment({ cwd: "/checkout", directory: "/evidence", env: {} })).toEqual({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath("/checkout"),
      ZICODE_TEST_JSON_DIR: join("/checkout", "tests/fixtures/devtools-json-object-candidate06"),
      ZICODE_TEST_JSON_RECEIPT: join("/checkout", "tests/fixtures/devtools-json-object-candidate06.verification.json"),
      ZICODE_TEST_JSON_HOST_RECEIPT: join("/evidence", "devtools-json-host-receipt.json"),
    });
    expect(jsonPi.environment({ cwd: "/checkout", directory: "/evidence", env: {} })).toEqual({
      ZICODE_TEST_WORKER_EXE: workerBinaryPath("/checkout"),
      ZICODE_TEST_JSON_PI_RECEIPT: join("/evidence", "devtools-json-pi-receipt.json"),
      ZICODE_TEST_PREPARED_RESOURCES: "1",
    });
    expect(CHECKS.find((step) => step.id === "python-venv-lifecycle").args).toContain(
      "project_tasks::python_tests::runs_unittest_with_a_real_project_environment",
    );
    const real = CHECKS.find((step) => step.id === "cargo-go-lifecycle");
    expect(real.args).toContain("--ignored");
    expect(real.args).toContain("--exact");
    expect(real.args).toContain(
      "project_tasks::multilanguage_tests::checks_real_cargo_and_go_projects",
    );
    for (const step of CHECKS.filter(
      (step) => step.command === "cargo" && step.id !== "rust-format",
    ))
      expect(step.args).toContain("--locked");
    expect(CHECKS.filter((step) => step.args.includes("build"))).toEqual([workerBinary]);
    expect(CHECKS.some((step) => step.args.includes("release"))).toBe(false);
  });

  it("passes the platform binary and a per-run receipt to the real Worker check", () => {
    expect(workerBinaryPath("/checkout", "linux")).toBe(join("/checkout", "target", "debug", "zicode-studio-desktop"));
    expect(workerBinaryPath("C:\\checkout", "win32")).toBe(join("C:\\checkout", "target", "debug", "zicode-studio-desktop.exe"));
    expect(workerBinaryPath("/checkout", "linux", "x86_64-unknown-linux-gnu")).toBe(join("/checkout", "target", "x86_64-unknown-linux-gnu", "debug", "zicode-studio-desktop"));
    expect(workerBinaryPath("/checkout", "linux", null, "shared-target")).toBe(join("/checkout", "shared-target", "debug", "zicode-studio-desktop"));
    const absoluteTarget = resolve("/outside", "shared-target");
    expect(workerBinaryPath("/checkout", "linux", "x86_64-unknown-linux-gnu", absoluteTarget))
      .toBe(join(absoluteTarget, "x86_64-unknown-linux-gnu", "debug", "zicode-studio-desktop"));
    for (const id of ["resource-worker-http", "devtools-inspect-pi-worker", "devtools-inspect-012-host-worker", "devtools-inspect-012-pi-worker", "devtools-text-041-pi-worker", "devtools-trace-011-pi-worker", "devtools-transforms-011-pi-worker", "devtools-json-host-worker", "devtools-json-pi-worker"]) {
      const step = CHECKS.find((item) => item.id === id);
      const environment = step.environment({ cwd: "/checkout", directory: "/evidence", env: { CARGO_TARGET_DIR: absoluteTarget } });
      expect(environment.ZICODE_TEST_RESOURCE_WORKER_EXE ?? environment.ZICODE_TEST_WORKER_EXE)
        .toBe(workerBinaryPath("/checkout", process.platform, null, absoluteTarget));
    }
    const directory = mkdtempSync(join(tmpdir(), "zicode-worker-check-"));
    try {
      const spawn = vi.fn((_command, _args, options) => {
        writeFileSync(options.env.ZICODE_TEST_HOST_RESOURCE_EVIDENCE, '{"passed":true}');
        return { status: 0 };
      });
      const step = CHECKS.find((item) => item.id === "resource-worker-http");
      const result = runStep(step, { cwd: directory, directory, env: { KEEP: "yes" }, spawn });
      expect(result.status).toBe("passed");
      expect(result.receipt).toBe("resource-worker-http-receipt.json");
      expect(spawn.mock.calls[0][2].env).toMatchObject({
        KEEP: "yes",
        ZICODE_TEST_RESOURCE_WORKER_EXE: workerBinaryPath(directory),
        ZICODE_TEST_HOST_RESOURCE_EVIDENCE: join(directory, "resource-worker-http-receipt.json"),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails a real Worker step when its structured receipt is absent or untrusted", () => {
    const directory = mkdtempSync(join(tmpdir(), "zicode-worker-receipt-"));
    try {
      const step = CHECKS.find((item) => item.id === "resource-worker-http");
      const options = { cwd: directory, directory, env: {}, spawn: () => ({ status: 0 }) };
      expect(runStep(step, options)).toMatchObject({ status: "failed", errorCode: "receipt_missing", receipt: null });
      const receipt = join(directory, step.receipt);
      writeFileSync(receipt, '{"passed":false}');
      expect(runStep(step, options)).toMatchObject({ status: "failed", errorCode: "receipt_failed", receipt: null });
      writeFileSync(receipt, '{broken');
      const invalid = runStep(step, options);
      expect(invalid).toMatchObject({ status: "failed", errorCode: "receipt_invalid", receipt: null });
      expect(summary({ platform: "win32", architecture: "x64", status: "failed", startedAt: "now", steps: [invalid] }))
        .toContain("resource-worker-http | failed (receipt_invalid) | 0");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires Inspect's seven-operation receipt from prepared Pi resources", () => {
    const directory = mkdtempSync(join(tmpdir(), "zicode-inspect-ci-receipt-"));
    try {
      const step = CHECKS.find((item) => item.id === "devtools-inspect-pi-worker");
      const file = join(directory, step.receipt);
      const options = { cwd: directory, directory, env: {}, spawn: () => ({ status: 0 }) };
      const valid = {
        passed: true,
        mechanismPassed: true,
        preparedResources: true,
        candidateFamily: "inspect",
        operationCount: 7,
        fullCandidateAccepted: false,
      };
      writeFileSync(file, JSON.stringify(valid));
      expect(runStep(step, options).status).toBe("passed");
      for (const changed of [
        { preparedResources: false },
        { operationCount: 6 },
        { mechanismPassed: false },
        { fullCandidateAccepted: true },
      ]) {
        writeFileSync(file, JSON.stringify({ ...valid, ...changed }));
        expect(runStep(step, options).errorCode).toBe("receipt_failed");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires exact frozen JSON Host and Pi receipts", () => {
    const directory = mkdtempSync(join(tmpdir(), "zicode-json-ci-receipt-"));
    try {
      const common = {
        passed: true,
        mechanismPassed: true,
        candidateFamily: "json-object",
        candidateIndexSha256: "51599cd787f007e4fbd4b6eeed8d669fa6ef1fef7598a2c3713752db4695ffe7",
        fullCandidateAccepted: false,
        workerSha256: "a".repeat(64),
      };
      const cases = [
        ["devtools-json-host-worker", {
          fileCount: 37, sourceAndReceiverExecuted: true,
          unconfirmedRejected: true, jsonSaved: true,
        }, { sourceAndReceiverExecuted: false }],
        ["devtools-json-pi-worker", {
          preparedResources: true, capabilityCount: 2,
          piToolCount: 1, phaseCount: 2, jsonResultCaptured: true,
          piSha256: "b".repeat(64), brokerSha256: "c".repeat(64),
        }, { preparedResources: false }],
      ];
      for (const [id, fields, invalid] of cases) {
        const step = CHECKS.find((item) => item.id === id);
        const path = join(directory, step.receipt);
        const options = { cwd: directory, directory, env: {}, spawn: () => ({ status: 0 }) };
        writeFileSync(path, JSON.stringify({ ...common, ...fields }));
        expect(runStep(step, options).status).toBe("passed");
        writeFileSync(path, JSON.stringify({ ...common, ...fields, ...invalid }));
        expect(runStep(step, options).errorCode).toBe("receipt_failed");
        writeFileSync(path, JSON.stringify({ ...common, ...fields, candidateIndexSha256: "wrong" }));
        expect(runStep(step, options).errorCode).toBe("receipt_failed");
        writeFileSync(path, JSON.stringify({ ...common, ...fields, workerSha256: "missing" }));
        expect(runStep(step, options).errorCode).toBe("receipt_failed");
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("captures a thrown launch error and keeps Windows children hidden without a shell", () => {
    const directory = mkdtempSync(join(tmpdir(), "zicode-platform-report-"));
    try {
      const spawn = vi.fn(() => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      });
      const result = runStep(
        { id: "fixture", command: "missing", args: [] },
        { cwd: directory, directory, env: {}, spawn },
      );
      expect(result.status).toBe("failed");
      expect(result.errorCode).toBe("ENOENT");
      expect(spawn.mock.calls[0][2]).toMatchObject({ shell: false, windowsHide: true });
      const text = summary({
        platform: "win32",
        architecture: "x64",
        status: "failed",
        revision: "abc",
        dirty: true,
        startedAt: "now",
        rustTestThreads: "2",
        steps: [result],
      });
      expect(text).toContain("Not covered: rendered WebView layouts");
      expect(text).toContain("Rust test harness threads: 2");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("explains a failed checkout probe without including its stdout", () => {
    const text = summary({
      platform: "linux", architecture: "x64", status: "failed", dirty: null,
      startedAt: "now", steps: [], sourceChecks: {
        gitRevision: { status: "passed", exitCode: 0, signal: null, errorCode: null, diagnostic: null },
        gitStatus: { status: "failed", exitCode: null, signal: "SIGTERM", errorCode: "ETIMEDOUT", diagnostic: "git status timed out" },
      },
    });
    expect(text).toContain("gitStatus | failed | unknown | SIGTERM | ETIMEDOUT | git status timed out");
    expect(text).toContain("Working tree modified: unknown");
  });
});

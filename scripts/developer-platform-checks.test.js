import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(
      CHECKS.some((step) => step.args.includes("build") || step.args.includes("release")),
    ).toBe(false);
  });

  it("passes the platform binary and a per-run receipt to the real Worker check", () => {
    expect(workerBinaryPath("/checkout", "linux")).toBe(join("/checkout", "target", "debug", "zicode-studio-desktop"));
    expect(workerBinaryPath("C:\\checkout", "win32")).toBe(join("C:\\checkout", "target", "debug", "zicode-studio-desktop.exe"));
    expect(workerBinaryPath("/checkout", "linux", "x86_64-unknown-linux-gnu")).toBe(join("/checkout", "target", "x86_64-unknown-linux-gnu", "debug", "zicode-studio-desktop"));
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
});

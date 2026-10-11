import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  aggregateStatus,
  CHECKS,
  outcome,
  runStep,
  summary,
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

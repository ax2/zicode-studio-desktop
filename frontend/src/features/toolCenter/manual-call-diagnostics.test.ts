import { expect, it } from "vitest";
import { type CallDiagnostics, appendCallDiagnostic, diagnosticCode, manualCallFailureNotice } from "./manual-call-diagnostics";

it("bounds a current call record and replaces arbitrary codes without retaining raw data", () => {
  let trace: CallDiagnostics = { schemaVersion: 1, startedAt: 1, callId: "call", events: [] };
  for (let index = 0; index < 100; index++) trace = appendCallDiagnostic(trace, "request_failed", index % 2 ? "worker_timeout" : "private-input-or-error-message");
  expect(trace.events).toHaveLength(24);
  expect(JSON.stringify(trace)).not.toContain("private-input-or-error-message");
  expect(trace.events[0].code).toBe("unclassified_error");
  expect(trace.events[23].code).toBe("worker_timeout");
  expect(diagnosticCode({ secret: "private" })).toBe("unclassified_error");
  expect(diagnosticCode("manual_call_retired")).toBe("manual_call_retired");
});
it.each(["worker_timeout", "worker_fuel_exhausted", "worker_memory_trap", "worker_stack_exhausted", "worker_failed"])("names %s without treating its response as a terminal proof", code => {
  expect(manualCallFailureNotice(code)).toContain("Confirm its status before running again");
  expect(manualCallFailureNotice(code)).not.toContain("Connection interrupted");
});
it("distinguishes connection timeout from execution timeout and hides unknown errors", () => {
  expect(manualCallFailureNotice("plugin_capability_timeout")).toContain("connection timed out");
  expect(manualCallFailureNotice("private-detail")).not.toContain("private-detail");
});

import { describe, expect, it } from "vitest";
import { publicViewError } from "./plugin-view-errors.js";

describe("public View error contract", () => {
  it("preserves budget timeout cancellation codes without private service text", () => {
    for (const code of [
      "worker_fuel_exhausted",
      "worker_timeout",
      "worker_cancelled",
      "worker_memory_trap",
      "worker_stack_exhausted",
      "result_too_large",
      "payload_too_large",
      "capability_unavailable",
      "capability_changed",
      "plugin_call_budget_exceeded",
      "plugin_execution_failed",
      "view_call_cancel_unavailable",
      "view_call_protocol_invalid",
      "view_call_outcome_unknown",
      "catalog_changed",
      "manual_call_budget_exceeded",
    ]) {
      const result = publicViewError(
        Object.assign(new Error("private report token path"), { code }),
      );
      expect(result.errorCode).toBe(code);
      expect(result.error).not.toContain("private");
    }
  });
  it("accepts exact sanitized resource codes and retains local compatibility", () => {
    expect(publicViewError(new Error("[result_too_large]")).errorCode).toBe("result_too_large");
    expect(publicViewError(new Error("[payload_too_large]")).errorCode).toBe("payload_too_large");
    expect(publicViewError(new Error("[resource_request_invalid]"))).toEqual({
      errorCode: "resource_request_invalid",
      error: "[resource_request_invalid]",
    });
    expect(publicViewError("Plugin command is not declared").error).toBe(
      "Plugin command is not declared",
    );
  });
  it("shows a fixed recovery hint when HTTP auditing blocks the service", () => {
    expect(publicViewError(Object.assign(new Error("private audit path"), {
      code: "http_service_audit_unavailable",
    }))).toEqual({
      errorCode: "http_service_audit_unavailable",
      error: "Service audit is unavailable; restart Studio after repairing its audit storage",
    });
    expect(publicViewError(new Error("[http_service_unavailable]"))).toEqual({
      errorCode: "http_service_unavailable",
      error: "Service is unavailable; retry later",
    });
  });
  it("rejects unknown codes and never forwards arbitrary messages", () => {
    for (const input of [
      new Error("private path credential"),
      { code: "unknown_private", message: "secret" },
      "[worker_fuel_exhausted] private",
      null,
    ]) {
      expect(publicViewError(input)).toEqual({
        errorCode: "plugin_request_failed",
        error: "Plugin request failed",
      });
    }
  });
});

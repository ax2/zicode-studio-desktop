import { describe, expect, it } from "vitest";
import { resourceCallStatus } from "../../../tests/helpers/resource-call-status.js";
import { normalizeResourceCallStatus } from "./resource-call-status.js";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
describe("resource call status proof", () => {
  it("accepts bounded phases and strips extra Host data", () => {
    for (const phase of ["unknown", "cancel_pending", "active", "finished"]) {
      const status = normalizeResourceCallStatus({ ...resourceCallStatus(owner, id, phase), privatePath: "hidden" }, owner, id);
      expect(status.phase).toBe(phase); expect(status.privatePath).toBeUndefined();
    }
  });
  it("rejects inconsistent or foreign evidence", () => {
    for (const change of [{ executionFinished: true }, { cancellationRequested: true },
      { owner: { ...owner, sessionId: "other" } }, { toolCallId: "other" }, { profile: "other" },
      { hostInstanceId: "invalid" }, { persistent: true }, { retentionSeconds: 600 }, { resultAvailable: true }]) {
      expect(() => normalizeResourceCallStatus({ ...resourceCallStatus(owner, id), ...change }, owner, id)).toThrow("resource_response_invalid");
    }
    expect(() => normalizeResourceCallStatus(resourceCallStatus(owner, id), owner, id, id)).toThrow("resource_response_invalid");
  });
});

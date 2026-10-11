import { describe, expect, it } from "vitest";
import { admission, reconciliation } from "../../../tests/helpers/resource-call-admission.js";
import { normalizeResourceAdmission, normalizeResourceReconciliation } from "./resource-call-admission.js";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
describe("Host-issued resource call proof", () => {
  it("keeps only the one-use ticket and validates every recovery phase", () => {
    const proof = admission(owner);
    const ticket = normalizeResourceAdmission({ ...proof, privatePath: "hidden" }, owner);
    expect(Object.keys(ticket).sort()).toEqual(["callId", "hostInstanceId"]);
    for (const phase of ["active", "ended", "not_started", "not_admissible"])
      expect(normalizeResourceReconciliation(reconciliation(owner, ticket.callId, phase), owner, ticket))
        .toMatchObject({ phase, executionFinished: phase !== "active" });
  });
  it("rejects legacy, wrong scope, invalid identity and unsupported protocol", () => {
    for (const change of [{ profile: "resource.call.status.draft1" }, { owner: {} }, { callId: 4 },
      { callId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, { hostInstanceId: "changed" },
      { phase: "active" }, { persistent: true }, { expiresInSeconds: 120 }, { schemaVersion: 2 }])
      expect(() => normalizeResourceAdmission({ ...admission(owner), ...change }, owner)).toThrow("resource_response_invalid");
  });
  it("never unlocks from unknown, false completion, another ticket or another Host", () => {
    const ticket = normalizeResourceAdmission(admission(owner), owner);
    for (const change of [{ phase: "unknown" }, { phase: "active", executionFinished: true },
      { executionFinished: false }, { admissionClosed: false }, { resultAvailable: true },
      { callId: "resource-call-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { hostInstanceId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }])
      expect(() => normalizeResourceReconciliation({ ...reconciliation(owner, ticket.callId, "ended"), ...change }, owner, ticket))
        .toThrow("resource_response_invalid");
  });
});

import { describe, expect, it } from "vitest";
import { createResourceCallJournal, resourceCallRecord } from "./resource-call-journal.js";
import { admission } from "../../../tests/helpers/resource-call-admission.js";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const target = { instanceId: "r", sessionId: "s", workspaceId: "ws", sceneId: "programming" };
describe("bounded resource call metadata", () => {
  it("keeps only identity metadata without payloads, paths or credentials", () => {
    const record = resourceCallRecord({ ...target, cwd: "private" }, { ...owner, input: "private" },
      { ...admission(owner), token: "private", output: "private" }, 1);
    expect(Object.keys(record).sort()).toEqual(["createdAt", "id", "label", "owner", "schemaVersion", "scope", "scopeKey", "ticket"]);
    expect(JSON.stringify(record)).not.toContain("private");
    expect(record.owner).toEqual(owner); expect(Object.keys(record.ticket).sort()).toEqual(["callId", "hostInstanceId"]);
  });
  it("rejects incomplete or changed scope and invalid tickets", () => {
    for (const change of [{ workspaceId: "" }, { instanceId: "other" }, { sessionId: "other" }, { sceneId: "x".repeat(257) }])
      expect(() => resourceCallRecord({ ...target, ...change }, owner, admission(owner))).toThrow();
    expect(() => resourceCallRecord(target, owner, { callId: "legacy", hostInstanceId: "old" })).toThrow();
  });
  it("fails closed without durable storage; never uses a volatile fallback", async () => {
    const journal = createResourceCallJournal({ indexedDB: null });
    await expect(journal.keep(target, owner, admission(owner))).rejects.toThrow("resource_journal_unavailable");
    await expect(journal.list(target)).rejects.toThrow("resource_journal_unavailable");
  });
});

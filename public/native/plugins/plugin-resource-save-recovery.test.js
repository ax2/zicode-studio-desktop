import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifySavedResource } from "./plugin-resource-save-recovery.js";

const hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
function fixture() {
  const expected = { schemaVersion: 1, profile: "resource.save.draft1", saveId: "11111111-1111-4111-8111-111111111111",
    workspaceId: "w", relativePath: ".zicode/outputs/11111111-1111-4111-8111-111111111111/result.txt",
    mimeType: "text/plain", byteLength: 5, contentVersion: hash, preparedAt: "2026-10-11T00:00:00Z",
    source: { pluginId: "p", capabilityId: "c", resourceId: "22222222-2222-4222-8222-222222222222", packageVersion: "1.0.0" } };
  const page = { schemaVersion: 1, profile: "resource.library.draft1", workspaceId: "w", offset: 0, pageSize: 40,
    payloadsRead: false, hasMore: false, total: 1, items: [{ receipt: structuredClone(expected), receiptVersion: "b".repeat(64), integrity: "not_checked" }] };
  const gateway = { list: vi.fn(async () => page), read: vi.fn(async () => new Uint8Array([104, 101, 108, 108, 111]).buffer) };
  return { expected, page, gateway, check: (signal) => verifySavedResource({ gateway, expected, sceneId: "programming", workspaceId: "w", signal }) };
}
beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());
describe("read-only saved resource reconciliation", () => {
  it("checks exact original receipt and content hash through read-only library calls", async () => {
    const f = fixture(); expect(await f.check()).toEqual(f.expected);
    expect(f.gateway.list).toHaveBeenCalledWith("programming", "w", { query: f.expected.saveId, offset: 0, signal: undefined });
    expect(f.gateway.read).toHaveBeenCalledOnce();
  });
  it.each(["saveId", "workspaceId", "relativePath", "mimeType", "contentVersion", "preparedAt"])("rejects changed %s before reading contents", async key => {
    const f = fixture(); f.page.items[0].receipt[key] = "changed";
    await expect(f.check()).rejects.toThrow("saved_resource_unconfirmed"); expect(f.gateway.read).not.toHaveBeenCalled();
  });
  it.each(["pluginId", "capabilityId", "resourceId", "packageVersion"])("rejects changed source %s", async key => {
    const f = fixture(); f.page.items[0].receipt.source[key] = "changed";
    await expect(f.check()).rejects.toThrow(); expect(f.gateway.read).not.toHaveBeenCalled();
  });
  it("does not turn absence, duplicate rows or incomplete pages into a negative save outcome", async () => {
    for (const patch of [{ items: [], total: 0 }, { hasMore: true }, { total: 2 }, { workspaceId: "other" }, { payloadsRead: true }]) {
      const f = fixture(); Object.assign(f.page, patch); await expect(f.check()).rejects.toThrow(); expect(f.gateway.read).not.toHaveBeenCalled();
    }
  });
  it("rejects an edited file even if its length is unchanged", async () => {
    const f = fixture(); f.gateway.read.mockResolvedValue(new Uint8Array([104, 101, 108, 108, 112]).buffer);
    await expect(f.check()).rejects.toThrow("saved_resource_unconfirmed");
  });
  it("keeps permission denial and read failure unresolved without invoking any writer", async () => {
    const f = fixture(); f.gateway.read.mockRejectedValue(new Error("permission_denied"));
    await expect(f.check()).rejects.toThrow("permission_denied"); expect(Object.keys(f.gateway)).toEqual(["list", "read"]);
  });
  it("aborts before reading and drops a read completed after cancellation", async () => {
    const f = fixture(), abort = new AbortController(); abort.abort();
    await expect(f.check(abort.signal)).rejects.toThrow(); expect(f.gateway.list).not.toHaveBeenCalled();
    const next = new AbortController(); f.gateway.read.mockImplementation(async () => { next.abort(); return new ArrayBuffer(5); });
    await expect(f.check(next.signal)).rejects.toThrow();
  });
});

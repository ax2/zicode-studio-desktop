import { describe, expect, it, vi } from "vitest";
import { prepareProjectResource, confirmProjectResource } from "./project-file-resource.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const preview = { profile: "resource.local-file.draft1", owner, grantId: id, relativePath: "中文/a.zip", byteLength: 4, contentRead: false, confirmed: false };
function setup() {
  const access = { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) };
  const api = { choose: vi.fn(async () => preview.relativePath), prepare: vi.fn(async () => preview), cancel: vi.fn(async () => ({})),
    commit: vi.fn(async () => ({ ...access, access, confirmed: true, byteLength: 4, profile: preview.profile })) };
  const gateway = { revokeResource: vi.fn(async () => ({})) };
  return { api, gateway };
}
describe("project file confirmation", () => {
  it("only previews metadata after choice and commits on separate confirmation", async () => {
    const { api, gateway } = setup();
    const selected = await prepareProjectResource({ api, workspaceId: "ws", owner, isCurrent: () => true });
    expect(api.choose).toHaveBeenCalledWith("ws"); expect(api.commit).not.toHaveBeenCalled();
    const result = await confirmProjectResource({ api, preview: selected, gateway, isCurrent: () => true });
    expect(result.reference).toEqual({ capabilityId: "c", resourceId: id, contentVersion: "a".repeat(64) });
    expect(gateway.revokeResource).not.toHaveBeenCalled();
  });
  it("cancelled native choice never prepares, reads or commits", async () => {
    const { api } = setup(); api.choose.mockResolvedValue(null);
    expect(await prepareProjectResource({ api, workspaceId: "ws", owner, isCurrent: () => true })).toBeNull();
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.commit).not.toHaveBeenCalled();
  });
  it("late and malformed previews revoke grants without delivering them", async () => {
    const { api } = setup(); let current = true;
    api.prepare.mockImplementation(async () => { current = false; return preview; });
    await expect(prepareProjectResource({ api, workspaceId: "ws", owner, isCurrent: () => current })).rejects.toThrow();
    expect(api.cancel).toHaveBeenCalledWith(owner, id);
    current = true; api.prepare.mockResolvedValue({ ...preview, byteLength: 33 * 1024 * 1024 });
    await expect(prepareProjectResource({ api, workspaceId: "ws", owner, isCurrent: () => current })).rejects.toThrow();
  });
  it("stale or mismatched committed snapshots are revoked and never delivered", async () => {
    const { api, gateway } = setup(); let current = true;
    const original = await api.commit(); api.commit.mockImplementation(async () => { current = false; return original; });
    await expect(confirmProjectResource({ api, preview, gateway, isCurrent: () => current })).rejects.toThrow();
    expect(gateway.revokeResource).toHaveBeenCalledWith(original.access);
    current = true; api.commit.mockResolvedValue({ ...original, byteLength: 3 });
    await expect(confirmProjectResource({ api, preview, gateway, isCurrent: () => current })).rejects.toThrow();
  });
  it("does not retry a lost commit response", async () => {
    const { api, gateway } = setup(); api.commit.mockRejectedValue(new Error("network"));
    await expect(confirmProjectResource({ api, preview, gateway, isCurrent: () => true })).rejects.toThrow();
    expect(api.commit).toHaveBeenCalledTimes(1);
  });
});

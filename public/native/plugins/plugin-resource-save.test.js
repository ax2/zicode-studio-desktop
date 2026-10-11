import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourceSave } from "./plugin-resource-save.js";
const id = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
const resource = { resourceId: id, contentVersion: hash, mimeType: "image/png", byteLength: 100 };
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function fixture() {
  document.body.replaceChildren(); const container = document.createElement("div"); document.body.append(container);
  let target = { instanceId: "r", sessionId: "s", workspaceId: "w" };
  const receipt = { schemaVersion: 1, profile: "resource.save.draft1", saveId: id, workspaceId: "w", relativePath: `.zicode/outputs/${id}/result.png`,
    mimeType: "image/png", byteLength: 100, contentVersion: hash, source: { pluginId: "p", capabilityId: "c", resourceId: id } };
  const gateway = {
    prepareResourceSave: vi.fn(async () => ({ schemaVersion: 1, profile: "resource.save.draft1", grantId: id,
      requiresConfirmation: true, saved: false, expiresInSeconds: 60, operation: "create_new_file", preview: receipt })),
    commitResourceSave: vi.fn(async () => ({ schemaVersion: 1, profile: "resource.save.draft1", status: "saved", saved: true, replayed: false, receipt })),
  };
  const notify = vi.fn();
  const controller = createResourceSave({ gateway, getTarget: () => target, isCurrent: () => true, notify });
  controller.open(resource, owner, container);
  const click = async label => { const button = [...container.querySelectorAll("button")].find(item => item.textContent === label); expect(button).toBeTruthy(); button.click(); await flush(); };
  return { container, gateway, controller, notify, click, receipt, changeTarget: () => { target = { ...target, workspaceId: "another" }; } };
}
beforeEach(() => { setLocale("en"); resource.byteLength = 100; resource.contentVersion = hash; vi.stubGlobal("crypto", webcrypto); });
afterEach(() => vi.unstubAllGlobals());
describe("resource save consent", () => {
  it("prepares without saving, displays the exact destination and saves only after confirmation", async () => {
    const f = fixture(); await flush(); expect(f.gateway.commitResourceSave).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain(f.receipt.relativePath); expect(f.container.textContent).toContain("No file has been written yet");
    await f.click("Confirm save file"); expect(f.gateway.commitResourceSave).toHaveBeenCalledOnce();
    expect(f.container.textContent).toContain("Saved in the current project"); expect(f.notify).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it("cancel and Escape do not write", async () => {
    const f = fixture(); await flush(); await f.click("Cancel save");
    expect(f.gateway.commitResourceSave).not.toHaveBeenCalled(); expect(f.container.textContent).toBe("");
    f.controller.open(resource, owner, f.container); await flush();
    f.container.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(f.container.textContent).toBe(""); expect(f.gateway.commitResourceSave).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("rejects mismatched paths or owners before confirmation", async () => {
    const f = fixture(); f.receipt.relativePath = "../escape.png"; await flush();
    expect(f.container.textContent).not.toContain("../escape"); expect(f.container.textContent).toContain("Save could not be confirmed");
    expect(f.container.querySelectorAll("button").length).toBe(1); f.controller.destroy();
  });
  it("blocks confirmation after switching workspaces", async () => {
    const f = fixture(); await flush(); f.changeTarget(); await f.click("Confirm save file");
    expect(f.gateway.commitResourceSave).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("does not automatically retry ambiguous failures or expose arbitrary Host messages", async () => {
    const f = fixture(); await flush(); f.gateway.commitResourceSave.mockRejectedValue(new Error("private path secret"));
    await f.click("Confirm save file"); expect(f.container.textContent).not.toContain("private path secret");
    expect(f.container.textContent).toContain("no automatic retry"); expect(f.gateway.commitResourceSave).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it("keeps the confirmed request independent of view lifetime and reports late success", async () => {
    const f = fixture(); await flush(); let resolve; const result = await f.gateway.commitResourceSave();
    f.gateway.commitResourceSave.mockReturnValue(new Promise(done => { resolve = done; }));
    await f.click("Confirm save file"); const cancel = [...f.container.querySelectorAll("button")].find(button => button.textContent === "Cancel save");
    expect(cancel.disabled).toBe(true); f.controller.destroy(); resolve(result); await flush();
    expect(f.container.textContent).toBe(""); expect(f.notify).toHaveBeenCalledWith(expect.stringContaining(f.receipt.relativePath));
  });
  it("offers explicit read-only verification after a lost commit response, without replaying the writer", async () => {
    const f = fixture();
    resource.byteLength = f.receipt.byteLength = 5;
    resource.contentVersion = f.receipt.contentVersion = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    f.receipt.preparedAt = "2026-10-11T00:00:00Z"; f.receipt.source.packageVersion = "1.0.0";
    const item = { receipt: structuredClone(f.receipt), receiptVersion: "b".repeat(64), integrity: "not_checked" };
    f.gateway.savedOutputs = { list: vi.fn(async () => ({ schemaVersion: 1, profile: "resource.library.draft1", workspaceId: "w",
      offset: 0, pageSize: 40, payloadsRead: false, hasMore: false, total: 1, items: [item] })),
      read: vi.fn(async () => new Uint8Array([104, 101, 108, 108, 111]).buffer) };
    await flush(); f.gateway.commitResourceSave.mockRejectedValue(new Error("response_lost"));
    await f.click("Confirm save file"); expect(f.gateway.savedOutputs.list).not.toHaveBeenCalled();
    expect(f.container.textContent).not.toContain("confirmation expires");
    expect(f.container.textContent).toContain("does not undo or repeat the write");
    await f.click("Check saved file");
    await vi.waitFor(() => expect(f.container.textContent).toContain("Verified saved file:"));
    expect(f.gateway.commitResourceSave).toHaveBeenCalledOnce(); expect(f.gateway.prepareResourceSave).toHaveBeenCalledOnce();
    expect(f.container.textContent).not.toContain("Confirm save file"); f.controller.destroy();
    resource.byteLength = 100; resource.contentVersion = hash;
  });
  it("keeps failed checks uncertain and allows only another read-only check", async () => {
    const f = fixture(); f.gateway.savedOutputs = { list: vi.fn(async () => ({ items: [], total: 0 })) };
    await flush(); f.gateway.commitResourceSave.mockRejectedValue(new Error("response_lost"));
    await f.click("Confirm save file"); await f.click("Check saved file");
    expect(f.container.textContent).toContain("save may still have completed");
    await f.click("Check saved file"); expect(f.gateway.savedOutputs.list).toHaveBeenCalledTimes(2);
    expect(f.gateway.commitResourceSave).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it("suppresses duplicate checks and aborts a read-only check when the dialog closes", async () => {
    const f = fixture(); let resolveList, signal;
    f.gateway.savedOutputs = { list: vi.fn((_scene, _workspace, options) => { signal = options.signal; return new Promise(resolve => { resolveList = resolve; }); }) };
    await flush(); f.gateway.commitResourceSave.mockRejectedValue(new Error("response_lost"));
    await f.click("Confirm save file"); await f.click("Check saved file"); await f.click("Check saved file");
    expect(f.gateway.savedOutputs.list).toHaveBeenCalledOnce();
    await f.click("Close"); expect(signal.aborted).toBe(true);
    resolveList({ items: [], total: 0 }); await flush();
    expect(f.container.textContent).toBe(""); expect(f.notify).not.toHaveBeenCalled();
    expect(f.gateway.commitResourceSave).toHaveBeenCalledOnce(); f.controller.destroy();
  });
  it("does not check a former project after the workspace changes", async () => {
    const f = fixture(); f.gateway.savedOutputs = { list: vi.fn() };
    await flush(); f.gateway.commitResourceSave.mockRejectedValue(new Error("response_lost"));
    await f.click("Confirm save file"); f.changeTarget(); await f.click("Check saved file");
    expect(f.gateway.savedOutputs.list).not.toHaveBeenCalled(); f.controller.destroy();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(() => setLocale("en"));
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
});

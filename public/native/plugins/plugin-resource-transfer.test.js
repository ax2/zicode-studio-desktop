import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createResourceTransfer } from "./plugin-resource-transfer.js";
import { admission, reconciliation } from "../../../tests/helpers/resource-call-admission.js";

const id = "11111111-1111-4111-8111-111111111111", hash = "a".repeat(64);
const tool = { pluginId: "target", capabilityId: "consume", title: "Receiver", applicationName: "Tools", version: "0.1.0", enabled: true, runtime: "wasi", resourceInputMimeTypes: ["text/plain"] };
const owner = { runtimeId: "r", sessionId: "s", pluginId: "source", capabilityId: "produce" };
const resource = { resourceId: id, contentVersion: hash, mimeType: "text/plain", byteLength: 5 };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const container = document.createElement("div"); document.body.append(container);
  let target = { instanceId: "r", sessionId: "s", sceneId: "programming", workspaceId: "workspace" };
  const form = { prepare: vi.fn(() => ({ input: { flag: false, count: 0 } })), setDisabled: vi.fn(), destroy: vi.fn() };
  const gateway = {
    searchTools: vi.fn(async () => ({ schemaVersion: 1, revision: hash, items: [tool], offset: 0, nextOffset: null })),
    loadTool: vi.fn(async () => ({ schemaVersion: 1, pluginId: "target", version: "0.1.0", revision: hash, enabled: true,
      resourceInputProfile: "resource.wasi.input.draft2",
      capability: { id: "consume", resourceInputMimeTypes: ["text/plain"], inputSchema: { type: "object", properties: {} } }, permissions: [{ name: "resource.read", granted: true }] })),
    prepareResourceTransfer: vi.fn(async () => ({ schemaVersion: 1, profile: "resource.transfer.draft1", grantId: id, saved: false,
      requiresConfirmation: true, expiresInSeconds: 60, source: { pluginId: "source", capabilityId: "produce", resourceId: id, contentVersion: hash },
      target: { pluginId: "target", capabilityId: "consume", pluginName: "Tools", pluginVersion: "0.1.0", toolTitle: "Receiver" }, mimeType: "text/plain", byteLength: 5 })),
    commitResourceTransfer: vi.fn(async () => ({ schemaVersion: 1, profile: "resource.transfer.draft1", status: "committed", saved: false, replayed: false,
      reference: { capabilityId: "consume", resourceId: id, contentVersion: hash } })),
    invokeResource: vi.fn(async () => ({ schemaVersion: 1, operationId: id, source: { pluginId: "target", capabilityId: "consume", packageVersion: "0.1.0",
      profile: "resource.wasi.input.draft2", contentVersion: hash }, result: { text: "<script>safe text</script>" } })),
    cancelResource: vi.fn(async () => ({ schemaVersion: 1, status: "requested", executionFinished: false })), revokeResource: vi.fn(async () => ({})),
  };
  gateway.resourceCalls = { keep: vi.fn(async (target, owner, ticket) => ({ target, owner, ticket })), remove: vi.fn(async () => {}) };
  gateway.prepareResourceCall = vi.fn(async owner => admission(owner));
  gateway.reconcileResourceCall = vi.fn(async (owner, ticket) => reconciliation(owner, ticket.callId));
  gateway.invokeResourceCall = gateway.invokeResource;
  const mountInputs = vi.fn(async () => form);
  const onReceiverExecuted = vi.fn(async () => {});
  const controller = createResourceTransfer({ gateway, getTarget: () => target, isCurrent: () => true, mountInputs, onReceiverExecuted });
  controller.open(resource, owner, container);
  const click = async label => { const button = [...container.querySelectorAll("button")].find(b => b.textContent === label); expect(button).toBeTruthy(); button.click(); await flush(); };
  const choose = () => click("Receiver · Tools · 0.1.0");
  const confirm = async () => { await choose(); await click("Review sharing"); await click("Confirm sharing"); };
  return { container, gateway, form, mountInputs, onReceiverExecuted, controller, click, choose, confirm, changeTarget: () => { target = { ...target, sessionId: "other" }; } };
}
beforeEach(() => { document.body.replaceChildren(); setLocale("en"); });
describe("trusted resource transfer", () => {
  it("keeps pagination out of a single-page receiver directory", async () => {
    const f = fixture(); await flush();
    expect(f.container.querySelector('nav[aria-label="Tool pages"]').classList.contains("hidden")).toBe(true);
    expect(f.container.textContent).toContain("Receiver · Tools · 0.1.0");
    f.controller.destroy();
  });
  it("records only a successfully executed receiver in the current workspace", async () => {
    const f = fixture(); await flush(); await f.confirm();
    expect(f.onReceiverExecuted).not.toHaveBeenCalled();
    await f.click("Run receiving tool");
    expect(f.onReceiverExecuted).toHaveBeenCalledOnce();
    expect(f.onReceiverExecuted).toHaveBeenCalledWith(tool, expect.objectContaining({ sceneId: "programming", workspaceId: "workspace" }));
    const original = f.gateway.invokeResource.getMockImplementation();
    f.gateway.invokeResource.mockImplementation(async (...args) => ({
      ...await original(...args), result: { ok: false, error: { code: "INVALID_IMAGE" } },
    }));
    await f.click("Run receiving tool");
    expect(f.container.textContent).toContain("Tool reported an error. Inputs are kept and no result was saved.");
    expect(f.container.textContent).not.toContain("Receiving tool finished. Results have not been saved.");
    expect(f.container.textContent).toContain("Run receiving tool");
    expect(f.onReceiverExecuted).toHaveBeenCalledOnce();
    f.controller.destroy();
  });
  it("hides declared image receivers when the source resource is plain text", async () => {
    const f = fixture();
    const imageReceiver = { ...tool, title: "Image receiver", resourceInputMimeTypes: ["image/png"] };
    f.gateway.searchTools.mockResolvedValue({ schemaVersion: 1, revision: hash, items: [imageReceiver], offset: 0, nextOffset: null });
    await f.click("Search");
    expect(f.container.textContent).not.toContain("Image receiver · Tools · 0.1.0");
    expect(f.container.textContent).toContain("No compatible receiving tools on this page.");
    expect(f.gateway.loadTool).not.toHaveBeenCalled();
    f.controller.destroy();
  });

  it("discovers and runs the fixed built-in Host image receiver with its versioned profile", async () => {
    const f = fixture(); await flush();
    const receiver = { ...tool, pluginId: "com.zicode.resource-inspector", capabilityId: "image.inspect", runtime: "builtin", title: "Inspect image resource", resourceInputMimeTypes: ["image/png", "image/jpeg", "image/webp"] };
    f.gateway.searchTools.mockResolvedValue({ schemaVersion: 1, revision: hash, items: [receiver], offset: 0, nextOffset: null });
    f.gateway.loadTool.mockResolvedValue({ schemaVersion: 1, pluginId: receiver.pluginId, version: receiver.version, revision: hash,
      enabled: true, resourceInputProfile: "resource.host.image-input.v1",
      capability: { id: receiver.capabilityId, resourceInputMimeTypes: receiver.resourceInputMimeTypes, inputSchema: { type: "object", properties: {} } },
      permissions: [{ name: "resource.read", granted: true }] });
    f.gateway.prepareResourceTransfer.mockResolvedValue({ schemaVersion: 1, profile: "resource.transfer.draft1", grantId: id,
      saved: false, requiresConfirmation: true, expiresInSeconds: 60,
      source: { pluginId: "source", capabilityId: "produce", resourceId: id, contentVersion: hash },
      target: { pluginId: receiver.pluginId, capabilityId: receiver.capabilityId, pluginName: "Resource Inspector", pluginVersion: receiver.version, toolTitle: receiver.title },
      mimeType: "image/png", byteLength: 132 });
    f.gateway.commitResourceTransfer.mockResolvedValue({ schemaVersion: 1, profile: "resource.transfer.draft1", status: "committed",
      saved: false, replayed: false, reference: { pluginId: receiver.pluginId, capabilityId: receiver.capabilityId, resourceId: id, contentVersion: hash } });
    f.gateway.invokeResource.mockResolvedValue({ schemaVersion: 1, operationId: id,
      source: { pluginId: receiver.pluginId, capabilityId: receiver.capabilityId, packageVersion: receiver.version,
        profile: "resource.host.image-input.v1", contentVersion: hash },
      result: { ok: true, mimeType: "image/png", format: "png", width: 4, height: 2, byteLength: 132 } });
    f.form.prepare.mockReturnValue({ input: {} });
    f.controller.clear();
    f.controller.open({ ...resource, mimeType: "image/png", byteLength: 132 }, owner, f.container);
    await f.click("Search");
    await f.click(`${receiver.title} · Tools · ${receiver.version}`);
    expect(f.container.textContent).toContain("Review sharing before running this tool.");
    await f.click("Review sharing");
    await f.click("Confirm sharing");
    await f.click("Run receiving tool");
    expect(f.gateway.prepareResourceTransfer.mock.calls[0][1]).toMatchObject({ pluginId: receiver.pluginId, capabilityId: receiver.capabilityId });
    expect(f.gateway.invokeResourceCall).toHaveBeenCalledOnce();
    expect(f.container.textContent).toContain('"width": 4');
    expect(f.container.textContent).toContain("Results have not been saved");
    f.controller.destroy();
  });

  it("discovers and runs the fixed built-in Host text receiver for text/plain", async () => {
    const f = fixture(); await flush();
    const receiver = { ...tool, pluginId: "com.zicode.text-inspector", capabilityId: "text.inspect",
      runtime: "builtin", title: "Inspect text resource" };
    f.gateway.searchTools.mockResolvedValue({ schemaVersion: 1, revision: hash, items: [receiver], offset: 0, nextOffset: null });
    f.gateway.loadTool.mockResolvedValue({ schemaVersion: 1, pluginId: receiver.pluginId,
      version: receiver.version, revision: hash, enabled: true,
      resourceInputProfile: "resource.host.text-input.v1",
      capability: { id: receiver.capabilityId, resourceInputMimeTypes: ["text/plain"],
        inputSchema: { type: "object", properties: {} } },
      permissions: [{ name: "resource.read", granted: true }] });
    const grant = await f.gateway.prepareResourceTransfer();
    grant.target = { pluginId: receiver.pluginId, capabilityId: receiver.capabilityId,
      pluginName: "Text Inspector", pluginVersion: receiver.version, toolTitle: receiver.title };
    f.gateway.prepareResourceTransfer.mockResolvedValue(grant);
    f.gateway.commitResourceTransfer.mockResolvedValue({ schemaVersion: 1,
      profile: "resource.transfer.draft1", status: "committed", saved: false, replayed: false,
      reference: { pluginId: receiver.pluginId, capabilityId: receiver.capabilityId,
        resourceId: id, contentVersion: hash } });
    f.gateway.invokeResource.mockResolvedValue({ schemaVersion: 1, operationId: id,
      source: { pluginId: receiver.pluginId, capabilityId: receiver.capabilityId,
        packageVersion: receiver.version, profile: "resource.host.text-input.v1", contentVersion: hash },
      result: { ok: true, mimeType: "text/plain", byteLength: 5, charCount: 5,
        text: "hello", truncated: false } });
    f.form.prepare.mockReturnValue({ input: {} });
    f.controller.clear(); f.controller.open(resource, owner, f.container);
    await f.click("Search"); await f.click(`${receiver.title} · Tools · ${receiver.version}`);
    await f.click("Review sharing"); await f.click("Confirm sharing"); await f.click("Run receiving tool");
    expect(f.container.textContent).toContain('"text": "hello"');
    expect(f.gateway.invokeResourceCall).toHaveBeenCalledOnce();
    f.controller.destroy();
  });

  it("closes and releases owned access on the dialog cancellation action", async () => {
    const f = fixture(); await flush(); await f.confirm();
    const dialog = f.container.querySelector("dialog");
    expect(dialog.hasAttribute("open")).toBe(true);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true })); await flush();
    expect(f.container.querySelector("dialog")).toBeNull(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce();
  });
  it("loads schemas on selection only, confirms separately and executes typed inputs only on run", async () => {
    const f = fixture(); await flush();
    expect(f.gateway.searchTools).toHaveBeenCalledWith("programming", expect.objectContaining({ resourceOnly: true }), expect.any(AbortSignal));
    expect(f.gateway.searchTools).toHaveBeenCalledWith("programming", expect.objectContaining({
      resourceMimeType: "text/plain", excludePluginId: "source", excludeCapabilityId: "produce",
    }), expect.any(AbortSignal));
    expect(f.gateway.loadTool).not.toHaveBeenCalled();
    await f.choose(); expect(f.mountInputs).toHaveBeenCalledOnce();
    await f.click("Review sharing"); expect(f.gateway.commitResourceTransfer).not.toHaveBeenCalled();
    await f.click("Confirm sharing"); expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    await f.click("Run receiving tool");
    expect(f.gateway.invokeResource).toHaveBeenCalledWith({ ...owner, pluginId: "target", capabilityId: "consume" }, expect.objectContaining({ input: { flag: false, count: 0 } }), expect.objectContaining({ callId: expect.stringMatching(/^resource-call-/) }));
    expect(f.container.querySelector("pre").textContent).toContain("<script>safe text</script>"); expect(f.container.querySelector("script")).toBeNull();
    f.controller.destroy(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce();
  });
  it("cancelling the confirmation grants no access and does not execute", async () => {
    const f = fixture(); await flush(); await f.choose(); await f.click("Review sharing"); await f.click("Cancel sharing");
    expect(f.gateway.commitResourceTransfer).not.toHaveBeenCalled(); expect(f.gateway.invokeResource).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("revokes a late committed reference after closing", async () => {
    const f = fixture(); await flush(); await f.choose(); await f.click("Review sharing");
    const pending = deferred(), original = await f.gateway.commitResourceTransfer(); f.gateway.commitResourceTransfer.mockReturnValue(pending.promise);
    await f.click("Confirm sharing"); f.controller.clear(); pending.resolve(original); await flush();
    expect(f.gateway.revokeResource).toHaveBeenCalledWith(expect.objectContaining({ owner: { ...owner, pluginId: "target", capabilityId: "consume" } }));
    expect(f.container.textContent).toBe("");
  });
  it("blocks a stale session from committing or running", async () => {
    const f = fixture(); await flush(); await f.choose(); await f.click("Review sharing"); f.changeTarget(); await f.click("Confirm sharing");
    expect(f.gateway.commitResourceTransfer).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("does not show late schema loads after selection closes", async () => {
    const f = fixture(); await flush(); const pending = deferred(); f.gateway.loadTool.mockReturnValue(pending.promise);
    await f.choose(); f.controller.clear(); pending.resolve({}); await flush(); expect(f.mountInputs).not.toHaveBeenCalled();
  });
  it("cancels independently and keeps the transferred reference until execution settles", async () => {
    const f = fixture(); await flush(); await f.confirm(); const pending = deferred(); f.gateway.invokeResource.mockReturnValue(pending.promise);
    await f.click("Run receiving tool"); await f.click("Cancel execution"); expect(f.gateway.reconcileResourceCall).toHaveBeenCalledOnce();
    f.controller.destroy(); expect(f.gateway.revokeResource).not.toHaveBeenCalled();
    pending.resolve({}); await flush(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce();
  });
  it("rejects mismatched grants without exposing Host errors", async () => {
    const f = fixture(); await flush(); await f.choose();
    const grant = await f.gateway.prepareResourceTransfer(); grant.target.pluginId = "unexpected";
    f.gateway.prepareResourceTransfer.mockResolvedValue(grant); await f.click("Review sharing");
    expect(f.container.textContent).toContain("Transfer unavailable"); expect(f.container.textContent).not.toContain("unexpected");
    expect(f.gateway.commitResourceTransfer).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("releases the shared reference when an uncertain transfer is explicitly closed", async () => {
    const f = fixture(); await flush(); await f.confirm(); f.gateway.invokeResource.mockRejectedValue({});
    await f.click("Run receiving tool"); expect(f.container.textContent).toContain("Execution outcome is unknown");
    const pending = deferred(); f.gateway.reconcileResourceCall.mockReturnValue(pending.promise);
    await f.click("Stop and recover call"); f.controller.clear();
    expect(f.gateway.revokeResource).toHaveBeenCalledOnce();
    pending.resolve({}); await flush(); expect(f.container.querySelector("dialog")).toBeNull(); f.controller.destroy();
  });
  it("retains parameters after a timeout and never retries automatically", async () => {
    const f = fixture(); await flush(); await f.confirm();
    f.gateway.invokeResource.mockRejectedValue(Object.assign(new Error("private server message"), { code: "worker_timeout" }));
    await f.click("Run receiving tool");
    expect(f.container.textContent).toContain("Execution outcome is unknown"); expect(f.container.textContent).not.toContain("private server message");
    expect(f.container.textContent).not.toContain("Run receiving tool");
    await f.click("Stop and recover call"); expect(f.container.textContent).toContain("tool is still active");
    f.gateway.reconcileResourceCall.mockImplementation(async (owner, call) => reconciliation(owner, call.callId, "ended"));
    await f.click("Stop and recover call"); expect(f.container.textContent).toContain("Its result was not recovered");
    expect(f.gateway.invokeResource).toHaveBeenCalledOnce(); expect(f.form.destroy).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("explains invalid receiver input without clearing recovery", async () => {
    const f = fixture(); await flush(); await f.confirm();
    f.gateway.invokeResource.mockRejectedValue({ code: "resource_input_invalid", message: "private E:\\secret" });
    await f.click("Run receiving tool");
    expect(f.container.textContent).toContain("This resource is invalid or exceeds the receiver's format or size limits.");
    expect(f.container.textContent).toContain("Execution outcome is unknown");
    expect(f.container.textContent).not.toContain("E:\\secret");
    expect(f.container.textContent).toContain("Stop and recover call");
    f.controller.destroy();
  });
  it("does not execute invalid inputs and leaves the confirmed reference available for correction", async () => {
    const f = fixture(); await flush(); await f.confirm(); f.form.prepare.mockReturnValue({ error: "Choose a value for this required field.", field: "flag" });
    await f.click("Run receiving tool"); expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    expect(f.container.textContent).toContain("Choose a value"); f.controller.destroy();
  });
  it("navigates both directions through a large receiver directory and clears pagination on a new query", async () => {
    const f = fixture(); await flush();
    f.gateway.searchTools.mockImplementation(async (_scene, { offset }) => ({ schemaVersion: 1, revision: hash,
      items: offset === 0 ? Array.from({ length: 40 }, () => tool) : [tool], total: 41, pageSize: 40,
      offset, nextOffset: offset === 0 ? 40 : null }));
    await f.click("Search"); await f.click("Next page");
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({ offset: 40, revision: hash }), expect.any(AbortSignal));
    expect(f.container.textContent).toContain("Showing 41–41 of 41");
    await f.click("Previous page");
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({ offset: 0, revision: null }), expect.any(AbortSignal));
    expect(f.container.textContent).toContain("Showing 1–40 of 41");
    const input = f.container.querySelector("input"); input.value = "changed"; input.dispatchEvent(new Event("input"));
    expect(f.container.querySelector('nav[aria-label="Tool pages"]').classList.contains("hidden")).toBe(true);
    expect([...f.container.querySelectorAll("button")].find(b => b.textContent === "Next page").disabled).toBe(true); f.controller.destroy();
  });
  it("discards an in-flight search when the query changes", async () => {
    const f = fixture(); await flush();
    const pending = deferred();
    f.gateway.searchTools.mockReturnValue(pending.promise);
    await f.click("Search");
    const staleSignal = f.gateway.searchTools.mock.lastCall[2];
    const input = f.container.querySelector('input[type="search"]');
    input.value = "new query";
    input.dispatchEvent(new Event("input"));
    expect(staleSignal.aborted).toBe(true);
    pending.resolve({ schemaVersion: 1, revision: hash, items: [tool], offset: 0, nextOffset: null });
    await flush();
    expect(f.container.textContent).not.toContain("Receiver · Tools · 0.1.0");
    await f.click("Search");
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({ query: "new query" }), expect.any(AbortSignal));
    expect(f.container.textContent).toContain("Receiver · Tools · 0.1.0");
    f.controller.destroy();
  });
  it("cancels a receiving-tool search when the transfer closes", async () => {
    const f = fixture(); await flush();
    const pending = deferred(); f.gateway.searchTools.mockReturnValue(pending.promise);
    await f.click("Search");
    const signal = f.gateway.searchTools.mock.lastCall[2];
    expect(signal.aborted).toBe(false);
    f.controller.clear();
    expect(signal.aborted).toBe(true);
    pending.resolve({ schemaVersion: 1, revision: hash, items: [tool], offset: 0, nextOffset: null });
    await flush();
    expect(f.container.querySelector("dialog")).toBeNull();
    expect(f.gateway.loadTool).not.toHaveBeenCalled();
  });
  it("filters a large receiver directory by source, category and project history before loading details", async () => {
    const f = fixture(); await flush();
    f.gateway.searchTools.mockResolvedValue({ schemaVersion: 1, revision: hash, items: [tool], offset: 0,
      nextOffset: 1, accessRevision: 7,
      sources: [{ pluginId: "target", title: "Tools", count: 12 }],
      categories: [{ id: "text", count: 12 }] });
    await f.click("Search");
    const source = f.container.querySelector('select[aria-label="Tool source"]');
    source.value = "target"; source.dispatchEvent(new Event("change")); await flush();
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({ pluginId: "target", offset: 0 }), expect.any(AbortSignal));
    const category = f.container.querySelector('select[aria-label="Tool category"]');
    category.value = "text"; category.dispatchEvent(new Event("change")); await flush();
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({ categoryId: "text", offset: 0 }), expect.any(AbortSignal));
    await f.click("Favorite tools");
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({
      view: "favorites", workspaceId: "workspace", accessRevision: null, offset: 0 }), expect.any(AbortSignal));
    await f.click("Next page");
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({
      view: "favorites", workspaceId: "workspace", accessRevision: 7, offset: 1, revision: hash }), expect.any(AbortSignal));
    await f.click("Recently used tools");
    expect(f.gateway.searchTools).toHaveBeenLastCalledWith("programming", expect.objectContaining({
      view: "recent", workspaceId: "workspace", offset: 0 }), expect.any(AbortSignal));
    expect(f.gateway.loadTool).not.toHaveBeenCalled();
    f.controller.destroy();
  });
});

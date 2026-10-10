import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createPluginResourceSelection } from "./plugin-resource-selection.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const digest = "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81";
const item = { receiptVersion: "a".repeat(64), integrity: "not_checked", receipt: {
  schemaVersion: 1, profile: "resource.save.draft1", workspaceId: "ws", saveId: id,
  relativePath: `.zicode/outputs/${id}/result.txt`, byteLength: 3, mimeType: "text/plain", contentVersion: digest,
  source: { pluginId: "source", capabilityId: "output", packageVersion: "1", resourceId: id },
} };
function fixture() {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto); document.body.innerHTML = "<main></main>";
  const savedOutputs = { list: vi.fn(async (_s, _w, filters) => ({ schemaVersion: 1, profile: "resource.library.draft1", workspaceId: "ws", pageSize: 40, offset: filters.offset, total: 41, hasMore: filters.offset === 0, skippedEntries: 0, payloadsRead: false, items: [item] })), read: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer) };
  const gateway = { savedOutputs, prepareResource: vi.fn(async () => ({ resourceId: id })), appendResource: vi.fn(async () => ({ uploadedBytes: 3 })), commitResource: vi.fn(async access => ({ ...access, confirmed: true, byteLength: 3 })), revokeResource: vi.fn(async () => ({})) };
  let current = true; const onResource = vi.fn();
  const controller = createPluginResourceSelection({ container: document.querySelector("main"), plugin: { id: "receiver", name: "Receiver", version: "2", capabilities: [{ id: "consume", title: "Consume" }] }, target: { instanceId: "r", sessionId: "s", sceneId: "programming", workspaceId: "ws" }, gateway, isCurrent: () => current, onResource });
  const button = name => [...document.querySelectorAll("button")].find(b => b.textContent === name);
  async function select() { button("Use a saved project file").click(); await vi.waitFor(() => expect(button("Select saved file")).toBeTruthy()); button("Select saved file").click(); }
  return { gateway, savedOutputs, onResource, controller, button, select, switchTarget: () => { current = false; } };
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; setLocale("zh-CN"); });
describe("saved project snapshot input", () => {
  it("lists/selects metadata only, confirms exact bytes for receiver, then revokes independently", async () => {
    const f = fixture(); await f.select();
    expect(f.savedOutputs.read).not.toHaveBeenCalled(); expect(f.gateway.prepareResource).not.toHaveBeenCalled();
    f.button("Confirm file sharing").click(); await vi.waitFor(() => expect(f.onResource).toHaveBeenCalledTimes(1));
    expect(f.gateway.prepareResource).toHaveBeenCalledWith(expect.objectContaining({ contentVersion: digest, owner: { runtimeId: "r", sessionId: "s", pluginId: "receiver", capabilityId: "consume" } }));
    f.button("Cancel file sharing").click(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce(); expect(f.onResource).toHaveBeenLastCalledWith(null); f.controller.destroy();
  });
  it("searches and pages without payload reads and discards previous selection", async () => {
    const f = fixture(); await f.select(); f.button("Next page").click();
    await vi.waitFor(() => expect(f.savedOutputs.list).toHaveBeenCalledTimes(2));
    expect(f.savedOutputs.list.mock.calls[1][2].offset).toBe(40); expect(f.button("Confirm file sharing").disabled).toBe(true);
    const input = document.querySelector('input[type="search"]'); input.value = "source"; input.form.dispatchEvent(new Event("submit", { cancelable: true }));
    await vi.waitFor(() => expect(f.savedOutputs.list).toHaveBeenCalledTimes(3)); expect(f.savedOutputs.list.mock.calls[2][2]).toMatchObject({ query: "source", offset: 0 }); expect(f.savedOutputs.read).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("rejects same-length changed bytes before resource allocation", async () => {
    const f = fixture(); await f.select(); f.savedOutputs.read.mockResolvedValue(new Uint8Array([3, 2, 1]).buffer);
    f.button("Confirm file sharing").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("File sharing failed"));
    expect(f.gateway.prepareResource).not.toHaveBeenCalled(); expect(f.onResource).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it.each(["cancel", "destroy", "switch"])("drops an in-flight read after %s without publishing", async action => {
    const f = fixture(); await f.select(); let finish;
    f.savedOutputs.read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    f.button("Confirm file sharing").click(); await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const signal = f.savedOutputs.read.mock.calls[0][3];
    if (action === "cancel") f.button("Cancel file sharing").click(); else if (action === "destroy") f.controller.destroy(); else f.switchTarget();
    if (action !== "switch") expect(signal.aborted).toBe(true);
    if (action === "switch") f.controller.destroy();
    finish(new Uint8Array([1, 2, 3]).buffer); await vi.waitFor(() => expect(f.button("Use a saved project file")?.disabled ?? false).toBe(false));
    expect(f.gateway.prepareResource).not.toHaveBeenCalled(); expect(f.onResource).not.toHaveBeenCalled(); f.controller.destroy();
  });
  it("rejects wrong-project or unknown metadata without offering a file", async () => {
    const f = fixture(); f.savedOutputs.list.mockResolvedValue({ schemaVersion: 1, profile: "resource.library.draft1", workspaceId: "foreign", items: [item] });
    f.button("Use a saved project file").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("Saved files could not be loaded")); expect(f.button("Select saved file")).toBeUndefined(); f.controller.destroy();
  });
});

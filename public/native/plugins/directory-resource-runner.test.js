import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createDirectoryResourceRunner } from "./directory-resource-runner.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roots = [];
function fixture(overrides = {}) {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto); document.body.innerHTML = "<main></main>";
  let target = { instanceId: "runtime", sessionId: "session", workspaceId: "workspace", sceneId: "programming" };
  const tool = { pluginId: "receiver", capabilityId: "consume", title: "Consume", applicationName: "Receiver", version: "1", runtime: "wasi" };
  const detail = { pluginId: tool.pluginId, version: "1", revision: "a".repeat(64), enabled: true, resourceInputProfile: "resource.wasi.input.draft2", capability: { id: tool.capabilityId, inputSchema: {} }, permissions: [{ name: "resource.read", granted: true }] };
  const gateway = { loadTool: vi.fn(async () => detail), prepareResource: vi.fn(async () => ({ resourceId: id })), appendResource: vi.fn(async () => ({ uploadedBytes: 3 })), commitResource: vi.fn(async access => ({ ...access, confirmed: true, byteLength: 3 })), revokeResource: vi.fn(async () => ({})), readResource: vi.fn(async () => ({})), cancelResource: vi.fn(async () => ({ schemaVersion: 1, status: "requested", executionFinished: false })),
    invokeResource: vi.fn(async (owner, request) => ({ schemaVersion: 1, operationId: id, source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" }, result: { text: "received <script>literal</script>" } })), ...overrides };
  const form = { prepare: vi.fn(() => ({ input: { count: 0, flag: false } })), setDisabled: vi.fn(), destroy: vi.fn() };
  const onBusy = vi.fn(), onSuccess = vi.fn(async () => {});
  const controller = createDirectoryResourceRunner({ container: document.querySelector("main"), tool, detail, gateway, getTarget: () => target, onBusy, onSuccess, mountInputs: async () => form }); roots.push(controller);
  const button = name => [...document.querySelectorAll("button")].find(b => b.textContent === name);
  async function share() {
    const file = { name: "input.txt", size: 3, type: "text/plain", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    const input = document.querySelector('input[type="file"]'); Object.defineProperty(input, "files", { value: [file] }); input.dispatchEvent(new Event("change"));
    button("Confirm file sharing").click(); await vi.waitFor(() => expect(button("Execute tool").disabled).toBe(false));
  }
  return { gateway, form, onBusy, onSuccess, controller, button, share, switchTarget: () => { target = { ...target, sessionId: "other" }; } };
}
afterEach(() => { for (const root of roots.splice(0)) root.destroy(); vi.unstubAllGlobals(); document.body.innerHTML = ""; setLocale("zh-CN"); });
describe("directory-owned resource execution", () => {
  it("opens without reading/running, confirms catalog-bound input, then executes separately and escapes output", async () => {
    const f = fixture(); expect(f.gateway.prepareResource).not.toHaveBeenCalled(); expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    await f.share(); expect(f.gateway.prepareResource).toHaveBeenCalledWith(expect.objectContaining({ catalogRevision: "a".repeat(64), owner: { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" } })); expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    f.button("Execute tool").click(); await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.invokeResource.mock.calls[0][1].input).toEqual({ count: 0, flag: false }); expect(document.querySelector("script")).toBeNull(); expect(document.querySelector(".tool-result").textContent).toContain("<script>literal</script>");
    f.button("Cancel file sharing").click(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce(); expect(document.querySelector(".tool-result").textContent).toBe("");
  });
  it("cancels a pending catalog recheck without starting a Worker", async () => {
    const f = fixture(); await f.share(); let resolve;
    f.gateway.loadTool.mockImplementation(() => new Promise(done => { resolve = done; }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(resolve).toBeTypeOf("function")); f.button("Cancel tool").click();
    resolve({ enabled: true, revision: "a".repeat(64), version: "1" }); await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false));
    expect(f.gateway.invokeResource).not.toHaveBeenCalled(); expect(document.body.textContent).toContain("cancelled");
  });
  it("cancels execution independently and keeps the run control blocked until it settles", async () => {
    const f = fixture(); await f.share(); let reject;
    f.gateway.invokeResource.mockImplementation(() => new Promise((_done, fail) => { reject = fail; }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(reject).toBeTypeOf("function")); f.button("Cancel tool").click();
    await vi.waitFor(() => expect(f.gateway.cancelResource).toHaveBeenCalledOnce()); expect(f.button("Execute tool").disabled).toBe(true);
    reject({ code: "worker_cancelled" }); await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false)); expect(f.onSuccess).not.toHaveBeenCalled();
  });
  it("rejects changed catalog metadata before invoking", async () => {
    const f = fixture(); await f.share(); f.gateway.loadTool.mockRejectedValue({ code: "catalog_changed" }); f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onBusy).toHaveBeenLastCalledWith(false)); expect(f.gateway.invokeResource).not.toHaveBeenCalled(); expect(f.onSuccess).not.toHaveBeenCalled();
  });
  it("does not execute after session changes, and disposes the granted reference", async () => {
    const f = fixture(); await f.share(); f.switchTarget(); f.button("Execute tool").click(); expect(f.gateway.invokeResource).not.toHaveBeenCalled(); f.controller.destroy(); expect(f.gateway.revokeResource).toHaveBeenCalledOnce();
  });
  it("does not record business errors as successful recent use", async () => {
    const f = fixture(); await f.share(); const original = f.gateway.invokeResource.getMockImplementation();
    f.gateway.invokeResource.mockImplementation(async (...args) => ({ ...await original(...args), result: { ok: false, error: { code: "INVALID_INPUT" } } }));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(document.querySelector(".tool-result").textContent).toContain("INVALID_INPUT")); expect(f.onSuccess).not.toHaveBeenCalled();
  });
});

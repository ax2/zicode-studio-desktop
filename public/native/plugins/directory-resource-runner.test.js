import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { createDirectoryResourceRunner } from "./directory-resource-runner.js";
import { admission, reconciliation } from "../../../tests/helpers/resource-call-admission.js";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roots = [];
function fixture(overrides = {}, maxResources = 1, directory = false) {
  setLocale("en"); vi.stubGlobal("crypto", webcrypto); document.body.innerHTML = "<main></main>";
  let target = { instanceId: "runtime", sessionId: "session", workspaceId: "workspace", sceneId: "programming" };
  const tool = { pluginId: "receiver", capabilityId: "consume", title: "Consume", applicationName: "Receiver", version: "1", runtime: "wasi" };
  const detail = { pluginId: tool.pluginId, version: "1", revision: "a".repeat(64), enabled: true, resourceInputProfile: "resource.wasi.input.draft2", capability: { id: tool.capabilityId, inputSchema: {}, ...(maxResources > 1 ? { resourceInputMax: maxResources } : {}) }, permissions: [{ name: "resource.read", granted: true }, ...(directory ? [{ name: "resource.directory.read", granted: true }] : [])] };
  const gateway = { loadTool: vi.fn(async () => detail), prepareResource: vi.fn(async () => ({ resourceId: id })), appendResource: vi.fn(async () => ({ uploadedBytes: 3 })), commitResource: vi.fn(async access => ({ ...access, confirmed: true, byteLength: 3 })), revokeResource: vi.fn(async () => ({})), readResource: vi.fn(async () => ({})), cancelResource: vi.fn(async () => ({ schemaVersion: 1, status: "requested", executionFinished: false })),
    invokeResource: vi.fn(async (owner, request) => ({ schemaVersion: 1, operationId: id, source: { ...owner, contentVersion: request.contentVersion, packageVersion: "1", profile: "resource.wasi.input.draft2" }, result: { text: "received <script>literal</script>" } })), ...overrides };
  gateway.resourceCalls = { keep: vi.fn(async (target, owner, ticket) => ({ target, owner, ticket })), remove: vi.fn(async () => {}) };
  gateway.prepareResourceCall = vi.fn(async owner => admission(owner));
  gateway.reconcileResourceCall = vi.fn(async (owner, ticket) => reconciliation(owner, ticket.callId));
  gateway.invokeResourceCall = gateway.invokeResource;
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
  it("requires separate directory selection, sharing confirmation and execution", async () => {
    const owner = { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" };
    const projectDirectories = {
      choose: vi.fn(async () => "src"),
      prepare: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: false, entryNamesRead: false, relativePath: "src", owner, grantId: id })),
      commit: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: true, entryCount: 2, access: { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) } })),
      cancel: vi.fn(async () => ({})),
    };
    const f = fixture({ projectDirectories }, 1, true);
    expect(f.button("Project directory")).toBeTruthy();
    f.button("Project directory").click();
    expect(projectDirectories.choose).not.toHaveBeenCalled();
    f.button("Choose a project directory").click();
    await vi.waitFor(() => expect(f.button("Confirm directory sharing").disabled).toBe(false));
    expect(projectDirectories.prepare).toHaveBeenCalledWith(owner, "src");
    expect(projectDirectories.commit).not.toHaveBeenCalled();
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    f.button("Confirm directory sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    expect(projectDirectories.commit).toHaveBeenCalledWith(owner, id);
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.invokeResource.mock.calls[0][1]).toMatchObject({ resourceId: id, contentVersion: "a".repeat(64) });
    f.button("Files").click();
    expect(f.gateway.revokeResource).toHaveBeenCalledWith({ schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) });
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("cancels a pending directory grant without executing", async () => {
    const owner = { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" };
    const projectDirectories = { choose: vi.fn(async () => "."), prepare: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: false, entryNamesRead: false, relativePath: ".", owner, grantId: id })), commit: vi.fn(), cancel: vi.fn(async () => ({})) };
    const f = fixture({ projectDirectories }, 1, true);
    f.button("Project directory").click(); f.button("Choose a project directory").click();
    await vi.waitFor(() => expect(f.button("Confirm directory sharing").disabled).toBe(false));
    f.button("Cancel directory sharing").click();
    expect(projectDirectories.cancel).toHaveBeenCalledWith(owner, id);
    expect(projectDirectories.commit).not.toHaveBeenCalled();
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("revokes a directory resource returned after the user canceled confirmation", async () => {
    const owner = { runtimeId: "runtime", sessionId: "session", pluginId: "receiver", capabilityId: "consume" };
    const access = { schemaVersion: 1, owner, resourceId: id, contentVersion: "a".repeat(64) };
    let finishCommit;
    const projectDirectories = {
      choose: vi.fn(async () => "."),
      prepare: vi.fn(async () => ({ profile: "resource.local-directory.draft1", confirmed: false, entryNamesRead: false, relativePath: ".", owner, grantId: id })),
      commit: vi.fn(() => new Promise(resolve => { finishCommit = resolve; })),
      cancel: vi.fn(async () => ({})),
    };
    const f = fixture({ projectDirectories }, 1, true);
    f.button("Project directory").click(); f.button("Choose a project directory").click();
    await vi.waitFor(() => expect(f.button("Confirm directory sharing").disabled).toBe(false));
    f.button("Confirm directory sharing").click();
    await vi.waitFor(() => expect(finishCommit).toBeTypeOf("function"));
    f.button("Cancel directory sharing").click();
    finishCommit({ profile: "resource.local-directory.draft1", confirmed: true, entryCount: 1, access });
    await vi.waitFor(() => expect(f.gateway.revokeResource).toHaveBeenCalledWith(access));
    expect(f.gateway.invokeResource).not.toHaveBeenCalled();
    expect(f.button("Execute tool").disabled).toBe(true);
  });
  it("passes a confirmed two-file group through one-use invocation", async () => {
    const f = fixture({}, 2);
    const ids = [id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]; let next = 0;
    f.gateway.prepareResource.mockImplementation(async () => ({ resourceId: ids[next++] }));
    const makeFile = text => ({ name: `${text}.txt`, size: 3, type: "text/plain",
      arrayBuffer: async () => new TextEncoder().encode(text).buffer });
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { value: [makeFile("one"), makeFile("two")] });
    input.dispatchEvent(new Event("change"));
    expect(f.gateway.prepareResource).not.toHaveBeenCalled();
    f.button("Confirm file sharing").click();
    await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false));
    f.button("Execute tool").click();
    await vi.waitFor(() => expect(f.onSuccess).toHaveBeenCalledOnce());
    expect(f.gateway.invokeResourceCall.mock.calls[0][1].additionalResources).toEqual([
      { resourceId: ids[1], contentVersion: expect.stringMatching(/^[0-9a-f]{64}$/) },
    ]);
    f.button("Cancel file sharing").click();
    expect(f.gateway.revokeResource).toHaveBeenCalledTimes(2);
  });
  it("protects busy state across active and changed-Host checks without replaying", async () => {
    const f = fixture(); await f.share(); f.gateway.invokeResource.mockRejectedValue(new Error("lost response"));
    f.button("Execute tool").click(); await vi.waitFor(() => expect(f.button("Stop and recover call").hidden).toBe(false));
    f.button("Stop and recover call").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("tool is still active"));
    expect(f.button("Execute tool").disabled).toBe(true); expect(f.onBusy).toHaveBeenLastCalledWith(true);
    f.gateway.reconcileResourceCall.mockRejectedValue({ code: "resource_call_host_changed" });
    f.button("Stop and recover call").click(); await vi.waitFor(() => expect(document.body.textContent).toContain("Studio restarted"));
    expect(f.button("Execute tool").disabled).toBe(true); expect(f.gateway.invokeResource).toHaveBeenCalledOnce();
  });
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
    await vi.waitFor(() => expect(f.gateway.reconcileResourceCall).toHaveBeenCalledOnce()); expect(f.button("Execute tool").disabled).toBe(true);
    reject({ code: "worker_cancelled" }); await vi.waitFor(() => expect(f.button("Stop and recover call").hidden).toBe(false));
    expect(f.button("Execute tool").disabled).toBe(true);
    f.gateway.reconcileResourceCall.mockImplementation(async (owner, call) => reconciliation(owner, call.callId, "ended"));
    f.button("Stop and recover call").click(); await vi.waitFor(() => expect(f.button("Execute tool").disabled).toBe(false)); expect(f.onSuccess).not.toHaveBeenCalled();
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

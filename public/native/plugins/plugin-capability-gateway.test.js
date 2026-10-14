import { describe, expect, it, vi } from "vitest";
import { PluginCapabilityGateway } from "./plugin-capability-gateway.js";

it("keeps resource prepare, one-use invoke and mutating reconciliation separate", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
  const input = { resourceId: "id", contentVersion: "hash", input: { count: 0, flag: false }, toolCallId: "untrusted" };
  const ticket = { callId: "resource-call-ticket", hostInstanceId: "host", privatePath: "hidden" };
  await gateway.prepareResourceCall(owner, input);
  await gateway.invokeResourceCall(owner, input, ticket);
  await gateway.reconcileResourceCall(owner, ticket);
  expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
    "/v2/plugin-resources/prepare-call", "/v2/plugin-resources/invoke-call", "/v2/plugin-resources/reconcile-call",
  ]);
  const bodies = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(bodies[0]).toEqual({ schemaVersion: 1, access: { schemaVersion: 1, owner, resourceId: "id", contentVersion: "hash" }, input: input.input });
  expect(bodies[1]).toEqual({ access: bodies[0].access, input: input.input, callId: ticket.callId, hostInstanceId: "host" });
  expect(bodies[2]).toEqual({ schemaVersion: 1, owner, callId: ticket.callId, hostInstanceId: "host" });
});

it("binds each additional resource to the same owner in both one-use requests", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
  const request = { resourceId: "first", contentVersion: "a", additionalResources: [
    { resourceId: "second", contentVersion: "b" }, { resourceId: "third", contentVersion: "c" }], input: {} };
  await gateway.prepareResourceCall(owner, request);
  await gateway.invokeResourceCall(owner, request, { callId: "call", hostInstanceId: "host" });
  const [prepared, invoked] = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
  expect(prepared.additionalAccesses).toEqual([
    { schemaVersion: 1, owner, resourceId: "second", contentVersion: "b" },
    { schemaVersion: 1, owner, resourceId: "third", contentVersion: "c" },
  ]);
  expect(invoked.additionalAccesses).toEqual(prepared.additionalAccesses);
});

describe("PluginCapabilityGateway", () => {
  it("sends only Host-derived ownership and cursor for model discovery", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.listServiceModels({ runtimeId: "r", sessionId: "s", pluginId: "p" }, "128");
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-services/models");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      schemaVersion: 1, runtimeId: "r", sessionId: "s", pluginId: "p", cursor: "128",
    });
  });
  it("forwards a bounded Explorer selection count as metadata-only discovery", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { resourceOnly: true, selectedFileCount: 2,
      fileNames: ["one.txt", "two.zip"] });
    const url = fetchImpl.mock.calls[0][0];
    expect(url.pathname).toBe("/v2/plugin-tool-directory");
    expect(url.searchParams.get("selectedFileCount")).toBe("2");
    expect(JSON.parse(url.searchParams.get("fileNames"))).toEqual(["one.txt", "two.zip"]);
    expect(url.searchParams.get("fileName")).toBeNull();
    expect(fetchImpl.mock.calls[0][1].body).toBeUndefined();
  });
  it("keeps directory selection separate from explicit metadata sharing", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const choose = vi.fn(async () => "folder");
    const entry = vi.fn(async () => ".");
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" }, pickProjectDirectory: choose, getProjectDirectoryEntry: entry });
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    expect(await gateway.projectDirectories.entry("workspace")).toBe(".");
    expect(entry).toHaveBeenCalledWith("workspace");
    expect(await gateway.projectDirectories.choose("workspace")).toBe("folder");
    expect(fetchImpl).not.toHaveBeenCalled();
    await gateway.projectDirectories.prepare(owner, "folder");
    await gateway.projectDirectories.commit(owner, "grant");
    await gateway.projectDirectories.cancel(owner, "other-grant");
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/v2/plugin-resources/prepare-local-directory",
      "/v2/plugin-resources/commit-local-directory",
      "/v2/plugin-resources/cancel-local-directory",
    ]);
    expect(fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body))).toEqual([
      { schemaVersion: 1, owner, relativePath: "folder" },
      { schemaVersion: 1, owner, grantId: "grant", confirmed: true },
      { schemaVersion: 1, owner, grantId: "other-grant" },
    ]);
  });
  it("queries local file state without preparing, confirming or executing it", async () => {
    const state = { schemaVersion: 1, phase: "reading", executionFinished: false, cancellationRequested: true, contentRead: null };
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => state }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" }, pickProjectFile: async () => null });
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    expect(await gateway.projectFiles.status(owner, "grant")).toEqual(state);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-resources/status-local-file");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ schemaVersion: 1, owner, grantId: "grant" });
  });
  it("separates readonly resource status from execution and preserves the captured Host fence", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    await gateway.resourceCallStatus(owner, "call");
    await gateway.resourceCallStatus(owner, "call", "host");
    await gateway.invokeResource(owner, { toolCallId: "call", resourceId: "resource", contentVersion: "hash", hostInstanceId: "host" });
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(["/v2/plugin-resources/call-status", "/v2/plugin-resources/call-status", "/v2/plugin-resources/invoke-view"]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).hostInstanceId).toBeUndefined();
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).hostInstanceId).toBe("host");
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body).hostInstanceId).toBe("host");
  });
  it("separates resource save preview from confirmed write without caller paths", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const source = { schemaVersion: 1, owner: { pluginId: "p" }, resourceId: "id", contentVersion: "hash" };
    await gateway.prepareResourceSave(source); await gateway.commitResourceSave(source, "grant");
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual(["/v2/plugin-resources/prepare-save", "/v2/plugin-resources/commit-save"]);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ schemaVersion: 1, source });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ schemaVersion: 1, source, grantId: "grant", confirmed: true });
  });
  it("filters resource receivers and separates prepare from explicit confirmation", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { resourceOnly: true, fileName: "中文 & FILE.TXT" });
    expect(fetchImpl.mock.calls[0][0].searchParams.get("resourceOnly")).toBe("true");
    expect(fetchImpl.mock.calls[0][0].searchParams.get("fileName")).toBe("中文 & FILE.TXT");
    await gateway.searchTools("programming", { fileName: "中文 & FILE.TXT" });
    expect(fetchImpl.mock.calls[1][0].searchParams.has("resourceOnly")).toBe(false);
    expect(fetchImpl.mock.calls[1][0].searchParams.has("fileName")).toBe(false);
    await gateway.searchTools("programming", { directoryOnly: true });
    expect(fetchImpl.mock.calls[2][0].searchParams.get("directoryOnly")).toBe("true");
    expect(fetchImpl.mock.calls[2][0].searchParams.has("resourceOnly")).toBe(false);
    const source = { schemaVersion: 1, owner: { pluginId: "a" }, resourceId: "r", contentVersion: "v" };
    const target = { pluginId: "b" };
    await gateway.prepareResourceTransfer(source, target);
    await gateway.commitResourceTransfer(source, "grant");
    expect(fetchImpl.mock.calls[3][0].pathname).toBe("/v2/plugin-resources/prepare-transfer");
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({ schemaVersion: 1, source, target });
    expect(fetchImpl.mock.calls[4][0].pathname).toBe("/v2/plugin-resources/commit-transfer");
    expect(JSON.parse(fetchImpl.mock.calls[4][1].body)).toEqual({ schemaVersion: 1, source, grantId: "grant", confirmed: true });
  });
  it("passes category selection to Host and keeps old directory requests compatible", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { categoryId: "text", pluginId: "provider", query: "alias" });
    expect(fetchImpl.mock.calls[0][0].searchParams.get("categoryId")).toBe("text");
    expect(fetchImpl.mock.calls[0][0].searchParams.get("pluginId")).toBe("provider");
    await gateway.searchTools("programming");
    expect(fetchImpl.mock.calls[1][0].searchParams.has("categoryId")).toBe(false);
  });
  it("routes the Host call handshake and control separately from resource cancellation", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "fixture", capabilityId: "run" };
    const request = { ...scope, input: { count: 0, flag: false }, catalogRevision: "revision", captureResult: true };
    await gateway.callProtocol(); await gateway.prepareCall(request);
    await gateway.invoke(scope.sceneId, scope.workspaceId, scope.pluginId, scope.capabilityId, request.input, { catalogRevision: "revision", callId: "issued", captureResult: true });
    await gateway.cancelCall(scope, "issued"); await gateway.callStatus(scope, "issued");
    expect(fetchImpl.mock.calls.map(call => call[0].pathname)).toEqual([
      "/v2/plugin-capabilities/call-protocol", "/v2/plugin-capabilities/prepare-call", "/v2/plugin-capabilities/invoke",
      "/v2/plugin-capabilities/cancel-call", "/v2/plugin-capabilities/call-status",
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual(request);
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ ...request, callId: "issued" });
    for (const index of [3, 4]) expect(JSON.parse(fetchImpl.mock.calls[index][1].body)).toEqual({ schemaVersion: 1, scope, callId: "issued" });
    await gateway.reconcileCall(scope, "issued", "original-host");
    expect(fetchImpl.mock.calls[5][0].pathname).toBe("/v2/plugin-capabilities/reconcile-call");
    expect(JSON.parse(fetchImpl.mock.calls[5][1].body)).toEqual({ schemaVersion: 1, scope, callId: "issued", hostInstanceId: "original-host" });
  });
  it("passes the selected source to Host without changing default directory requests", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { pluginId: "com.zicode.source", query: "204", offset: 40, revision: "revision" });
    const selected = fetchImpl.mock.calls[0][0];
    expect(selected.searchParams.get("pluginId")).toBe("com.zicode.source");
    expect(selected.searchParams.get("offset")).toBe("40");
    await gateway.searchTools("programming");
    expect(fetchImpl.mock.calls[1][0].searchParams.has("pluginId")).toBe(false);
  });
  it("routes personalized directory pages with workspace and access revision", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { view: "favorites", workspaceId: "workspace", query: "JSON", offset: 40, revision: "catalog", accessRevision: 12 });
    expect(Object.fromEntries(fetchImpl.mock.calls[0][0].searchParams)).toEqual({ sceneId: "programming", query: "JSON", offset: "40", revision: "catalog", view: "favorites", workspaceId: "workspace", accessRevision: "12" });
  });
  it("separates metadata search from revision-bound schema loading without invoking", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { query: "JSON 中文", offset: 40, revision: "rev" });
    await gateway.loadTool("programming", { pluginId: "provider", capabilityId: "text.convert", revision: "rev" });
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-tool-directory");
    expect(Object.fromEntries(fetchImpl.mock.calls[0][0].searchParams)).toEqual({ sceneId: "programming", query: "JSON 中文", offset: "40", revision: "rev" });
    expect(fetchImpl.mock.calls[1][0].pathname).toBe("/v2/plugin-tool-directory/detail");
    expect(Object.fromEntries(fetchImpl.mock.calls[1][0].searchParams)).toEqual({ sceneId: "programming", pluginId: "provider", capabilityId: "text.convert", revision: "rev" });
    expect(fetchImpl.mock.calls.every(([, options]) => !options.body && !options.method)).toBe(true);
  });
  it("routes resource computation and independent cancellation with parent-derived owner", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    await gateway.invokeResource(owner, { resourceId: "id", contentVersion: "hash", toolCallId: "call", input: {}, owner: {} });
    await gateway.cancelResource(owner, "call");
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-resources/invoke-view");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ access: { schemaVersion: 1, owner, resourceId: "id", contentVersion: "hash" }, toolCallId: "call", input: {} });
    expect(fetchImpl.mock.calls[1][0].pathname).toBe("/v2/plugin-resources/cancel-view");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ schemaVersion: 1, owner, toolCallId: "call" });
    expect(fetchImpl.mock.calls[0][1].signal).not.toBe(fetchImpl.mock.calls[1][1].signal);
  });
  it("routes resource reads only through the trusted desktop endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const owner = { runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" };
    await gateway.readResource(owner, {
      resourceId: "id",
      contentVersion: "hash",
      offset: 0,
      length: 32768,
      owner: { pluginId: "spoof" },
    });
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-resources/read-view");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      access: { schemaVersion: 1, owner, resourceId: "id", contentVersion: "hash" },
      offset: 0,
      length: 32768,
    });
  });
  it("captures only on request and uses scoped preview and confirmation routes", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const scope = {
      sceneId: "programming",
      workspaceId: "workspace",
      pluginId: "plugin",
      capabilityId: "echo",
    };
    await gateway.invoke(
      scope.sceneId,
      scope.workspaceId,
      scope.pluginId,
      scope.capabilityId,
      {},
      { captureResult: true },
    );
    await gateway.prepareSave(scope, "result", "Title");
    await gateway.commitSave(scope, "grant");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).captureResult).toBe(true);
    await gateway.invoke(scope.sceneId, scope.workspaceId, scope.pluginId, scope.capabilityId, {}, { catalogRevision: "current" });
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body).catalogRevision).toBe("current");
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
      scope,
      resultId: "result",
      title: "Title",
    });
    expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({
      scope,
      grantId: "grant",
      confirmed: true,
    });
  });
  it("lists capabilities for the active scene", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ capabilities: [] }),
    }));
    const gateway = new PluginCapabilityGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    await gateway.list("programming");
    expect(fetchImpl.mock.calls[0][0].toString()).toBe(
      "http://127.0.0.1:57620/v2/plugin-capabilities?sceneId=programming",
    );
  });

  it("keeps single-field prepare compatible and sends explicit extra inputs for multiple fields", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const target = { pluginId: "receiver", capabilityId: "compare" };
    await gateway.prepareTransfer({}, "result", target, "text");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ scope: {}, resultId: "result", target, field: "text" });
    await gateway.prepareTransfer({}, "result", target, "left", { right: "other" });
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ scope: {}, resultId: "result", target, field: "left", inputs: { right: "other" } });
  });

  it("invokes a capability through the Host boundary", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { matches: [] } }),
    }));
    const gateway = new PluginCapabilityGateway({
      fetchImpl,
      location: { origin: "http://127.0.0.1:57620" },
    });
    const response = await gateway.invoke(
      "programming",
      "workspace-1",
      "com.zicode.notes",
      "notes.search",
      { query: "roadmap" },
    );
    expect(response.result).toEqual({ matches: [] });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      sceneId: "programming",
      workspaceId: "workspace-1",
      pluginId: "com.zicode.notes",
      capabilityId: "notes.search",
      input: { query: "roadmap" },
    });
  });
});

it("keeps legacy all search bodies and includes only personalized access fences", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "source", capabilityId: "encode" };
  await gateway.searchTargets(scope, "result", "query", 0, null);
  await gateway.searchTargets(scope, "result", "query", 20, "revision", { view: "favorites", accessRevision: 0 });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ scope, resultId: "result", query: "query", offset: 0, revision: null });
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ scope, resultId: "result", query: "query", offset: 20, revision: "revision", view: "favorites", accessRevision: 0 });
});

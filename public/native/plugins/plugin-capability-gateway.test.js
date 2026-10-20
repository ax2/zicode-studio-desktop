import { describe, expect, it, vi } from "vitest";
import { PluginCapabilityGateway } from "./plugin-capability-gateway.js";

it("sends result transfer cancellation only to the desktop Host route", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, status: "cancellation_requested" }) }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "source", capabilityId: "text" };
  await gateway.cancelTransfer(scope, "grant");
  expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-results/cancel-transfer");
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ scope, grantId: "grant" });
});

it("queries transfer status without committing or cancelling it", async () => {
  const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, status: "running" }) }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const scope = { sceneId: "programming", workspaceId: "workspace", pluginId: "source", capabilityId: "text" };
  expect(await gateway.transferStatus(scope, "grant")).toEqual({ schemaVersion: 1, status: "running" });
  expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-results/transfer-status");
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ scope, grantId: "grant" });
});

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

it("allows the Host OCR deadline to finish before timing out a resource invoke", async () => {
  vi.useFakeTimers();
  try {
    let signal;
    const fetchImpl = vi.fn((_url, options) => {
      signal = options.signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
    });
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const pending = gateway.invokeResourceCall({ runtimeId: "r", sessionId: "s", pluginId: "p", capabilityId: "c" },
      { resourceId: "id", contentVersion: "hash" }, { callId: "call", hostInstanceId: "host" });
    const completion = expect(pending).rejects.toMatchObject({ code: "plugin_capability_timeout" });
    await vi.advanceTimersByTimeAsync(45_000);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(45_000);
    await completion;
  } finally { vi.useRealTimers(); }
});

it("cancels an obsolete directory fetch without reporting a timeout or invoking a tool", async () => {
  const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () =>
      reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const controller = new AbortController();
  const pending = gateway.searchTools("programming", { query: "old" }, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "plugin_capability_cancelled" });
  expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-tool-directory");
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  await expect(gateway.searchTools("programming", { query: "new" }, alreadyCancelled.signal))
    .rejects.toMatchObject({ code: "plugin_capability_cancelled" });
  expect(fetchImpl).toHaveBeenCalledTimes(1);
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
  it("keeps plugin-supplied scope out of model generation prepare and consumes a one-use grant", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const owner = { workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", runtimeId: "trusted-runtime",
      sessionId: "trusted-session", pluginId: "trusted-plugin" };
    await gateway.prepareModelGeneration(owner, { modelRef: "model-ref", goal: "Summarize",
      materials: [], maxOutputTokens: 128, deadlineMs: 1000,
      runtimeId: "spoofed", pluginId: "spoofed", sceneId: "spoofed" }, "operation-id");
    await gateway.commitModelGeneration(owner, "one-use", true, 1000, "operation-id");
    await gateway.cancelModelGeneration(owner, "operation-id");
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/v2/plugin-services/model-generation/prepare", "/v2/plugin-services/model-generation/commit",
      "/v2/plugin-services/model-generation/cancel",
    ]);
    const [prepare, commit, cancel] = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(prepare).toEqual({ schemaVersion: 1, modelRef: "model-ref", goal: "Summarize",
      materials: [], maxOutputTokens: 128, deadlineMs: 1000, operationId: "operation-id", ...owner });
    expect(commit).toEqual({ schemaVersion: 1, ...owner, grantId: "one-use", confirmed: true,
      operationId: "operation-id" });
    expect(cancel).toEqual({ schemaVersion: 1, ...owner, operationId: "operation-id" });
  });
  it("uses fixed Host HTTP service routes and sends no plugin-controlled ownership fields", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const owner = { workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: "plugin" };
    await gateway.prepareHttpGet(owner, { origin: "http://127.0.0.1:8080", endpoint: "health",
      runtimeId: "spoofed", pluginId: "spoofed", method: "POST", path: "/admin" }, "operation");
    await gateway.commitHttpGet(owner, "private-grant", true, "operation");
    await gateway.cancelHttpGet(owner, "operation");
    expect(fetchImpl.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/v2/plugin-services/http-get/prepare", "/v2/plugin-services/http-get/commit",
      "/v2/plugin-services/http-get/cancel",
    ]);
    const [prepare, commit, cancel] = fetchImpl.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(prepare).toEqual({ schemaVersion: 1, ...owner, origin: "http://127.0.0.1:8080",
      endpoint: "health", operationId: "operation" });
    expect(commit).toEqual({ schemaVersion: 1, ...owner, grantId: "private-grant",
      confirmed: true, operationId: "operation" });
    expect(cancel).toEqual({ schemaVersion: 1, ...owner, operationId: "operation" });
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
  it("forwards the exact source MIME type for resource receiver discovery", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    await gateway.searchTools("programming", { resourceOnly: true, resourceMimeType: "text/plain" });
    expect(fetchImpl.mock.calls[0][0].searchParams.get("resourceMimeType")).toBe("text/plain");
    await gateway.loadTool("programming", { pluginId: "receiver", capabilityId: "read", revision: "revision", resourceMimeType: "text/plain" });
    expect(fetchImpl.mock.calls[1][0].searchParams.get("resourceMimeType")).toBe("text/plain");
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
  it("queries ordinary result save status without issuing another write", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ schemaVersion: 1, status: "unknown" }) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const scope = { workspaceId: "w", sceneId: "programming", pluginId: "p", capabilityId: "c" };
    await gateway.saveStatus(scope, "grant");
    expect(fetchImpl.mock.calls[0][0].pathname).toBe("/v2/plugin-results/save-status");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ scope, grantId: "grant" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).confirmed).toBeUndefined();
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
  it("forwards a receiver exclusion for Host validation", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ items: [] }) }));
    const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
    const options = { resourceOnly: true, resourceMimeType: "text/plain",
      excludePluginId: "source", excludeCapabilityId: "produce" };
    await gateway.searchTools("programming", options);
    const typed = fetchImpl.mock.calls[0][0].searchParams;
    expect(typed.get("excludePluginId")).toBe("source");
    expect(typed.get("excludeCapabilityId")).toBe("produce");
    await gateway.searchTools("programming", { ...options, resourceOnly: false });
    expect(fetchImpl.mock.calls[1][0].searchParams.get("excludePluginId")).toBe("source");
    await gateway.searchTools("programming");
    expect(fetchImpl.mock.calls[2][0].searchParams.has("excludePluginId")).toBe(false);
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
  await gateway.searchTargets(scope, "result", "query", 0, null, { pluginId: "receiver", categoryId: "text" });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ scope, resultId: "result", query: "query", offset: 0, revision: null });
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ scope, resultId: "result", query: "query", offset: 20, revision: "revision", view: "favorites", accessRevision: 0 });
  expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({ scope, resultId: "result", query: "query", offset: 0, revision: null, pluginId: "receiver", categoryId: "text" });
});

it("cancels result receiver directory requests with the caller signal", async () => {
  const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  }));
  const gateway = new PluginCapabilityGateway({ fetchImpl, location: { origin: "http://127.0.0.1:57620" } });
  const controller = new AbortController();
  const pending = gateway.searchTargets({ sceneId: "programming", workspaceId: "workspace", pluginId: "source", capabilityId: "encode" }, "result", "", 0, null, { signal: controller.signal });
  controller.abort();
  await expect(pending).rejects.toMatchObject({ code: "plugin_capability_cancelled" });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { setupPluginViewHost } from "./plugin-view-host.js";

const PLUGIN = {
  id: "com.example.view",
  name: "Example View",
  version: "1.0.0",
  origin: "developer",
  views: [
    {
      id: "example.sidebar",
      location: "sidebar",
      title: "Example tools",
      entry: "views/sidebar.html",
    },
    {
      id: "example.main",
      location: "main",
      title: "Example",
      entry: "views/main.html",
    },
  ],
  commands: [{ id: "example.run", label: "Run" }],
  capabilities: [{ id: "example.echo", title: "Echo" }],
};

function setup(options = {}) {
  document.body.innerHTML = '<aside id="navigation"></aside><main id="content"></main>';
  const gateway = {
    viewSource: vi.fn(async (_sceneId, pluginId, viewId) => ({
      view: {
        pluginId,
        pluginVersion: "1.0.0",
        viewId,
        title: viewId,
        location: viewId.endsWith("sidebar") ? "sidebar" : "main",
        html: "<main><h1>Sandbox content</h1><script>window.loaded = true;</script></main>",
      },
    })),
  };
  const capabilityGateway = {
    invoke: vi.fn(async () => ({ result: { echoed: true } })),
  };
  const host = setupPluginViewHost({
    gateway,
    capabilityGateway,
    getTarget: () => ({ sceneId: "programming" }),
    ...options,
  });
  return { capabilityGateway, gateway, host };
}

function sendFrom(iframe, data) {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        namespace: "zicode-plugin-view",
        channel: iframe.dataset.pluginChannel,
        ...data,
      },
      source: iframe.contentWindow,
    }),
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  setLocale("zh-CN");
});

it("starts the trusted main view at the top after leaving a scrolled manager", async () => {
  const { host } = setup();
  const container = document.getElementById("content");
  container.scrollTop = 120;
  host.renderContent(container, PLUGIN);
  expect(container.scrollTop).toBe(0);
  host.destroy();
});

describe("PluginViewHost", () => {
  it("delivers a declared tool location after the main View is ready and accepts only its acknowledgement", async () => {
    const notify = vi.fn();
    const onOpened = vi.fn();
    const { host } = setup({ notify });
    const plugin = { ...PLUGIN, enabled: true, toolOpenProfile: true };
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    expect(host.openTool(plugin, "example.echo", onOpened)).toBe(true);
    expect(postMessage.mock.calls.some(([message]) => message.type === "openTool")).toBe(false);
    sendFrom(iframe, { type: "ready" });
    const request = postMessage.mock.calls.find(([message]) => message.type === "openTool")?.[0];
    expect(request).toMatchObject({ capabilityId: "example.echo" });
    sendFrom(iframe, { type: "openToolResult", requestId: "wrong", status: "opened" });
    expect(onOpened).not.toHaveBeenCalled();
    sendFrom(iframe, { type: "openToolResult", requestId: request.requestId, status: "opened" });
    expect(onOpened).toHaveBeenCalledOnce();
    sendFrom(iframe, { type: "openToolResult", requestId: request.requestId, status: "opened" });
    expect(onOpened).toHaveBeenCalledOnce();
    expect(host.openTool(plugin, "example.echo", onOpened)).toBe(true);
    const secondRequest = postMessage.mock.calls.filter(([message]) => message.type === "openTool").at(-1)[0];
    sendFrom(iframe, { type: "openToolResult", requestId: secondRequest.requestId, status: "unsupported" });
    expect(onOpened).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    host.destroy();
  });

  it("drops a queued location when the workspace changes before View readiness", async () => {
    let target = { sceneId: "programming", workspaceId: "first" };
    const notify = vi.fn();
    const { host } = setup({ getTarget: () => target, notify });
    const plugin = { ...PLUGIN, enabled: true, toolOpenProfile: true };
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    vi.useFakeTimers();
    try {
      expect(host.openTool(plugin, "example.echo")).toBe(true);
      target = { sceneId: "programming", workspaceId: "second" };
      sendFrom(iframe, { type: "ready" });
      expect(postMessage.mock.calls.some(([message]) => message.type === "openTool")).toBe(false);
      expect(postMessage.mock.calls.some(([message]) => message.type === "context")).toBe(false);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(notify).not.toHaveBeenCalled();
      host.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores a stale View acknowledgement after the workspace changes", async () => {
    let target = { sceneId: "programming", workspaceId: "first" };
    const notify = vi.fn();
    const onOpened = vi.fn();
    const { host } = setup({ getTarget: () => target, notify });
    const plugin = { ...PLUGIN, enabled: true, toolOpenProfile: true };
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "ready" });
    vi.useFakeTimers();
    try {
      expect(host.openTool(plugin, "example.echo", onOpened)).toBe(true);
      const request = postMessage.mock.calls.find(([message]) => message.type === "openTool")?.[0];
      expect(request?.requestId).toBeTruthy();
      target = { sceneId: "programming", workspaceId: "second" };
      sendFrom(iframe, { type: "openToolResult", requestId: request.requestId, status: "opened" });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(notify).not.toHaveBeenCalled();
      expect(onOpened).not.toHaveBeenCalled();
      host.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("waits for the current plugin version instead of sending a location to an old View", async () => {
    const notify = vi.fn();
    const { host } = setup({ notify });
    const oldPlugin = { ...PLUGIN, enabled: true, toolOpenProfile: true };
    const container = document.getElementById("content");
    host.renderContent(container, oldPlugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const oldFrame = document.querySelector("iframe");
    const oldPost = vi.spyOn(oldFrame.contentWindow, "postMessage");
    sendFrom(oldFrame, { type: "ready" });
    const currentPlugin = { ...oldPlugin, version: "2.0.0" };
    container.replaceChildren();
    host.renderContent(container, currentPlugin);
    expect(host.openTool(currentPlugin, "example.echo")).toBe(true);
    expect(oldPost.mock.calls.some(([message]) => message.type === "openTool")).toBe(false);
    await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBe(oldFrame));
    const currentFrame = document.querySelector("iframe");
    const currentPost = vi.spyOn(currentFrame.contentWindow, "postMessage");
    sendFrom(currentFrame, { type: "ready" });
    const request = currentPost.mock.calls.find(([message]) => message.type === "openTool")?.[0];
    expect(request).toMatchObject({ capabilityId: "example.echo" });
    sendFrom(currentFrame, { type: "openToolResult", requestId: request.requestId, status: "opened" });
    expect(notify).not.toHaveBeenCalled();
    host.destroy();
  });
  it("rejects an old View capability request before it can use a new workspace", async () => {
    let target = { sceneId: "programming", workspaceId: "first" };
    const { host, capabilityGateway } = setup({ getTarget: () => target });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    target = { sceneId: "programming", workspaceId: "second" };
    sendFrom(iframe, { type: "request", requestId: "stale-invoke", method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} } });
    expect(capabilityGateway.invoke).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "stale-invoke", error: expect.any(String),
    }), "*");
    host.destroy();
  });
  it("does not return an in-flight View capability result after the workspace changes", async () => {
    let target = { sceneId: "programming", workspaceId: "first" };
    let complete;
    const capabilityGateway = { invoke: vi.fn(() => new Promise((resolve) => { complete = resolve; })) };
    const { host } = setup({ getTarget: () => target, capabilityGateway });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "in-flight", method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} } });
    expect(capabilityGateway.invoke).toHaveBeenCalledWith("programming", "first", PLUGIN.id,
      "example.echo", {});
    target = { sceneId: "programming", workspaceId: "second" };
    complete({ result: { private: "old workspace result" } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "in-flight", error: expect.any(String),
    }), "*"));
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("old workspace result");
    host.destroy();
  });
  it("routes a View cancellation through the Host call handle and keeps a late success", async () => {
    const revision = "a".repeat(64);
    const callId = "00000000-0000-4000-8000-000000000001";
    let finish;
    const capabilityGateway = {
      callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1",
        prepareRequired: true })),
      searchTools: vi.fn(async () => ({ schemaVersion: 1, revision })),
      loadTool: vi.fn(async () => ({ pluginId: PLUGIN.id, version: PLUGIN.version, revision,
        capability: { id: "example.echo" } })),
      prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId })),
      cancelCall: vi.fn(async () => ({ status: "cancel_requested", executionFinished: false })),
      invoke: vi.fn(() => new Promise((resolve) => { finish = resolve; })),
    };
    const { host, gateway } = setup({ capabilityGateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "workspace" }) });
    const loadView = gateway.viewSource.getMockImplementation();
    gateway.viewSource.mockImplementation(async (...args) =>
      ({ ...await loadView(...args), catalogRevision: revision }));
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "call", method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {}, cancelRequired: true } });
    await vi.waitFor(() => expect(capabilityGateway.invoke).toHaveBeenCalledWith("programming",
      "workspace", PLUGIN.id, "example.echo", {}, { catalogRevision: revision, callId }));
    const pendingExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(pendingExit);
    expect(pendingExit.defaultPrevented).toBe(true);
    sendFrom(iframe, { type: "request", requestId: "duplicate", method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "duplicate", errorCode: "plugin_call_budget_exceeded",
    }), "*"));
    expect(capabilityGateway.invoke).toHaveBeenCalledOnce();
    expect(capabilityGateway.searchTools).not.toHaveBeenCalled();
    sendFrom(iframe, { type: "cancelRequest", requestId: "call" });
    await vi.waitFor(() => expect(capabilityGateway.cancelCall).toHaveBeenCalledWith({
      sceneId: "programming", workspaceId: "workspace", pluginId: PLUGIN.id,
      capabilityId: "example.echo",
    }, callId));
    finish({ result: { completed: true } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "call", result: { completed: true },
    }), "*"));
    const finishedExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(finishedExit);
    expect(finishedExit.defaultPrevented).toBe(false);
    host.destroy();
  });
  it("keeps an issued call locked across View remount when its response is lost", async () => {
    const revision = "a".repeat(64);
    const callId = "00000000-0000-4000-8000-000000000001";
    let rejectInvoke;
    const capabilityGateway = {
      callProtocol: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1",
        prepareRequired: true })),
      loadTool: vi.fn(async () => ({ pluginId: PLUGIN.id, version: PLUGIN.version, revision,
        capability: { id: "example.echo" } })),
      prepareCall: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1", callId })),
      cancelCall: vi.fn(async () => ({ status: "cancel_requested", executionFinished: false })),
      callStatus: vi.fn(async () => ({ schemaVersion: 1, profile: "manual.tool.call.v1",
        status: "running", executionFinished: false, outcome: null })),
      invoke: vi.fn(() => new Promise((_, reject) => { rejectInvoke = reject; })),
    };
    const { host, gateway } = setup({ capabilityGateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "workspace" }) });
    const loadView = gateway.viewSource.getMockImplementation();
    gateway.viewSource.mockImplementation(async (...args) =>
      ({ ...await loadView(...args), catalogRevision: revision }));
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("#content iframe")).toBeTruthy());
    const first = document.querySelector("#content iframe");
    sendFrom(first, { type: "request", requestId: "first", method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} } });
    await vi.waitFor(() => expect(capabilityGateway.invoke).toHaveBeenCalledOnce());
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("#content iframe")).not.toBe(first));
    rejectInvoke(Object.assign(new Error("timed out"), { code: "plugin_capability_timeout" }));
    await vi.waitFor(() => expect(document.querySelector("#content .plugin-view-call-recovery").textContent)
      .toContain("结果尚不确定"));
    const second = document.querySelector("#content iframe");
    const postMessage = vi.spyOn(second.contentWindow, "postMessage");
    sendFrom(second, { type: "request", requestId: "repeat", method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} } });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "repeat", errorCode: "view_call_outcome_unknown",
    }), "*"));
    expect(capabilityGateway.invoke).toHaveBeenCalledOnce();
    const pendingExit = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(pendingExit);
    expect(pendingExit.defaultPrevented).toBe(true);
    host.destroy();
    const afterDestroy = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterDestroy);
    expect(afterDestroy.defaultPrevented).toBe(false);
  });
  it("keeps old Views and undeclared capabilities on the application home", async () => {
    const notify = vi.fn();
    const { host } = setup({ notify });
    expect(host.openTool({ ...PLUGIN, enabled: true }, "example.echo")).toBe(false);
    expect(host.openTool({ ...PLUGIN, enabled: true, toolOpenProfile: true }, "unknown")).toBe(false);
    expect(notify).toHaveBeenCalledTimes(2);
    host.destroy();
  });
  it("rejects direct tool navigation immediately when external Views are unavailable", () => {
    const notify = vi.fn();
    const { host, gateway } = setup({ allowExternalViews: false, notify });
    const plugin = { ...PLUGIN, enabled: true, toolOpenProfile: true };
    expect(host.openTool(plugin, "example.echo")).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(gateway.viewSource).not.toHaveBeenCalled();
    host.destroy();
  });
  it("clears a pending tool location when the main View fails to load", async () => {
    vi.useFakeTimers();
    try {
      const notify = vi.fn();
      const { host, gateway } = setup({ notify });
      gateway.viewSource.mockRejectedValueOnce(new Error("View source unavailable"));
      const plugin = { ...PLUGIN, enabled: true, toolOpenProfile: true };
      const container = document.getElementById("content");
      host.renderContent(container, plugin);
      expect(host.openTool(plugin, "example.echo")).toBe(true);
      await Promise.resolve();
      await Promise.resolve();
      expect(container.querySelector(".plugin-view-error")?.textContent).toContain("View source unavailable");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(notify).not.toHaveBeenCalled();
      host.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
  it("ignores a duplicate live request ID without starting a second operation", async () => {
    let complete;
    const executeCommand = vi.fn(() => new Promise((resolve) => { complete = resolve; }));
    const { host } = setup({ executeCommand });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    const request = { type: "request", requestId: "same-id", method: "executeCommand",
      params: { commandId: "example.run", args: { value: 1 } } };
    sendFrom(iframe, request);
    sendFrom(iframe, request);
    expect(executeCommand).toHaveBeenCalledTimes(1);
    complete({ done: true });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "same-id", result: { done: true },
    }), "*"));
    expect(postMessage.mock.calls.filter(([message]) => message.requestId === "same-id")).toHaveLength(1);
    host.destroy();
  });
  it.each([
    "<main>Candidate<script src='limits.js'></script></main>",
    "<link rel='stylesheet' href='view.css'><main>Candidate</main>",
    "<!doctype html><html><head><script src='limits.js'></script></head><body>Candidate</body></html>",
  ])("reports external View assets before mounting an inert iframe", async (html) => {
    setLocale("en");
    const { gateway, host } = setup();
    gateway.viewSource.mockImplementation(async (_sceneId, pluginId, viewId) => ({
      view: { pluginId, viewId, location: "main", html },
    }));
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector(".plugin-view-error")).toBeTruthy());
    expect(document.querySelector(".plugin-view-error").textContent).toContain(
      "Plugin view must include its scripts and styles in the HTML file.",
    );
    expect(document.querySelector("iframe")).toBeNull();
    host.destroy();
  });
  it("keeps another plugin view available when one view has unsupported assets", async () => {
    const { gateway, host } = setup();
    gateway.viewSource.mockImplementation(async (_sceneId, pluginId, viewId) => ({
      view: { pluginId, viewId, location: viewId.endsWith("sidebar") ? "sidebar" : "main",
        html: viewId.endsWith("sidebar") ? "<main>Available</main>" : "<script src='remote.js'></script>" },
    }));
    host.renderNavigation(document.getElementById("navigation"), PLUGIN);
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("#content .plugin-view-error")).toBeTruthy());
    await vi.waitFor(() => expect(document.querySelector("#navigation iframe")).toBeTruthy());
    expect(document.querySelector("#content iframe")).toBeNull();
    host.destroy();
  });
  it("shows trusted model consent before a one-use Host call and rejects changed targets", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let preparedOperationId;
    const capabilityGateway = {
      prepareSave: vi.fn(),
      prepareModelGeneration: vi.fn(async (_owner, _input, operationId) => {
        preparedOperationId = operationId;
        return { operationId, grantId: "private-grant", displayName: "Model",
          destination: "https://model.example", inputBytes: 4, materialCount: 0, promptPreview: "{}" };
      }),
      commitModelGeneration: vi.fn(async () => ({ schemaVersion: 1, operation: "model.generate",
        result: { modelRef: "model-ref", text: "done" }, resultRef: { resultId: "private-result" } })),
      cancelModelGeneration: vi.fn(async () => ({ status: "requested", executionFinished: false })),
    };
    const confirmModelGeneration = vi.fn(async () => true);
    const { host } = setup({ capabilityGateway, getTarget: () => target, confirmModelGeneration });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    const input = { modelRef: "model-ref", goal: "test", materials: [], maxOutputTokens: 64, deadlineMs: 1000 };
    sendFrom(iframe, { type: "request", requestId: "generate", method: "generateModel", params: input });
    await vi.waitFor(() => expect(capabilityGateway.commitModelGeneration).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, "private-grant", true, 1000, expect.any(String)));
    expect(preparedOperationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(confirmModelGeneration).toHaveBeenCalledWith(expect.objectContaining({
      destination: "https://model.example" }), PLUGIN.name, expect.any(Promise));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "generate", result: expect.objectContaining({ operation: "model.generate" }),
    }), "*"));
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private-grant");
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private-result");
    expect(document.querySelector(".plugin-result-actions").hidden).toBe(false);
    target.instanceId = "replaced";
    sendFrom(iframe, { type: "request", requestId: "stale", method: "generateModel", params: input });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "stale", error: expect.any(String),
    }), "*"));
    expect(capabilityGateway.prepareModelGeneration).toHaveBeenCalledTimes(1);
    host.destroy();
  });
  it("requires a trusted confirmation for fixed service GETs and hides Host result references", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let preparedOperationId;
    const capabilityGateway = {
      prepareSave: vi.fn(),
      prepareHttpGet: vi.fn(async (_owner, _input, operationId) => {
        preparedOperationId = operationId;
        return { operationId, grantId: "private-grant", expiresInMs: 60_000,
          display: { origin: "http://127.0.0.1:8080", method: "GET", endpoint: "health",
            path: "/actuator/health", addressClass: "loopback", https: false,
            maxResponseBytes: 1_048_576, timeoutMs: 8_000 } };
      }),
      commitHttpGet: vi.fn(async (_owner, _grant, confirmed) => confirmed
        ? { schemaVersion: 1, operation: "http.get", result: { data: { status: "UP" } },
          resultRef: { resultId: "private-result" } }
        : { schemaVersion: 1, operation: "http.get", status: "declined" }),
      cancelHttpGet: vi.fn(async () => ({ status: "requested" })),
    };
    const confirmHttpGet = vi.fn(async () => true);
    const plugin = { ...PLUGIN, permissions: { "service.http.read": true } };
    const { host } = setup({ capabilityGateway, getTarget: () => target, confirmHttpGet });
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "http", method: "httpGet",
      params: { origin: "http://127.0.0.1:8080", endpoint: "health" } });
    await vi.waitFor(() => expect(capabilityGateway.commitHttpGet).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, "private-grant", true, expect.any(String)));
    expect(preparedOperationId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(confirmHttpGet).toHaveBeenCalledWith(expect.objectContaining({
      display: expect.objectContaining({ path: "/actuator/health" }),
    }), PLUGIN.name, expect.any(Promise));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "http", result: expect.objectContaining({ operation: "http.get" }),
    }), "*"));
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private-grant");
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private-result");
    expect(document.querySelector(".plugin-result-actions").hidden).toBe(false);
    host.destroy();
  });
  it("forwards an aborted HTTP GET to the Host cancellation operation", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let preparedOperationId;
    let finishCommit;
    const capabilityGateway = {
      prepareHttpGet: vi.fn(async (_owner, _input, operationId) => {
        preparedOperationId = operationId;
        return { operationId, grantId: "private-grant", display: { endpoint: "health" } };
      }),
      commitHttpGet: vi.fn(() => new Promise((_, reject) => { finishCommit = reject; })),
      cancelHttpGet: vi.fn(async () => ({ status: "requested", executionFinished: false })),
    };
    const plugin = { ...PLUGIN, permissions: { "service.http.read": true } };
    const { host } = setup({ capabilityGateway, getTarget: () => target,
      confirmHttpGet: vi.fn(async () => true) });
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "http-abort", method: "httpGet",
      params: { origin: "http://127.0.0.1:8080", endpoint: "health" } });
    await vi.waitFor(() => expect(capabilityGateway.commitHttpGet).toHaveBeenCalled());
    sendFrom(iframe, { type: "cancelRequest", requestId: "http-abort" });
    await vi.waitFor(() => expect(capabilityGateway.cancelHttpGet).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, preparedOperationId));
    finishCommit(Object.assign(new Error("HTTP service request cancelled"), {
      code: "http_service_request_cancelled",
    }));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "http-abort", errorCode: "http_service_request_cancelled",
    }), "*"));
    host.destroy();
  });
  it("dismisses pending HTTP confirmation when its View requests cancellation", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let preparedOperationId;
    const capabilityGateway = {
      prepareHttpGet: vi.fn(async (_owner, _input, operationId) => {
        preparedOperationId = operationId;
        return { operationId, grantId: "private-grant", display: { endpoint: "health" } };
      }),
      commitHttpGet: vi.fn(async () => ({ schemaVersion: 1, operation: "http.get", status: "declined" })),
      cancelHttpGet: vi.fn(async () => ({ status: "requested", executionFinished: false })),
    };
    const confirmHttpGet = vi.fn(async (_preview, _name, dismissSignal) => {
      await dismissSignal;
      return false;
    });
    const plugin = { ...PLUGIN, permissions: { "service.http.read": true } };
    const { host } = setup({ capabilityGateway, getTarget: () => target, confirmHttpGet });
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "http-confirm", method: "httpGet",
      params: { origin: "http://127.0.0.1:8080", endpoint: "health" } });
    await vi.waitFor(() => expect(confirmHttpGet).toHaveBeenCalled());
    sendFrom(iframe, { type: "cancelRequest", requestId: "http-confirm" });
    await vi.waitFor(() => expect(capabilityGateway.cancelHttpGet).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, preparedOperationId));
    await vi.waitFor(() => expect(capabilityGateway.commitHttpGet).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, "private-grant", false, preparedOperationId));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "http-confirm", errorCode: "http_service_request_cancelled",
    }), "*"));
    expect(capabilityGateway.commitHttpGet).not.toHaveBeenCalledWith(expect.anything(),
      "private-grant", true, preparedOperationId);
    host.destroy();
  });
  it("declines a model grant cancelled while preview preparation was pending", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let finishPrepare;
    const capabilityGateway = {
      prepareModelGeneration: vi.fn((_owner, _input, operationId) => new Promise((resolve) => {
        finishPrepare = () => resolve({ operationId, grantId: "private-grant" });
      })),
      commitModelGeneration: vi.fn(async () => ({})),
      cancelModelGeneration: vi.fn(async () => ({})),
    };
    const confirmModelGeneration = vi.fn(async () => true);
    const { host } = setup({ capabilityGateway, getTarget: () => target, confirmModelGeneration });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "preparing", method: "generateModel",
      params: { modelRef: "model", goal: "test", materials: [] } });
    await vi.waitFor(() => expect(finishPrepare).toBeTypeOf("function"));
    sendFrom(iframe, { type: "cancelRequest", requestId: "preparing" });
    finishPrepare();
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "preparing", errorCode: "model_request_cancelled",
    }), "*"));
    expect(confirmModelGeneration).not.toHaveBeenCalled();
    expect(capabilityGateway.commitModelGeneration).toHaveBeenCalledWith(expect.any(Object),
      "private-grant", false, 30_000, expect.any(String));
    expect(capabilityGateway.commitModelGeneration).not.toHaveBeenCalledWith(expect.any(Object),
      "private-grant", true, expect.any(Number), expect.any(String));
    host.destroy();
  });
  it("dismisses model consent and declines its grant when the View request is cancelled", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    const capabilityGateway = {
      prepareModelGeneration: vi.fn(async (_owner, _input, operationId) =>
        ({ operationId, grantId: "private-grant" })),
      commitModelGeneration: vi.fn(async () => ({})),
      cancelModelGeneration: vi.fn(async () => ({})),
    };
    const confirmModelGeneration = vi.fn(async (_preview, _name, dismissSignal) => {
      await dismissSignal;
      return false;
    });
    const { host } = setup({ capabilityGateway, getTarget: () => target, confirmModelGeneration });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "consent", method: "generateModel",
      params: { modelRef: "model", goal: "test", materials: [] } });
    await vi.waitFor(() => expect(confirmModelGeneration).toHaveBeenCalledOnce());
    sendFrom(iframe, { type: "cancelRequest", requestId: "consent" });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "consent", errorCode: "model_request_cancelled",
    }), "*"));
    expect(capabilityGateway.cancelModelGeneration).toHaveBeenCalledOnce();
    expect(capabilityGateway.commitModelGeneration).toHaveBeenCalledWith(expect.any(Object),
      "private-grant", false, 30_000, expect.any(String));
    expect(capabilityGateway.commitModelGeneration).not.toHaveBeenCalledWith(expect.any(Object),
      "private-grant", true, expect.any(Number), expect.any(String));
    host.destroy();
  });
  it("cancels a confirmed model request in the Host and waits for its terminal response", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let preparedOperationId;
    let finishCommit;
    const capabilityGateway = {
      prepareModelGeneration: vi.fn(async (_owner, _input, operationId) => {
        preparedOperationId = operationId;
        return { operationId, grantId: "private-grant", displayName: "Model",
          destination: "https://model.example", inputBytes: 4, materialCount: 0, promptPreview: "{}" };
      }),
      commitModelGeneration: vi.fn(() => new Promise((_, reject) => { finishCommit = reject; })),
      cancelModelGeneration: vi.fn(async () => ({ status: "requested", executionFinished: false })),
    };
    const { host } = setup({ capabilityGateway, getTarget: () => target,
      confirmModelGeneration: vi.fn(async () => true) });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    const input = { modelRef: "model-ref", goal: "test", materials: [], maxOutputTokens: 64, deadlineMs: 1000 };
    sendFrom(iframe, { type: "request", requestId: "generate", method: "generateModel", params: input });
    await vi.waitFor(() => expect(capabilityGateway.commitModelGeneration).toHaveBeenCalled());
    sendFrom(iframe, { type: "cancelRequest", requestId: "generate" });
    await vi.waitFor(() => expect(capabilityGateway.cancelModelGeneration).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, preparedOperationId));
    finishCommit(Object.assign(new Error("Model request cancelled"), { code: "model_request_cancelled" }));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "generate", errorCode: "model_request_cancelled",
    }), "*"));
    host.destroy();
  });
  it("cancels an in-flight model request when its plugin view is deactivated", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    let preparedOperationId;
    let finishCommit;
    const capabilityGateway = {
      prepareModelGeneration: vi.fn(async (_owner, _input, operationId) => {
        preparedOperationId = operationId;
        return { operationId, grantId: "private-grant", displayName: "Model",
          destination: "https://model.example", inputBytes: 4, materialCount: 0, promptPreview: "{}" };
      }),
      commitModelGeneration: vi.fn(() => new Promise((_, reject) => { finishCommit = reject; })),
      cancelModelGeneration: vi.fn(async () => ({ status: "requested", executionFinished: false })),
    };
    const { host } = setup({ capabilityGateway, getTarget: () => target,
      confirmModelGeneration: vi.fn(async () => true) });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    const input = { modelRef: "model-ref", goal: "test", materials: [], maxOutputTokens: 64, deadlineMs: 1000 };
    sendFrom(iframe, { type: "request", requestId: "generate", method: "generateModel", params: input });
    await vi.waitFor(() => expect(capabilityGateway.commitModelGeneration).toHaveBeenCalled());

    host.deactivate(PLUGIN.id);

    await vi.waitFor(() => expect(capabilityGateway.cancelModelGeneration).toHaveBeenCalledWith({
      workspaceId: "workspace", runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, preparedOperationId));
    expect(iframe.isConnected).toBe(false);
    finishCommit(Object.assign(new Error("Model request cancelled"), { code: "model_request_cancelled" }));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "generate", errorCode: "model_request_cancelled",
    }), "*"));
    expect(document.querySelector("iframe")).toBeNull();
    host.destroy();
  });
  it("derives model catalog identity from the trusted runtime and rejects an old view", async () => {
    const target = { sceneId: "programming", workspaceId: "workspace", instanceId: "runtime", sessionId: "session" };
    const capabilityGateway = {
      listServiceModels: vi.fn(async () => ({ schemaVersion: 1, operation: "models.list", result: { models: [] } })),
    };
    const { host } = setup({ capabilityGateway, getTarget: () => target });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, { type: "request", requestId: "models", method: "listServiceModels",
      params: { pluginId: "com.other.plugin", sceneId: "other" } });
    await vi.waitFor(() => expect(capabilityGateway.listServiceModels).toHaveBeenCalledWith({
      runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, null));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "models", result: { schemaVersion: 1, operation: "models.list", result: { models: [] } },
    }), "*"));
    target.instanceId = "replaced";
    sendFrom(iframe, { type: "request", requestId: "stale", method: "listServiceModels", params: {} });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "stale", error: expect.any(String),
    }), "*"));
    expect(capabilityGateway.listServiceModels).toHaveBeenCalledTimes(1);
    host.destroy();
  });
  it("transports fixed error codes without forwarding private Host messages", async () => {
    const { host, capabilityGateway } = setup();
    capabilityGateway.invoke.mockRejectedValue(
      Object.assign(new Error("private report path"), { code: "worker_fuel_exhausted" }),
    );
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, {
      type: "request",
      requestId: "budget",
      method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "budget",
          errorCode: "worker_fuel_exhausted",
          error: "Plugin computation budget exhausted",
        }),
        "*",
      ),
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private report");
    capabilityGateway.invoke.mockRejectedValue(null);
    sendFrom(iframe, {
      type: "request",
      requestId: "empty-failure",
      method: "invokeCapability",
      params: { capabilityId: "example.echo", input: {} },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "empty-failure",
          errorCode: "plugin_request_failed",
          error: "Plugin request failed",
        }),
        "*",
      ),
    );
    host.destroy();
  });
  it("keeps captured result references in the parent and clears saving on target switch", async () => {
    setLocale("zh-CN");
    const capabilityGateway = {
      invoke: vi.fn(async () => ({
        result: { ok: true, data: { text: "hello" } },
        resultRef: { resultId: "parent-only" },
      })),
      prepareSave: vi.fn(),
      commitSave: vi.fn(),
    };
    const { host } = setup({
      capabilityGateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "workspace" }),
    });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");
    sendFrom(iframe, {
      type: "request",
      requestId: "capture",
      method: "invokeCapability",
      params: { capabilityId: "example.echo" },
    });
    await vi.waitFor(() => expect(document.body.textContent).toContain("预览保存"));
    expect(capabilityGateway.invoke).toHaveBeenCalledWith(
      "programming",
      "workspace",
      PLUGIN.id,
      "example.echo",
      {},
      { captureResult: true },
    );
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "response", result: { ok: true, data: { text: "hello" } } }),
      "*",
    );
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("parent-only");
    host.setTarget();
    expect(document.querySelector(".plugin-result-actions")).toBeNull();
    host.destroy();
  });
  it("loads declared views into an opaque sandbox with a restrictive CSP bridge", async () => {
    const { gateway, host } = setup();
    host.renderNavigation(document.getElementById("navigation"), PLUGIN);
    host.renderContent(document.getElementById("content"), PLUGIN);

    await vi.waitFor(() => expect(document.querySelectorAll(".plugin-view-frame")).toHaveLength(2));
    const iframe = document.querySelector("#content iframe");
    expect(gateway.viewSource).toHaveBeenCalledWith(
      "programming",
      "com.example.view",
      "example.main",
    );
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(iframe.srcdoc).toContain("default-src 'none'");
    expect(iframe.srcdoc).toContain("connect-src 'none'");
    expect(iframe.srcdoc).toContain("window.zicode");
    expect(iframe.srcdoc).toContain("Sandbox content");
  });

  it("validates message source and declarations before proxying SDK requests", async () => {
    const notify = vi.fn();
    const executeCommand = vi.fn(async () => ({ dispatched: true }));
    const { capabilityGateway, host } = setup({ notify, executeCommand });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const postMessage = vi.spyOn(iframe.contentWindow, "postMessage");

    sendFrom(iframe, { type: "ready" });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: "zicode-plugin-view",
        type: "context",
        context: expect.objectContaining({
          pluginId: "com.example.view",
          viewId: "example.main",
        }),
      }),
      "*",
    );

    sendFrom(iframe, {
      type: "request",
      requestId: "notify-1",
      method: "notify",
      params: { message: "Local plugin message" },
    });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith("Local plugin message"));

    sendFrom(iframe, {
      type: "request",
      requestId: "capability-1",
      method: "invokeCapability",
      params: { capabilityId: "example.echo", input: { value: 1 } },
    });
    await vi.waitFor(() =>
      expect(capabilityGateway.invoke).toHaveBeenCalledWith(
        "programming",
        "",
        "com.example.view",
        "example.echo",
        { value: 1 },
      ),
    );
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "capability-1",
          result: { echoed: true },
        }),
        "*",
      ),
    );

    sendFrom(iframe, {
      type: "request",
      requestId: "command-1",
      method: "executeCommand",
      params: { commandId: "undeclared.command" },
    });
    await vi.waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: "command-1",
          error: "Plugin command is not declared",
        }),
        "*",
      ),
    );
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it("blocks navigation away from a plugin that reported unsaved state", async () => {
    setLocale("en");
    const confirmDiscard = vi.fn(() => false);
    const { host } = setup({ confirmDiscard });
    host.renderContent(document.getElementById("content"), PLUGIN);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    sendFrom(document.querySelector("iframe"), { type: "dirty", dirty: true });

    await expect(host.canDeactivate("com.example.view")).resolves.toBe(false);
    expect(confirmDiscard).toHaveBeenCalledWith("Discard unsaved plugin changes?");
  });
});

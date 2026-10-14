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
    const capabilityGateway = {
      prepareModelGeneration: vi.fn(async () => ({ grantId: "private-grant", displayName: "Model",
        destination: "https://model.example", inputBytes: 4, materialCount: 0, promptPreview: "{}" })),
      commitModelGeneration: vi.fn(async () => ({ schemaVersion: 1, operation: "model.generate",
        result: { text: "done" } })),
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
      runtimeId: "runtime", sessionId: "session", pluginId: PLUGIN.id,
    }, "private-grant", true, 1000));
    expect(confirmModelGeneration).toHaveBeenCalledWith(expect.objectContaining({
      destination: "https://model.example" }), PLUGIN.name);
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "generate", result: expect.objectContaining({ operation: "model.generate" }),
    }), "*"));
    expect(JSON.stringify(postMessage.mock.calls)).not.toContain("private-grant");
    target.instanceId = "replaced";
    sendFrom(iframe, { type: "request", requestId: "stale", method: "generateModel", params: input });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "stale", error: expect.any(String),
    }), "*"));
    expect(capabilityGateway.prepareModelGeneration).toHaveBeenCalledTimes(1);
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

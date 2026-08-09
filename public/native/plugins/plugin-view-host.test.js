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

describe("PluginViewHost", () => {
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

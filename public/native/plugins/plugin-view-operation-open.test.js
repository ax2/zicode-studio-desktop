import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { sandboxBridge, setupPluginViewHost } from "./plugin-view-host.js";

const plugin = {
  id: "com.example.view-operation", name: "Example", version: "1.0.0", origin: "developer",
  enabled: true, viewOperationDirectoryProfile: true,
  views: [{ id: "example.main", location: "main", title: "Main", entry: "views/main.html" }],
  viewOperations: [{ id: "example.health", title: "Health", viewId: "example.main" }],
  capabilities: [],
};

function sendFrom(iframe, data) {
  window.dispatchEvent(new MessageEvent("message", {
    data: { namespace: "zicode-plugin-view", channel: iframe.dataset.pluginChannel, ...data },
    source: iframe.contentWindow,
  }));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("routes an explicit View operation without producing a capability request", async () => {
  document.body.innerHTML = '<main id="content"></main>';
  const notify = vi.fn();
  const onOpened = vi.fn();
  let current = true;
  const host = setupPluginViewHost({ notify, getTarget: () => ({ sceneId: "programming", workspaceId: "project" }),
    gateway: { viewSource: async (_scene, pluginId, viewId) => ({ view: { pluginId, viewId,
      location: "main", title: "Main", html: "<main>Example</main>" } }) } });
  host.renderContent(document.getElementById("content"), plugin);
  await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const iframe = document.querySelector("iframe");
  const post = vi.spyOn(iframe.contentWindow, "postMessage");
  expect(host.openViewOperation(plugin, "unknown", "example.main", onOpened)).toBe(false);
  expect(host.openViewOperation(plugin, "example.health", "example.main", onOpened, () => current)).toBe(true);
  sendFrom(iframe, { type: "ready" });
  const request = post.mock.calls.find(([message]) => message.type === "openViewOperation")?.[0];
  expect(request).toMatchObject({ operationId: "example.health" });
  expect(request).not.toHaveProperty("capabilityId");
  sendFrom(iframe, { type: "openToolResult", requestId: request.requestId, status: "opened" });
  expect(onOpened).not.toHaveBeenCalled();
  current = false;
  sendFrom(iframe, { type: "openViewOperationResult", requestId: request.requestId, status: "opened" });
  expect(onOpened).not.toHaveBeenCalled();
  expect(notify).toHaveBeenCalledOnce();
  host.destroy();
});

it("accepts only a current View acknowledgement and clears it on deactivation", async () => {
  document.body.innerHTML = '<main id="content"></main>';
  const onOpened = vi.fn();
  const host = setupPluginViewHost({ getTarget: () => ({ sceneId: "programming", workspaceId: "project" }),
    gateway: { viewSource: async (_scene, pluginId, viewId) => ({ view: { pluginId, viewId,
      location: "main", title: "Main", html: "<main>Example</main>" } }) } });
  host.renderContent(document.getElementById("content"), plugin);
  await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const iframe = document.querySelector("iframe");
  const post = vi.spyOn(iframe.contentWindow, "postMessage");
  sendFrom(iframe, { type: "ready" });
  expect(host.openViewOperation(plugin, "example.health", "example.main", onOpened)).toBe(true);
  const request = post.mock.calls.find(([message]) => message.type === "openViewOperation")?.[0];
  sendFrom(iframe, { type: "openViewOperationResult", requestId: request.requestId, status: "opened" });
  expect(onOpened).toHaveBeenCalledOnce();
  expect(host.openViewOperation(plugin, "example.health", "example.main", onOpened)).toBe(true);
  const second = post.mock.calls.filter(([message]) => message.type === "openViewOperation").at(-1)[0];
  host.deactivate(plugin.id);
  sendFrom(iframe, { type: "openViewOperationResult", requestId: second.requestId, status: "opened" });
  expect(onOpened).toHaveBeenCalledOnce();
  host.destroy();
});

it("mounts the declared second main View before locating its operation", async () => {
  document.body.innerHTML = '<main id="content"></main>';
  const multiple = { ...plugin,
    views: [...plugin.views, { id: "example.secondary", location: "main", title: "Secondary", entry: "views/secondary.html" }],
    viewOperations: [{ id: "example.secondary.health", title: "Secondary health", viewId: "example.secondary" }],
  };
  const gateway = { viewSource: vi.fn(async (_scene, pluginId, viewId) => ({ view: {
    pluginId, viewId, location: "main", title: viewId, html: "<main>Example</main>" } })) };
  const host = setupPluginViewHost({ gateway, getTarget: () => ({ sceneId: "programming", workspaceId: "project" }) });
  const container = document.getElementById("content");
  host.renderContent(container, multiple);
  await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const first = document.querySelector("iframe");
  host.renderContent(container, multiple, "example.secondary");
  await vi.waitFor(() => expect(document.querySelector("iframe")).not.toBe(first));
  const second = document.querySelector("iframe");
  const post = vi.spyOn(second.contentWindow, "postMessage");
  expect(host.openViewOperation(multiple, "example.secondary.health", "example.secondary")).toBe(true);
  sendFrom(second, { type: "ready" });
  expect(post.mock.calls.find(([message]) => message.type === "openViewOperation")?.[0])
    .toMatchObject({ operationId: "example.secondary.health" });
  expect(gateway.viewSource).toHaveBeenCalledWith("programming", multiple.id, "example.secondary");
  expect(container.querySelectorAll("iframe")).toHaveLength(1);
  host.destroy();
});

function bridge() {
  const messages = [];
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const parent = { postMessage: message => messages.push(message) };
  const frame = { addEventListener: (type, listener) => listeners.set(type, listener) };
  runInNewContext(`(${sandboxBridge.toString()})("view-operation-channel")`, {
    parent, window: frame,
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const deliver = (requestId, operationId) => listeners.get("message")({ source: parent,
    data: { namespace: "zicode-plugin-view", channel: "view-operation-channel",
      type: "openViewOperation", requestId, operationId } });
  return { frame, messages, timers, deliver };
}

it("queues a View operation until its SDK handler registers", async () => {
  const { frame, messages, deliver } = bridge();
  deliver("view-open-1", "example.health");
  const handler = vi.fn(() => "opened");
  const subscription = frame.zicode.navigation.onOpenViewOperation(handler);
  await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({
    type: "openViewOperationResult", requestId: "view-open-1", status: "opened",
  }));
  expect(handler).toHaveBeenCalledWith({ operationId: "example.health" });
  subscription.dispose();
});

it("reports unsupported after the bounded View handler timeout", () => {
  const { messages, timers, deliver } = bridge();
  deliver("view-open-2", "example.health");
  const timeout = [...timers.values()].find(entry => entry.delay === 4_000);
  timeout.callback();
  expect(messages.at(-1)).toMatchObject({ type: "openViewOperationResult",
    requestId: "view-open-2", status: "unsupported" });
});

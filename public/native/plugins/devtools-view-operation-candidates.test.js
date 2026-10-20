import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";
import { verifyDevtoolsPackage } from "../../../scripts/verify-devtools-package.mjs";
import { sandboxBridge, setupPluginViewHost } from "./plugin-view-host.js";

const root = "tests/fixtures/devtools-view-operation-2026-10-18";
const candidates = [
  {
    folder: "agent-assist-preview-0.1.3-candidate-01",
    index: "9b7e7dee63fbdad60b178d597754c05dfd587a824874ae33282352b3ef010c63",
    viewId: "devtools.agent-assist.main",
  },
  {
    folder: "spring-actuator-0.1.3-candidate-01",
    index: "74f6bab2ed7c9ddbee2857aeac7cf4d875eda642900afbb0fb4fec31102f97cc",
    viewId: "devtools.spring-actuator.main",
  },
];

async function frozen(candidate) {
  const directory = `${root}/${candidate.folder}`;
  const receipt = await verifyDevtoolsPackage(directory, `${directory}-verification.json`);
  expect(receipt.directoryIndex).toEqual({ status: "matched", sha256: candidate.index });
  return {
    manifest: JSON.parse(readFileSync(`${directory}/plugin.json`, "utf8")),
    html: readFileSync(`${directory}/views/main.html`, "utf8"),
  };
}

function runView(html, sdk) {
  let handler;
  const dispose = vi.fn();
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      window.zicode = {
        ...sdk,
        navigation: {
          onOpenViewOperation(callback) {
            handler = callback;
            return { dispose };
          },
        },
      };
    },
  });
  return { dom, open: (operationId) => handler?.({ operationId }), registered: () => handler, dispose };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("mounts both frozen 0.1.3 main Views behind the Studio sandbox boundary", async () => {
  document.body.innerHTML = '<main id="content"></main>';
  for (const candidate of candidates) {
    const { manifest, html } = await frozen(candidate);
    const gateway = { viewSource: vi.fn(async () => ({
      view: { pluginId: manifest.id, pluginVersion: manifest.version,
        viewId: candidate.viewId, location: "main", html },
    })) };
    const host = setupPluginViewHost({
      gateway,
      getTarget: () => ({ sceneId: "programming", workspaceId: "isolated-fixture" }),
    });
    host.renderContent(document.getElementById("content"), {
      id: manifest.id, name: manifest.name, version: manifest.version,
      origin: "developer", views: manifest.contributes.views,
    });
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.srcdoc).toContain("connect-src 'none'");
    expect(iframe.srcdoc).toContain("onOpenViewOperation");
    expect(gateway.viewSource).toHaveBeenCalledWith("programming", manifest.id, candidate.viewId);
    host.destroy();
    document.getElementById("content").replaceChildren();
  }
});

it("routes each frozen manifest operation through the separate Studio View message", async () => {
  document.body.innerHTML = '<main id="content"></main>';
  for (const candidate of candidates) {
    const { manifest, html } = await frozen(candidate);
    const plugin = {
      id: manifest.id, name: manifest.name, version: manifest.version,
      origin: "developer", enabled: true, viewOperationDirectoryProfile: true,
      views: manifest.contributes.views,
      viewOperations: manifest.contributes.viewOperations,
      capabilities: manifest.contributes.capabilities,
    };
    const host = setupPluginViewHost({
      gateway: { viewSource: async () => ({ view: {
        pluginId: manifest.id, pluginVersion: manifest.version,
        viewId: candidate.viewId, location: "main", html,
      } }) },
      getTarget: () => ({ sceneId: "programming", workspaceId: "isolated-fixture" }),
    });
    host.renderContent(document.getElementById("content"), plugin);
    await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
    const iframe = document.querySelector("iframe");
    const post = vi.spyOn(iframe.contentWindow, "postMessage");
    window.dispatchEvent(new MessageEvent("message", {
      source: iframe.contentWindow,
      data: { namespace: "zicode-plugin-view", channel: iframe.dataset.pluginChannel, type: "ready" },
    }));
    const opened = vi.fn();
    for (const operation of manifest.contributes.viewOperations) {
      expect(host.openViewOperation(plugin, operation.id, operation.viewId, opened)).toBe(true);
      const request = post.mock.calls.filter(([message]) => message.type === "openViewOperation").at(-1)?.[0];
      expect(request.operationId).toBe(operation.id);
      expect(request).not.toHaveProperty("capabilityId");
      window.dispatchEvent(new MessageEvent("message", {
        source: iframe.contentWindow,
        data: { namespace: "zicode-plugin-view", channel: iframe.dataset.pluginChannel,
          type: "openViewOperationResult", requestId: request.requestId, status: "opened" },
      }));
    }
    expect(opened).toHaveBeenCalledTimes(manifest.contributes.viewOperations.length);
    host.destroy();
    document.getElementById("content").replaceChildren();
  }
});

it("opens frozen Agent Assist operations without starting model calls", async () => {
  const { html } = await frozen(candidates[0]);
  const list = vi.fn();
  const generate = vi.fn();
  const view = runView(html, {
    ready: async () => ({}),
    services: { models: { list, generate } },
  });
  try {
    await vi.waitFor(() => expect(view.registered()).toBeTypeOf("function"));
    expect(view.open("unknown.operation")).toBe("not_found");
    expect(view.open("devtools.agent-assist.models")).toBe("opened");
    expect(view.dom.window.document.activeElement.id).toBe("refresh-models");
    expect(view.open("devtools.agent-assist.generate")).toBe("opened");
    expect(view.dom.window.document.activeElement.id).toBe("limits-heading");
    expect(list).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    view.dom.window.dispatchEvent(new view.dom.window.Event("pagehide"));
    expect(view.dispose).toHaveBeenCalledOnce();
  } finally {
    view.dom.window.close();
  }
});

it("delivers Agent Assist navigation through the actual sandbox SDK bridge", async () => {
  const { html } = await frozen(candidates[0]);
  const bridgedHtml = html.replace("</head>",
    `<script>(${sandboxBridge.toString()})("candidate-channel")</script></head>`);
  const dom = new JSDOM(bridgedHtml, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
    },
  });
  try {
    const post = vi.spyOn(dom.window, "postMessage");
    const fromParent = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      source: dom.window,
      data: { namespace: "zicode-plugin-view", channel: "candidate-channel", ...data },
    }));
    fromParent({ type: "context", context: { sceneId: "programming" } });
    await vi.waitFor(() => expect(dom.window.document.getElementById("refresh-models").disabled).toBe(false));
    fromParent({ type: "openViewOperation", requestId: "native-route-1",
      operationId: "devtools.agent-assist.models" });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "openViewOperationResult", requestId: "native-route-1", status: "opened",
    }), "*"));
    expect(dom.window.document.activeElement.id).toBe("refresh-models");
    expect(post.mock.calls.some(([message]) => message.type === "request"
      && ["listModels", "generateModel"].includes(message.method))).toBe(false);
  } finally {
    dom.window.close();
  }
});

it("opens frozen Spring endpoints and summary without making an HTTP request", async () => {
  const { html } = await frozen(candidates[1]);
  const get = vi.fn();
  const view = runView(html, {
    ready: async () => ({}),
    context: { get: async () => ({}) },
    services: { http: { get } },
  });
  try {
    await vi.waitFor(() => expect(view.registered()).toBeTypeOf("function"));
    const { document } = view.dom.window;
    document.getElementById("origin").value = "https://service.example.com";
    expect(view.open("devtools.spring-actuator.unknown")).toBe("not_found");
    expect(view.open("devtools.spring-actuator.metrics")).toBe("opened");
    expect(document.getElementById("endpoint").value).toBe("metrics");
    expect(document.activeElement.id).toBe("endpoint");
    expect(view.open("devtools.spring-actuator.summary")).toBe("opened");
    expect(document.activeElement.id).toBe("result-title");
    expect(document.getElementById("origin").value).toBe("https://service.example.com");
    expect(get).not.toHaveBeenCalled();
  } finally {
    view.dom.window.close();
  }
});

it("delivers Spring navigation through the sandbox SDK without issuing HTTP GET", async () => {
  const { html } = await frozen(candidates[1]);
  const bridgedHtml = html.replace("</head>",
    `<script>(${sandboxBridge.toString()})("candidate-channel")</script></head>`);
  const dom = new JSDOM(bridgedHtml, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
    },
  });
  try {
    const post = vi.spyOn(dom.window, "postMessage");
    const fromParent = (data) => dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      source: dom.window,
      data: { namespace: "zicode-plugin-view", channel: "candidate-channel", ...data },
    }));
    fromParent({ type: "context", context: { sceneId: "programming" } });
    await vi.waitFor(() => expect(post.mock.calls.some(([message]) =>
      message.type === "request" && message.method === "getContext")).toBe(true));
    const request = post.mock.calls.find(([message]) => message.method === "getContext")?.[0];
    fromParent({ type: "response", requestId: request.requestId,
      result: { sceneId: "programming" } });
    await vi.waitFor(() => expect(dom.window.document.getElementById("run").disabled).toBe(false));
    fromParent({ type: "openViewOperation", requestId: "native-route-2",
      operationId: "devtools.spring-actuator.metrics" });
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({
      type: "openViewOperationResult", requestId: "native-route-2", status: "opened",
    }), "*"));
    expect(dom.window.document.getElementById("endpoint").value).toBe("metrics");
    expect(dom.window.document.activeElement.id).toBe("endpoint");
    expect(post.mock.calls.some(([message]) => message.type === "request"
      && message.method === "httpGet")).toBe(false);
  } finally {
    dom.window.close();
  }
});

// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadServiceWorkerSandbox() {
  const code = readFileSync(
    join(process.cwd(), "public/service-worker.js"),
    "utf8",
  );
  const listeners = {};
  const sandbox = {
    Response,
    FormData,
    URL,
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: globalThis.crypto,
    console,
    fetch: async () => new Response("ok"),
    indexedDB: undefined,
    location: { origin: "https://relay.zicode.com" },
    caches: {
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
      open: async () => ({ addAll: async () => {} }),
    },
    clients: {
      claim: async () => {},
      matchAll: async () => [],
      openWindow: async () => {},
    },
  };
  sandbox.self = sandbox;
  sandbox.addEventListener = (type, handler) => {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(handler);
  };
  sandbox.skipWaiting = () => {};
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "service-worker.js" });
  return { listeners, sandbox };
}

function respondWithCapture(listeners) {
  let captured;
  const fetchListener = listeners.fetch.find(
    (handler) => typeof handler === "function",
  );
  const event = {
    request: null,
    respondWith(promise) {
      captured = promise;
    },
  };
  return { event, get response() {
    return captured;
  }, get fetchListener() {
    return fetchListener;
  } };
}

describe("mobile Web Share Target service worker", () => {
  it("parses a multipart share form into the landing payload", async () => {
    const { sandbox } = loadServiceWorkerSandbox();
    const form = new FormData();
    form.set("title", "  Shared title  ");
    form.set("text", "  Useful excerpt  ");
    form.set("url", "https://example.com/article");
    const request = {
      formData: async () => form,
    };

    const response = await sandbox.handleShareTargetRequest(request);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("正在准备分享内容");
    expect(body).toContain('sessionStorage.setItem("zicode-mobile-share-target"');
    const payload = JSON.parse(
      Buffer.from(
        body.match(/atob\("([^"]+)"\)/)?.[1] ?? "",
        "base64",
      ).toString("utf8"),
    );
    expect(payload).toMatchObject({
      title: "Shared title",
      text: "Useful excerpt",
      url: "https://example.com/article",
    });
    expect(payload.createdAt).toBeGreaterThan(0);
    expect(payload.error).toBeUndefined();
  });

  it("marks an empty share as invalid without crashing", async () => {
    const { sandbox } = loadServiceWorkerSandbox();
    const request = { formData: async () => new FormData() };

    const response = await sandbox.handleShareTargetRequest(request);
    const body = await response.text();
    const payload = JSON.parse(
      Buffer.from(
        body.match(/atob\("([^"]+)"\)/)?.[1] ?? "",
        "base64",
      ).toString("utf8"),
    );
    expect(payload.error).toBe("empty");
  });

  it("routes POST /share-target navigate requests to the share handler", () => {
    const { listeners } = loadServiceWorkerSandbox();
    const capture = respondWithCapture(listeners);
    const request = {
      url: "https://relay.zicode.com/share-target",
      method: "POST",
      mode: "navigate",
    };
    const form = new FormData();
    form.set("text", "hello");
    request.formData = async () => form;
    capture.event.request = request;

    capture.fetchListener(capture.event);

    expect(capture.response).toBeTruthy();
    expect(typeof capture.response?.then).toBe("function");
  });

  it("routes device-scoped POST share-target paths in relay mode", () => {
    const { listeners } = loadServiceWorkerSandbox();
    const capture = respondWithCapture(listeners);
    const request = {
      url: "https://relay.zicode.com/d/dev-ax2-01/app/share-target",
      method: "POST",
      mode: "navigate",
    };
    const form = new FormData();
    form.set("text", "relay share");
    request.formData = async () => form;
    capture.event.request = request;

    capture.fetchListener(capture.event);

    expect(capture.response).toBeTruthy();
    expect(typeof capture.response?.then).toBe("function");
  });

  it("leaves non-navigate static requests untouched", () => {
    const { listeners } = loadServiceWorkerSandbox();
    const capture = respondWithCapture(listeners);
    capture.event.request = {
      url: "https://relay.zicode.com/style.css",
      method: "GET",
      mode: "same-origin",
    };

    capture.fetchListener(capture.event);

    expect(capture.response).toBeUndefined();
  });
});

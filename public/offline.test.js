// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupOfflineRecovery } from "./offline.js";

function mountOfflineControls() {
  document.body.innerHTML = `
    <div id="offline-status" data-state="offline">
      <span id="offline-status-zh"></span>
      <span id="offline-status-en"></span>
    </div>
    <button type="button" id="offline-retry"></button>
  `;
}

function loadServiceWorker({ windowClients = [] } = {}) {
  const listeners = new Map();
  const openWindow = vi.fn(async () => null);
  const cacheApi = { open: vi.fn(), keys: vi.fn() };
  const workerSelf = {
    location: { origin: "https://192.168.1.8" },
    addEventListener: (type, listener) => listeners.set(type, listener),
    skipWaiting: vi.fn(),
    clients: {
      claim: vi.fn(async () => {}),
      matchAll: vi.fn(async () => windowClients),
      openWindow,
    },
  };
  const source = `${readFileSync(resolve("public/service-worker.js"), "utf8")}\nself.__testApi = { collectSharedImages };`;
  runInNewContext(source, {
    self: workerSelf,
    caches: cacheApi,
    URL,
    Response,
    TextEncoder,
    btoa,
    fetch: vi.fn(),
  });
  return { cacheApi, listeners, openWindow, workerSelf };
}

describe("offline mobile recovery", () => {
  beforeEach(() => {
    mountOfflineControls();
  });

  it("checks the desktop and restores the requested route when the phone comes online", async () => {
    let online = false;
    const navigatorRef = {
      get onLine() {
        return online;
      },
    };
    const fetchRef = vi.fn(async () => ({ ok: true }));
    const reload = vi.fn();
    const view = setupOfflineRecovery({
      navigatorRef,
      fetchRef,
      reload,
      retryIntervalMs: 60_000,
    });
    expect(document.getElementById("offline-status").dataset.state).toBe("offline");
    expect(fetchRef).not.toHaveBeenCalled();

    online = true;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(fetchRef).toHaveBeenCalledWith(
      "/health",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
    expect(document.getElementById("offline-status").dataset.state).toBe("ready");
    view.dispose();
  });

  it("explains an available network with an unreachable desktop and supports immediate retry", async () => {
    const fetchRef = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("desktop unavailable"))
      .mockResolvedValueOnce({ ok: true });
    const reload = vi.fn();
    const view = setupOfflineRecovery({
      navigatorRef: { onLine: true },
      fetchRef,
      reload,
      retryIntervalMs: 60_000,
    });
    await vi.waitFor(() =>
      expect(document.getElementById("offline-status").dataset.state).toBe("unavailable"),
    );
    expect(document.getElementById("offline-status-zh").textContent).toMatch(/无法访问/);

    document.getElementById("offline-retry").click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(fetchRef).toHaveBeenCalledTimes(2);
    view.dispose();
  });

  it("pre-caches every module needed by the standalone offline page", () => {
    const worker = readFileSync(resolve("public/service-worker.js"), "utf8");
    const page = readFileSync(resolve("public/offline.html"), "utf8");
    expect(worker).toContain('"/offline.js"');
    expect(worker).toContain('"/offline-entry.js"');
    expect(worker).toContain("cache.addAll(OFFLINE_ASSETS)");
    expect(page).toContain('src="/offline-entry.js"');
  });

  it("declares a POST-only text, URL, and image share target", () => {
    const manifest = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8"));
    expect(manifest.share_target).toEqual({
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [
          {
            name: "images",
            accept: [
              "image/png",
              ".png",
              "image/jpeg",
              ".jpg",
              ".jpeg",
              "image/gif",
              ".gif",
              "image/webp",
              ".webp",
            ],
          },
        ],
      },
    });
  });

  it("declares honest cross-platform installation metadata", () => {
    const manifest = JSON.parse(readFileSync(resolve("public/manifest.json"), "utf8"));
    const page = readFileSync(resolve("public/index.html"), "utf8");
    expect(manifest.name).toBe("ZiCode Studio");
    expect(manifest.name).not.toContain("Desktop");
    expect(manifest.display).toBe("standalone");
    expect(manifest.background_color).toBe("#ffffff");
    expect(manifest.theme_color).toBe("#ffffff");
    expect(manifest.icons.filter((icon) => icon.type === "image/png")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: "192x192", purpose: "any" }),
        expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      ]),
    );
    expect(manifest.icons.some((icon) => icon.purpose.includes("maskable"))).toBe(true);
    expect(manifest.icons.some((icon) => icon.src.includes("tau-maskable"))).toBe(false);
    expect(page).toContain('rel="apple-touch-icon" href="icons/app-192.png"');
    expect(page).toContain('<meta name="theme-color" content="#ffffff" />');
  });

  it("accepts bounded shared images and rejects unsupported or oversized files", () => {
    const worker = loadServiceWorker();
    const valid = {
      name: "camera.JPG",
      size: 1024,
      slice: vi.fn(() => new Blob(["photo"], { type: "image/jpeg" })),
      type: "",
    };
    const unsupported = {
      name: "vector.svg",
      size: 100,
      slice: vi.fn(),
      type: "image/svg+xml",
    };
    const oversized = {
      name: "huge.png",
      size: 9 * 1024 * 1024,
      slice: vi.fn(),
      type: "image/png",
    };

    const result = worker.workerSelf.__testApi.collectSharedImages({
      getAll: () => [valid, unsupported, oversized],
    });

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ name: "camera.JPG", type: "image/jpeg" });
    expect(result.error).toBe("too_large");
    expect(valid.slice).toHaveBeenCalledWith(0, 1024, "image/jpeg");
    expect(unsupported.slice).not.toHaveBeenCalled();
    expect(oversized.slice).not.toHaveBeenCalled();
  });

  it("caps a system share at four images and twelve megabytes in total", () => {
    const worker = loadServiceWorker();
    const images = Array.from({ length: 5 }, (_, index) => ({
      name: `photo-${index + 1}.png`,
      size: 3 * 1024 * 1024,
      slice: vi.fn(() => new Blob(["photo"], { type: "image/png" })),
      type: "image/png",
    }));

    const result = worker.workerSelf.__testApi.collectSharedImages({ getAll: () => images });

    expect(result.files).toHaveLength(4);
    expect(result.error).toBe("too_large");
    expect(images[4].slice).not.toHaveBeenCalled();
  });

  it("moves shared text through a no-store landing page without putting content in the URL", async () => {
    const worker = loadServiceWorker();
    const fields = new Map([
      ["title", "Private research title"],
      ["text", "A private excerpt"],
      ["url", "https://example.com/research"],
    ]);
    let responsePromise;
    worker.listeners.get("fetch")({
      request: {
        url: "https://192.168.1.8/share-target",
        method: "POST",
        mode: "navigate",
        formData: async () => ({ get: (name) => fields.get(name) ?? null }),
      },
      respondWith: (promise) => {
        responsePromise = promise;
      },
    });
    const response = await responsePromise;
    const body = await response.text();
    const encoded = body.match(/atob\("([^"]+)"\)/)?.[1];
    const payload = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    const script = body.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    const setItem = vi.fn();
    const replace = vi.fn();
    runInNewContext(script, {
      sessionStorage: { setItem },
      localStorage: {
        getItem: () => "/app/workspaces/workspace-1/sessions/session-1",
      },
      location: { replace },
      atob,
      TextDecoder,
      Uint8Array,
    });

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(payload).toMatchObject({
      title: "Private research title",
      text: "A private excerpt",
      url: "https://example.com/research",
    });
    expect(body).not.toContain("Private research title");
    expect(body).not.toContain("A private excerpt");
    expect(body).not.toContain("?title=");
    expect(worker.cacheApi.open).not.toHaveBeenCalled();
    expect(setItem).toHaveBeenCalledWith("zicode-mobile-share-target", JSON.stringify(payload));
    expect(replace).toHaveBeenCalledWith(
      "/app/workspaces/workspace-1/sessions/session-1",
    );
  });

  it("focuses ZiCode when a background task notification is opened", async () => {
    const focus = vi.fn(async () => null);
    const worker = loadServiceWorker({
      windowClients: [
        {
          url: "https://192.168.1.8/app/workspaces/workspace-1/sessions/session-1",
          focus,
        },
      ],
    });
    const close = vi.fn();
    let completion;
    worker.listeners.get("notificationclick")({
      notification: {
        close,
        data: { path: "/app/workspaces/workspace-1/sessions/session-1" },
      },
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    await completion;

    expect(close).toHaveBeenCalledOnce();
    expect(worker.workerSelf.clients.matchAll).toHaveBeenCalledWith({
      type: "window",
      includeUncontrolled: true,
    });
    expect(focus).toHaveBeenCalledOnce();
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("rejects an untrusted notification route before opening a new window", async () => {
    const worker = loadServiceWorker();
    let completion;
    worker.listeners.get("notificationclick")({
      notification: { close: vi.fn(), data: { path: "https://attacker.invalid/steal" } },
      waitUntil: (promise) => {
        completion = promise;
      },
    });
    await completion;

    expect(worker.openWindow).toHaveBeenCalledWith("/");
  });
});

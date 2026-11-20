import { createServer, type Server } from "node:http";
import { expect, it, vi } from "vitest";
import { createTranslationStore, TranslationHttpGateway } from "./translationStore";

function latch<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No loopback address");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
}

it("discards a real delayed HTTP completion after editing, does not retry, then accepts a new explicit request", async () => {
  const arrived = latch<Record<string, unknown>>(), release = latch<void>();
  const requests: Record<string, unknown>[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      let raw = ""; for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw); requests.push(body); arrived.resolve(body);
      await release.promise;
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ translated: body.text === "First HTTP input" ? "Old HTTP translation" : "Fresh HTTP translation", model: body.model, targetLang: body.targetLang, charCount: 22 }));
    })().catch(() => { response.statusCode = 500; response.end(); });
  });
  const origin = await listen(server);
  try {
    const notify = vi.fn();
    const gateway = new TranslationHttpGateway({ fetchImpl: globalThis.fetch, location: { origin } as Location });
    const store = createTranslationStore({ gateway, getTarget: () => ({ sceneId: "programming", workspaceId: "http-workspace" }), notify });
    store.getState().setModelSelection({ sceneId: "programming", provider: "fixture", model: "fixed-text" });
    store.getState().setText("First HTTP input"); const work = store.getState().run();
    expect(await arrived.promise).toMatchObject({ sceneId: "programming", workspaceId: "http-workspace", text: "First HTTP input", provider: "fixture", model: "fixed-text" });
    store.getState().setText("New writing from the user"); release.resolve(); await work;
    expect(store.getState().text).toBe("New writing from the user"); expect(store.getState().result).toBeNull(); expect(notify).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    await store.getState().run();
    expect(requests).toHaveLength(2); expect(requests[1].text).toBe("New writing from the user");
    expect(store.getState().editedText).toBe("Fresh HTTP translation"); expect(notify).toHaveBeenCalledTimes(1);
  } finally { release.resolve(); await close(server); }
});

it("keeps an old workspace's real HTTP error out of the new workspace", async () => {
  const arrived = latch<void>(), release = latch<void>();
  const server = createServer((request, response) => {
    void (async () => {
      for await (const _chunk of request) { /* Drain only synthetic test input. */ }
      arrived.resolve(); await release.promise;
      response.writeHead(500, { "content-type": "application/json" }); response.end(JSON.stringify({ error: { message: "Old workspace provider error" } }));
    })().catch(() => response.end());
  });
  const origin = await listen(server);
  try {
    const target = { sceneId: "programming", workspaceId: "first" }, notify = vi.fn();
    const gateway = new TranslationHttpGateway({ fetchImpl: globalThis.fetch, location: { origin } as Location });
    const store = createTranslationStore({ gateway, getTarget: () => target, notify });
    store.getState().setModelSelection({ sceneId: "programming", provider: "fixture", model: "fixed-text" }); store.getState().setText("Synthetic HTTP input");
    const work = store.getState().run(); await arrived.promise; target.workspaceId = "second"; release.resolve(); await work;
    expect(store.getState().error).toBe(""); expect(store.getState().result).toBeNull(); expect(store.getState().busy).toBe(false); expect(notify).not.toHaveBeenCalled();
  } finally { release.resolve(); await close(server); }
});

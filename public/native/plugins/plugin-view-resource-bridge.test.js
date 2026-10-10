import { describe, expect, it, vi } from "vitest";
import { setupPluginViewHost } from "./plugin-view-host.js";

const ref = {
  capabilityId: "example.read",
  resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contentVersion: "a".repeat(64),
  offset: 0,
  length: 1,
};
const reply = {
  schemaVersion: 1,
  resourceId: ref.resourceId,
  contentVersion: ref.contentVersion,
  offset: 0,
  byteLength: 1,
  eof: true,
  dataBase64: "AA==",
};
async function setup() {
  document.body.innerHTML = '<main id="content"></main>';
  let target = {
    workspaceId: "workspace",
    sceneId: "programming",
    sessionId: "session",
    instanceId: "runtime",
  };
  const gateway = {
    viewSource: vi.fn(async () => ({
      view: { pluginId: "self", viewId: "test", location: "main", html: "<h1>Resource test</h1>" },
    })),
  };
  const capabilityGateway = { readResource: vi.fn(async () => reply) };
  const host = setupPluginViewHost({ gateway, capabilityGateway, getTarget: () => target });
  host.renderContent(document.getElementById("content"), {
    id: "self",
    origin: "developer",
    views: [{ id: "test", location: "main", entry: "test.html" }],
  });
  await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const iframe = document.querySelector("iframe");
  const post = vi.spyOn(iframe.contentWindow, "postMessage");
  const send = (params, source = iframe.contentWindow) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source,
        data: {
          namespace: "zicode-plugin-view",
          channel: iframe.dataset.pluginChannel,
          type: "request",
          requestId: "resource",
          method: "readResource",
          params,
        },
      }),
    );
  return {
    host,
    iframe,
    post,
    send,
    capabilityGateway,
    change: () => {
      target = { ...target, sessionId: "new" };
    },
  };
}
describe("resource View message bridge", () => {
  it("routes the real parent handler with frame identity", async () => {
    const c = await setup();
    c.send(ref);
    await vi.waitFor(() =>
      expect(c.post).toHaveBeenCalledWith(expect.objectContaining({ result: reply }), "*"),
    );
    expect(c.capabilityGateway.readResource.mock.calls[0][0]).toEqual({
      runtimeId: "runtime",
      sessionId: "session",
      pluginId: "self",
      capabilityId: "example.read",
    });
    expect(c.iframe.srcdoc).toContain("readResource");
    c.host.destroy();
  });
  it("rejects source/identity overrides and changed targets before HTTP", async () => {
    const c = await setup();
    c.send(ref, window);
    expect(c.capabilityGateway.readResource).not.toHaveBeenCalled();
    c.send({ ...ref, owner: {} });
    await vi.waitFor(() =>
      expect(c.post).toHaveBeenCalledWith(
        expect.objectContaining({ error: "[resource_request_invalid]" }),
        "*",
      ),
    );
    c.change();
    c.send(ref);
    await vi.waitFor(() =>
      expect(c.post).toHaveBeenCalledWith(
        expect.objectContaining({ error: "[resource_view_changed]" }),
        "*",
      ),
    );
    expect(c.capabilityGateway.readResource).not.toHaveBeenCalled();
    c.host.destroy();
  });
  it("drops successful data when a View disappears during HTTP", async () => {
    const c = await setup();
    let finish;
    c.capabilityGateway.readResource.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    c.send(ref);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    c.host.setTarget();
    finish(reply);
    await Promise.resolve();
    await Promise.resolve();
    expect(c.post.mock.calls.some(([message]) => message.result?.dataBase64)).toBe(false);
    c.host.destroy();
  });
});

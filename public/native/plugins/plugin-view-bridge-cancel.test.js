import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { sandboxBridge } from "./plugin-view-host.js";

function bridge(onPostMessage) {
  const messages = [];
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const parent = {
    postMessage: (message) => {
      messages.push(message);
      onPostMessage?.(message);
    },
  };
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
  };
  runInNewContext(`(${sandboxBridge.toString()})("test-channel")`, {
    parent,
    window,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const respond = (requestId, errorCode) =>
    listeners.get("message")({
      source: parent,
      data: {
        namespace: "zicode-plugin-view",
        channel: "test-channel",
        type: "response",
        requestId,
        error: "HTTP service request cancelled",
        errorCode,
      },
    });
  return { window, messages, timers, respond };
}

describe("plugin View HTTP cancellation bridge", () => {
  it("passes an AbortSignal only as a cancellation requirement and request ID", async () => {
    const { window, messages, respond } = bridge();
    const controller = new AbortController();
    const result = window.zicode.capabilities.invoke("tool.run", { value: 1 },
      { signal: controller.signal });
    expect(messages.at(-1)).toMatchObject({ type: "request", method: "invokeCapability",
      params: { capabilityId: "tool.run", input: { value: 1 }, cancelRequired: true } });
    expect(JSON.stringify(messages)).not.toContain("AbortSignal");
    controller.abort();
    expect(messages.at(-1)).toMatchObject({ type: "cancelRequest", requestId: "view-1" });
    respond("view-1", "worker_cancelled");
    await expect(result).rejects.toMatchObject({ code: "worker_cancelled" });
  });
  it("sends the Host cancellation request when HTTP GET is aborted", async () => {
    const { window, messages, respond } = bridge();
    const controller = new AbortController();
    const result = window.zicode.services.http.get(
      { origin: "https://example.test", endpoint: "health" },
      { signal: controller.signal },
    );
    expect(messages.map((message) => message.type)).toEqual(["ready", "request"]);
    controller.abort();
    expect(messages.at(-1)).toMatchObject({ type: "cancelRequest", requestId: "view-1" });
    respond("view-1", "http_service_request_cancelled");
    await expect(result).rejects.toMatchObject({ code: "http_service_request_cancelled" });
  });

  it("cancels the Host operation when the View HTTP request times out", async () => {
    const { window, messages, timers } = bridge();
    const result = window.zicode.services.http.get({
      origin: "https://example.test",
      endpoint: "info",
    });
    expect(timers.size).toBe(1);
    const timeout = [...timers.values()][0];
    expect(timeout.delay).toBe(75_000);
    timeout.callback();
    expect(messages.at(-1)).toMatchObject({ type: "cancelRequest", requestId: "view-1" });
    await expect(result).rejects.toMatchObject({ code: "plugin_view_timeout" });
  });

  it("does not start a Host request with an already aborted signal", async () => {
    const { window, messages } = bridge();
    const controller = new AbortController();
    controller.abort();
    await expect(
      window.zicode.services.http.get(
        { origin: "https://example.test", endpoint: "metrics" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "http_service_request_cancelled" });
    expect(messages.map((message) => message.type)).toEqual(["ready"]);
  });

  it("catches an abort that occurs while the request is being posted", async () => {
    const controller = new AbortController();
    const { window, messages, respond } = bridge((message) => {
      if (message.type === "request") controller.abort();
    });
    const result = window.zicode.services.http.get(
      { origin: "https://example.test", endpoint: "health" },
      { signal: controller.signal },
    );
    expect(messages.map((message) => message.type)).toEqual(["ready", "request", "cancelRequest"]);
    respond("view-1", "http_service_request_cancelled");
    await expect(result).rejects.toMatchObject({ code: "http_service_request_cancelled" });
  });
});

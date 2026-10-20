import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { sandboxBridge } from "./plugin-view-host.js";

function bridge() {
  const messages = [];
  const listeners = new Map();
  const timers = new Map();
  let nextTimer = 0;
  const parent = { postMessage: (message) => messages.push(message) };
  const window = { addEventListener: (type, listener) => listeners.set(type, listener) };
  runInNewContext(`(${sandboxBridge.toString()})("tool-open-channel")`, {
    parent, window,
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  const deliver = (requestId, capabilityId) => listeners.get("message")({
    source: parent,
    data: { namespace: "zicode-plugin-view", channel: "tool-open-channel",
      type: "openTool", requestId, capabilityId },
  });
  return { window, messages, timers, deliver };
}

it("queues a tool location until the View registers its handler", async () => {
  const { window, messages, deliver } = bridge();
  deliver("open-1", "format.json");
  expect(messages.map((message) => message.type)).toEqual(["ready"]);
  const handle = vi.fn(() => "opened");
  const subscription = window.zicode.navigation.onOpenTool(handle);
  await vi.waitFor(() => expect(messages.at(-1)).toMatchObject({
    type: "openToolResult", requestId: "open-1", status: "opened",
  }));
  expect(handle).toHaveBeenCalledWith({ capabilityId: "format.json" });
  subscription.dispose();
});

it("reports unsupported when no View handler accepts the location", () => {
  const { messages, timers, deliver } = bridge();
  deliver("open-2", "format.json");
  const timeout = [...timers.values()][0];
  expect(timeout.delay).toBe(4_000);
  timeout.callback();
  expect(messages.at(-1)).toMatchObject({
    type: "openToolResult", requestId: "open-2", status: "unsupported",
  });
});

it("reports a slow View callback once and ignores its late acknowledgement", async () => {
  const { window, messages, timers, deliver } = bridge();
  let complete;
  window.zicode.navigation.onOpenTool(() => new Promise((resolve) => { complete = resolve; }));
  deliver("open-slow", "format.json");
  await vi.waitFor(() => expect(complete).toBeTypeOf("function"));
  const timeout = [...timers.values()].find((entry) => entry.delay === 4_000);
  timeout.callback();
  expect(messages.filter((message) => message.type === "openToolResult"))
    .toEqual([expect.objectContaining({
      requestId: "open-slow", status: "unsupported",
    })]);
  complete("opened");
  await Promise.resolve();
  await Promise.resolve();
  expect(messages.filter((message) => message.type === "openToolResult")).toHaveLength(1);
});

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextEncoder } from "node:util";
import { JSDOM } from "jsdom";
import { expect, it, vi } from "vitest";
import { verifyDevtoolsPackage } from "../../../scripts/verify-devtools-package.mjs";
import { sandboxBridge } from "./plugin-view-host.js";

const candidate = process.env.ZICODE_TEST_INSPECT_012_DIR;
const receipt = process.env.ZICODE_TEST_INSPECT_012_RECEIPT;

it.skipIf(!candidate || !receipt)("routes all eight real Inspect 0.1.2 View tool locations without invoking a capability", async () => {
  const verified = await verifyDevtoolsPackage(candidate, receipt);
  expect(verified.fileCount).toBe(616);
  expect(verified.directoryIndex.status).toBe("matched");
  const manifest = JSON.parse(await readFile(join(candidate, "plugin.json"), "utf8"));
  const vectors = JSON.parse(await readFile(join(candidate, "verification/tool-open-vectors.json"), "utf8"));
  const html = await readFile(join(candidate, "views/main.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
  const { window } = dom;
  const messages = [];
  const parent = { postMessage: (message) => messages.push(message) };
  window.__testParent = parent;
  window.TextEncoder = TextEncoder;
  const deliver = (type, fields) => {
    const event = new window.Event("message");
    Object.defineProperties(event, {
      source: { value: parent },
      data: { value: { namespace: "zicode-plugin-view", channel: "inspect-012", type, ...fields } },
    });
    window.dispatchEvent(event);
  };
  try {
    window.eval(`((parent) => (${sandboxBridge.toString()})("inspect-012"))(window.__testParent)`);
    expect(messages.at(-1)?.type).toBe("ready");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    window.eval(script);
    deliver("context", { context: { sceneId: "programming" } });
    await vi.waitFor(() => expect(messages.some((message) =>
      message.type === "request" && message.method === "getContext")).toBe(true));
    const contextRequest = messages.find((message) =>
      message.type === "request" && message.method === "getContext");
    deliver("response", { requestId: contextRequest.requestId, result: { sceneId: "programming" } });
    await vi.waitFor(() => expect(window.document.getElementById("status").textContent)
      .toContain("可以处理文本"));
    const declaredIds = manifest.contributes.capabilities.map((capability) => capability.id);
    expect(declaredIds.sort()).toEqual(Object.keys(vectors.mapping).sort());
    for (const [index, capabilityId] of declaredIds.entries()) {
      const requestId = `inspect-${index}`;
      deliver("openTool", { requestId, capabilityId });
      await vi.waitFor(() => expect(messages.find((message) =>
        message.type === "openToolResult" && message.requestId === requestId)?.status).toBe("opened"));
      expect(window.document.getElementById("operation").value).toBe(vectors.mapping[capabilityId]);
      expect(window.document.activeElement.id).toBe("input");
    }
    const selected = window.document.getElementById("operation").value;
    deliver("openTool", { requestId: "inspect-unknown", capabilityId: "devtools.inspect.not-registered" });
    await vi.waitFor(() => expect(messages.find((message) =>
      message.type === "openToolResult" && message.requestId === "inspect-unknown")?.status).toBe("not_found"));
    expect(window.document.getElementById("operation").value).toBe(selected);
    expect(messages.filter((message) => message.type === "request" && message.method === "invokeCapability"))
      .toHaveLength(0);
  } finally {
    window.close();
  }
});

import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { setupPluginViewHost } from "./plugin-view-host.js";

const root = "tests/fixtures/devtools-text-dev57/";
const manifest = JSON.parse(readFileSync(`${root}plugin.json`, "utf8"));
const html = readFileSync(`${root}views/main.html`, "utf8");

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("bridges the immutable DevTools View contract with bound identity and distinct business/Host errors", async () => {
  document.body.innerHTML = '<main id="content"></main>';
  const plugin = { id: manifest.id, name: manifest.name, version: manifest.version, origin: "developer", views: manifest.contributes.views };
  const success = { contractVersion: "1.0.0-rc.1", ok: true, data: { text: "aGVsbG8=" }, error: null };
  const failure = { contractVersion: "1.0.0-rc.1", ok: false, data: null, error: { code: "INVALID_ENCODING", message: "Invalid Base64" } };
  const invoke = vi.fn().mockResolvedValueOnce({ result: success }).mockResolvedValueOnce({ result: failure }).mockRejectedValueOnce(new Error("Plugin is disabled"));
  const host = setupPluginViewHost({
    gateway: { viewSource: vi.fn(async () => ({ view: { pluginId: manifest.id, pluginVersion: manifest.version, viewId: "devtools.text.main", location: "main", html } })) },
    capabilityGateway: { invoke },
    getTarget: () => ({ sceneId: "programming", workspaceId: "workspace-fixture" }),
  });
  host.renderContent(document.getElementById("content"), plugin);
  await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const iframe = document.querySelector("iframe");
  expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  const post = vi.spyOn(iframe.contentWindow, "postMessage");
  for (const [index, result] of [success, failure, null].entries()) {
    window.dispatchEvent(new MessageEvent("message", {
      source: iframe.contentWindow,
      data: { namespace: "zicode-plugin-view", channel: iframe.dataset.pluginChannel, type: "request", requestId: `devtools-${index}`, method: "invokeCapability", params: { pluginId: "com.other.plugin", sceneId: "writing", capabilityId: "devtools.text.base64.encode", input: { text: "hello" } } },
    }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(index + 1));
    expect(invoke.mock.calls[index]).toEqual(["programming", "workspace-fixture", manifest.id, "devtools.text.base64.encode", { text: "hello" }]);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({ requestId: `devtools-${index}`, ...(result ? { result } : { error: "Plugin is disabled" }) }), "*"));
  }
  host.destroy();
});

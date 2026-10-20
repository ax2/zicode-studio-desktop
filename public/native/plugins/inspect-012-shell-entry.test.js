import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { verifyDevtoolsPackage } from "../../../scripts/verify-devtools-package.mjs";
import { setLocale } from "../../i18n.js";
import { BuiltinPluginRegistry } from "./plugin-registry.js";
import { setupPluginShell } from "./plugin-shell.js";
import { setupPluginViewHost } from "./plugin-view-host.js";

const candidate = process.env.ZICODE_TEST_INSPECT_012_DIR;
const receipt = process.env.ZICODE_TEST_INSPECT_012_RECEIPT;

it.skipIf(!candidate || !receipt)("passes a real Inspect catalog choice through the Studio shell to its main View", async () => {
  const verified = await verifyDevtoolsPackage(candidate, receipt);
  expect(verified.directoryIndex.status).toBe("matched");
  const manifest = JSON.parse(await readFile(join(candidate, "plugin.json"), "utf8"));
  const html = await readFile(join(candidate, "views/main.html"), "utf8");
  setLocale("en");
  document.body.innerHTML = `<div class="app-layout"><div id="sidebar" class="sidebar">
    <div class="sidebar-header"></div><div id="session-list"></div><div class="sidebar-footer"></div>
    </div><div class="main"><div class="header"><div class="header-left"></div><div class="header-right"></div></div>
    <div id="messages"></div><div class="input-area"></div></div>
    <div id="super-agent-runtime"></div><div id="file-sidebar"></div></div>`;
  history.replaceState(null, "", "/app/workspaces/inspect-acceptance/sessions/test");
  const pluginId = manifest.id;
  const capabilityId = manifest.contributes.capabilities[0].id;
  const view = manifest.contributes.views.find((item) => item.location === "main");
  const descriptor = {
    ...manifest,
    origin: "developer",
    enabled: true,
    toolOpenProfile: true,
    contributes: {
      activities: manifest.contributes.activities,
      views: manifest.contributes.views,
      capabilities: manifest.contributes.capabilities.map(({ id, title }) => ({ id, title })),
    },
    permissionGrants: {},
  };
  const hostGateway = {
    list: vi.fn(async () => ({ sceneId: "programming", plugins: [
      { id: "core.chat", name: "Chat", version: "1.0.0", publisher: "zicode", core: true,
        origin: "builtIn", enabled: true, contributes: {}, permissionGrants: {} },
      descriptor,
    ] })),
  };
  const registry = new BuiltinPluginRegistry({ hostGateway, storage: { getItem: () => null, setItem: () => {} } });
  const tool = {
    toolId: JSON.stringify([pluginId, capabilityId]), accessId: `manual.tool:${pluginId}`,
    pluginId, capabilityId, title: manifest.contributes.capabilities[0].title,
    applicationName: manifest.name, publisher: manifest.publisher, version: manifest.version,
    enabled: true, runtime: "wasi",
  };
  const capabilityGateway = {
    searchTools: vi.fn(async () => ({ items: [tool], total: 1, revision: "inspect-012", nextOffset: null })),
    loadTool: vi.fn(async () => ({ pluginId, version: manifest.version, revision: "inspect-012",
      enabled: true, capability: manifest.contributes.capabilities[0], permissions: [] })),
    invoke: vi.fn(),
  };
  const target = { sceneId: "programming", workspaceId: "inspect-acceptance" };
  const viewSource = vi.fn(async () => ({ view: { pluginId, pluginVersion: manifest.version,
    viewId: view.id, location: "main", title: view.title, html } }));
  const notify = vi.fn();
  const viewHost = setupPluginViewHost({ gateway: { viewSource }, capabilityGateway,
    getTarget: () => target, notify });
  const shell = setupPluginShell({ registry, pluginViewHost: viewHost, capabilityGateway,
    getTarget: () => target, notify });
  try {
    await vi.waitFor(() => expect(registry.get(pluginId)?.enabled).toBe(true));
    await shell.activate("core.tools");
    await vi.waitFor(() => expect(document.body.textContent).toContain(tool.title));
    const button = (label) => [...document.querySelectorAll("button")]
      .find((candidate) => candidate.textContent === label);
    button("Open tool").click();
    await vi.waitFor(() => expect(button("Open application")).toBeTruthy());
    button("Open application").click();
    await vi.waitFor(() => expect(shell.getActivePluginId()).toBe(pluginId));
    await vi.waitFor(() => expect(document.querySelector("iframe.plugin-view-frame")).toBeTruthy());
    const iframe = document.querySelector("iframe.plugin-view-frame");
    const post = vi.spyOn(iframe.contentWindow, "postMessage");
    window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow,
      data: { namespace: "zicode-plugin-view", channel: iframe.dataset.pluginChannel, type: "ready" } }));
    await vi.waitFor(() => expect(post.mock.calls.some(([message]) =>
      message.type === "openTool" && message.capabilityId === capabilityId)).toBe(true));
    const request = post.mock.calls.find(([message]) => message.type === "openTool")?.[0];
    window.dispatchEvent(new MessageEvent("message", { source: iframe.contentWindow,
      data: { namespace: "zicode-plugin-view", channel: iframe.dataset.pluginChannel,
        type: "openToolResult", requestId: request.requestId, status: "opened" } }));
    expect(viewSource).toHaveBeenCalledWith("programming", pluginId, view.id);
    expect(capabilityGateway.invoke).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  } finally {
    shell.destroy();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  }
});

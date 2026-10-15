import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { verifyDevtoolsPackage } from "../../../scripts/verify-devtools-package.mjs";
import { setupPluginViewHost } from "./plugin-view-host.js";

const fixture = "tests/fixtures/devtools-agent-assist-candidate03";
const manifest = JSON.parse(readFileSync(`${fixture}/plugin.json`, "utf8"));
const html = readFileSync(`${fixture}/views/main.html`, "utf8");
const plugin = {
  id: manifest.id,
  name: manifest.name,
  version: manifest.version,
  origin: "developer",
  views: manifest.contributes.views,
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("receives the byte-frozen DevTools model View and mounts it in Studio's sandbox", async () => {
  const receipt = await verifyDevtoolsPackage(
    fixture,
    "tests/fixtures/devtools-agent-assist-candidate03.verification.json",
  );
  expect(receipt).toMatchObject({
    verified: true,
    fileCount: 6,
    logicalBytes: 37022,
    indexSha256: "16e9f334dc5aa1da00f36fa4ec66f80a4210ade2b7f9b9da2779905d19c491cf",
    signatureVerified: false,
    runtimeAccepted: false,
    fullToolAcceptance: false,
  });
  expect(manifest.requiredProfiles).toEqual({
    "model.catalog.read.v1": "=1.0.0-preview.1",
    "model.generate.v1": "=1.0.0-preview.1",
  });
  document.body.innerHTML = '<main id="content"></main>';
  const gateway = {
    viewSource: vi.fn(async () => ({
      view: {
        pluginId: manifest.id,
        pluginVersion: manifest.version,
        viewId: "devtools.agent-assist.main",
        location: "main",
        html,
      },
    })),
  };
  const host = setupPluginViewHost({
    gateway,
    getTarget: () => ({
      sceneId: "programming",
      workspaceId: "fixture",
      instanceId: "runtime",
      sessionId: "session",
    }),
  });
  host.renderContent(document.getElementById("content"), plugin);
  await vi.waitFor(() => expect(document.querySelector("iframe")).toBeTruthy());
  const frame = document.querySelector("iframe");
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(frame.srcdoc).toContain("connect-src 'none'");
  expect(frame.srcdoc).toContain("window.ZiAgentAssistLimits");
  expect(frame.srcdoc).toContain("window.zicode?.services?.models");
  expect(document.querySelector(".plugin-view-error")).toBeNull();
  expect(gateway.viewSource).toHaveBeenCalledWith(
    "programming",
    manifest.id,
    "devtools.agent-assist.main",
  );
  host.destroy();
});

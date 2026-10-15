import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
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

it("runs the candidate View script through model selection, generation and result rendering", async () => {
  const list = vi.fn(async () => ({
    schemaVersion: 1,
    operation: "models.list",
    result: {
      models: [{
        modelRef: "opaque-model-ref",
        displayName: "Fixture model",
        providerKind: "host_managed",
        supportsCancellation: false,
      }],
    },
  }));
  const generate = vi.fn(async (input) => ({
    schemaVersion: 1,
    operation: "model.generate",
    result: { text: "<script>candidate output</script>" },
  }));
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      window.TextEncoder = TextEncoder;
      window.TextDecoder = TextDecoder;
      window.zicode = {
        ready: async () => ({ sceneId: "fixture-scene" }),
        services: { models: { list, generate } },
      };
    },
  });
  try {
    const { document, Event } = dom.window;
    await vi.waitFor(() => expect(document.getElementById("refresh-models").disabled).toBe(false));
    document.getElementById("refresh-models").click();
    await vi.waitFor(() => expect(list).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(document.querySelector('#model-select option[value="0"]')).toBeTruthy();
      expect(document.getElementById("form-fields").disabled).toBe(false);
    });
    document.getElementById("goal").value = "Summarize the supplied goal";
    document.getElementById("goal").dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("generation-form").dispatchEvent(new Event("submit", {
      bubbles: true,
      cancelable: true,
    }));
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    expect(generate.mock.calls[0][0]).toMatchObject({
      modelRef: "opaque-model-ref",
      goal: "Summarize the supplied goal",
      materials: [],
      maxOutputTokens: 1024,
      deadlineMs: 60000,
    });
    await vi.waitFor(() => expect(document.getElementById("result-text").textContent)
      .toBe("<script>candidate output</script>"));
    expect(document.getElementById("result-card").hidden).toBe(false);
    expect(document.getElementById("generation-status").textContent).toContain("生成完成");
    expect(document.querySelector("#result-text script")).toBeNull();
  } finally {
    dom.window.close();
  }
});

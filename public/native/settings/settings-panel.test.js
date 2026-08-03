import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupSettingsPanel } from "./settings-panel.js";

function renderSettingsDom() {
  document.body.innerHTML = `
    <button id="settings-btn"></button>
    <div class="settings-overlay hidden" id="settings-overlay"></div>
    <div class="settings-panel hidden" id="settings-panel">
      <aside class="settings-nav">
        <button class="settings-nav-item active" data-settings-tab="general">General</button>
        <button class="settings-nav-item" data-settings-tab="extensions">Extensions</button>
        <button class="settings-nav-item" data-settings-tab="usage">Usage</button>
        <button class="settings-nav-item" data-settings-tab="configuration">Configuration</button>
        <button class="settings-nav-item" data-settings-tab="remote-access">Remote access</button>
        <button class="settings-nav-back" id="settings-close">Back</button>
      </aside>
      <section class="settings-content">
        <div class="settings-tab active" data-settings-panel="general"></div>
        <div class="settings-tab" data-settings-panel="extensions"></div>
        <div class="settings-tab" data-settings-panel="usage"></div>
        <div class="settings-tab" data-settings-panel="configuration">
          <strong id="configuration-scene-name"></strong>
          <code id="configuration-scene-id"></code>
          <div id="settings-api-keys"></div>
          <div id="provider-channel-list"></div>
          <span id="inline-config-path"></span>
          <textarea id="inline-config-textarea"></textarea>
          <div id="inline-config-error" class="hidden"></div>
          <span id="inline-models-path"></span>
          <textarea id="inline-models-textarea"></textarea>
          <div id="inline-models-error" class="hidden"></div>
        </div>
        <div class="settings-tab" data-settings-panel="remote-access">
          <div id="settings-remote-access"></div>
        </div>
      </section>
    </div>
  `;
}

describe("settings panel hash routing", () => {
  beforeEach(() => {
    renderSettingsDom();
    history.replaceState(null, "", "/app/workspaces/workspace-a/sessions/session-a");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState(null, "", "/app/workspaces/workspace-a/sessions/session-a");
  });

  it("writes #/settings/<tab> to the URL hash when a tab is opened", () => {
    const panel = setupSettingsPanel();
    panel.openSettings("usage");

    expect(window.location.hash).toBe("#/settings/usage");
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(false);
  });

  it("clears the hash when settings is closed", () => {
    const panel = setupSettingsPanel();
    panel.openSettings("general");
    panel.closeSettings();

    expect(window.location.hash).toBe("");
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(true);
  });

  it("preserves application history state while changing settings tabs", () => {
    history.replaceState(
      { zicodePluginId: "core.settings" },
      "",
      "/app/workspaces/workspace-a/sessions/session-a",
    );
    const panel = setupSettingsPanel();
    panel.openSettings("appearance");
    expect(history.state).toEqual({ zicodePluginId: "core.settings" });
    panel.closeSettings();
    expect(history.state).toEqual({ zicodePluginId: "core.settings" });
  });

  it("reopens the settings panel on the saved tab when the hash is already present at load", () => {
    // Simulates a page refresh: the hash survives reload, so setup must
    // restore settings-open state instead of leaving the user on chat.
    window.location.hash = "#/settings/configuration";

    setupSettingsPanel();

    const panel = document.getElementById("settings-panel");
    expect(panel.classList.contains("hidden")).toBe(false);
    const configTab = document.querySelector('[data-settings-panel="configuration"]');
    expect(configTab.classList.contains("active")).toBe(true);
  });

  it("falls back to the general tab for an unknown hash tab key", () => {
    window.location.hash = "#/settings/does-not-exist";

    setupSettingsPanel();

    const generalTab = document.querySelector('[data-settings-panel="general"]');
    expect(generalTab.classList.contains("active")).toBe(true);
  });

  it("responds to hashchange events fired after setup (e.g. back/forward navigation)", () => {
    setupSettingsPanel();
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(true);

    window.location.hash = "#/settings/extensions";
    window.dispatchEvent(new HashChangeEvent("hashchange"));

    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(false);
    const extensionsTab = document.querySelector('[data-settings-panel="extensions"]');
    expect(extensionsTab.classList.contains("active")).toBe(true);
  });

  it("mounts navigation and content into the application shell", () => {
    const settings = setupSettingsPanel();
    const openHandler = vi.fn();
    settings.setOpenHandler(openHandler);
    const navigationHost = document.createElement("aside");
    const contentHost = document.createElement("main");

    settings.openSettings("usage");
    settings.renderNavigation(navigationHost);
    settings.renderContent(contentHost);

    expect(openHandler).toHaveBeenCalledWith("usage");
    expect(navigationHost.querySelector('[data-settings-tab="usage"]')).not.toBeNull();
    expect(contentHost.querySelector('[data-settings-panel="usage"]')).not.toBeNull();
    expect(document.getElementById("settings-panel").classList.contains("hidden")).toBe(true);
  });

  it("loads paired devices when the remote access tab opens", async () => {
    const listDevices = vi.fn(async () => []);
    const getStatus = vi.fn(async () => ({ configuredEnabled: false, running: false }));
    const settings = setupSettingsPanel({ remoteAccessGateway: { getStatus, listDevices } });

    settings.openSettings("remote-access");

    await vi.waitFor(() => expect(listDevices).toHaveBeenCalledOnce());
    expect(getStatus).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#/settings/remote-access");
    expect(document.querySelector('[data-settings-panel="remote-access"].active')).not.toBeNull();
  });

  it("reloads a visible configuration tab when the runtime gateway becomes ready", async () => {
    window.location.hash = "#/settings/configuration";
    const call = vi.fn(async (operation) => {
      if (operation === "list_model_catalog") {
        return { ok: true, data: { providers: [], models: [] } };
      }
      if (operation === "list_provider_channels") {
        return { ok: true, data: { channels: [] } };
      }
      return { ok: true, data: { content: "{}", path: "zicode/config.json" } };
    });

    setupSettingsPanel({ configGateway: { call } });
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    const beforeReady = call.mock.calls.length;

    window.dispatchEvent(new CustomEvent("picot-config-gateway-ready"));

    await vi.waitFor(() => expect(call.mock.calls.length).toBeGreaterThan(beforeReady));
    expect(call.mock.calls.some(([operation]) => operation === "read_agent_config")).toBe(true);
    expect(call.mock.calls.some(([operation]) => operation === "read_models_config")).toBe(true);
  });

  it("labels the active scene and automatically loads an empty QVeris model catalog", async () => {
    window.location.hash = "#/settings/configuration";
    let synced = false;
    const call = vi.fn(async (operation) => {
      if (operation === "list_model_catalog") {
        return { ok: true, data: { providers: [] } };
      }
      if (operation === "list_provider_channels") {
        return {
          ok: true,
          data: {
            channels: [
              {
                provider: "qveris",
                builtIn: true,
                configured: true,
                baseUrl: "https://aigateway.qveris.ai/v1",
                api: "openai-completions",
                models: synced ? [{ id: "qveris-chat" }] : [],
              },
            ],
          },
        };
      }
      if (operation === "sync_qveris_models") {
        synced = true;
        return { ok: true, data: { modelSync: { count: 1 } } };
      }
      return { ok: true, data: { content: "{}", path: "zicode/config.json" } };
    });
    const settings = setupSettingsPanel({
      configGateway: { call },
      getTarget: () => ({ sceneId: "finance" }),
    });

    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith("sync_qveris_models", {}, { timeoutMs: 30_000 }),
    );
    expect(document.getElementById("configuration-scene-id").textContent).toBe("finance");

    settings.setTarget({ sceneId: "programming" });
    expect(document.getElementById("configuration-scene-name").textContent).toBe("Programming");
  });

  it("keeps unconfigured providers collapsed until searched or explicitly revealed", async () => {
    window.location.hash = "#/settings/configuration";
    const call = vi.fn(async (operation) => {
      if (operation === "list_model_catalog") {
        return {
          ok: true,
          data: {
            providers: [
              { provider: "configured", displayName: "Configured", configured: true, models: [] },
              { provider: "hidden", displayName: "Hidden Provider", configured: false, models: [] },
            ],
            models: [],
          },
        };
      }
      if (operation === "list_provider_channels") {
        return { ok: true, data: { channels: [] } };
      }
      return { ok: true, data: { content: "{}", path: "zicode/config.json" } };
    });

    setupSettingsPanel({ configGateway: { call } });
    await vi.waitFor(() =>
      expect(document.querySelector('[data-provider="hidden"]')).not.toBeNull(),
    );

    const hiddenRow = document.querySelector('[data-provider="hidden"]');
    expect(hiddenRow.classList.contains("hidden")).toBe(true);
    const search = document.getElementById("provider-auth-search");
    search.value = "Hidden";
    search.dispatchEvent(new Event("input"));
    expect(hiddenRow.classList.contains("hidden")).toBe(false);
  });
});

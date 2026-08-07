import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import {
  isSettingsHash,
  normalizeSettingsTabKey,
  settingsHashForTab,
  tabFromSettingsHash,
} from "./logic";
import { SettingsApp, type SettingsController } from "./SettingsPanelApp";
import { createSettingsStore, type SettingsStore } from "./store";

function controllerStub(): SettingsController {
  return {
    loadForTab: vi.fn(),
    wireVanilla: vi.fn(),
    reloadVisibleConfiguration: vi.fn(),
    setTarget: vi.fn(),
  };
}

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}

function renderApp(store: SettingsStore = createSettingsStore()) {
  const controller = controllerStub();
  const view = render(<SettingsApp store={store} controller={controller} />);
  return { store, controller, view };
}

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
});

describe("settings tab logic", () => {
  it("normalizes tab keys (auth alias, unknown fallback, encoded values)", () => {
    expect(normalizeSettingsTabKey("auth")).toBe("configuration");
    expect(normalizeSettingsTabKey("remote-access")).toBe("remote-access");
    expect(normalizeSettingsTabKey("nope")).toBe("general");
    expect(normalizeSettingsTabKey(undefined)).toBe("general");
    expect(normalizeSettingsTabKey(encodeURIComponent("configuration"))).toBe("configuration");
  });

  it("builds and parses settings hashes", () => {
    expect(settingsHashForTab("configuration")).toBe("#/settings/configuration");
    expect(isSettingsHash("#/settings/remote-access")).toBe(true);
    expect(isSettingsHash("#/settings")).toBe(true);
    expect(isSettingsHash("#/chat")).toBe(false);
    expect(tabFromSettingsHash("#/settings/")).toBe("general");
    expect(tabFromSettingsHash("#/settings/auth")).toBe("configuration");
  });
});

describe("settings store", () => {
  it("opens with hash update and closes clearing the hash", () => {
    const store = createSettingsStore();
    store.getState().openSettings("configuration");
    expect(store.getState().open).toBe(true);
    expect(store.getState().activeTab).toBe("configuration");
    expect(window.location.hash).toBe("#/settings/configuration");
    store.getState().closeSettings();
    expect(store.getState().open).toBe(false);
    expect(window.location.hash).toBe("");
  });

  it("loads versions on open", async () => {
    const loadVersions = vi.fn(async () => ({ piVersion: "v9", appVersion: "v1.2" }));
    const store = createSettingsStore({ loadVersions });
    store.getState().openSettings();
    await waitFor(() => expect(store.getState().piVersion).toBe("v9"));
    expect(store.getState().appVersion).toBe("v1.2");
  });

  it("delegates to the open handler when one is set", () => {
    const store = createSettingsStore();
    const handler = vi.fn();
    store.getState().setOpenHandler(handler);
    store.getState().openSettings("usage");
    expect(handler).toHaveBeenCalledWith("usage");
    expect(store.getState().open).toBe(false);
    store.getState().closeSettings();
    expect(handler).toHaveBeenCalledWith(null);
  });

  it("restores the active tab from the URL hash", () => {
    history.replaceState(history.state, "", "/app#/settings/remote-access");
    const store = createSettingsStore();
    store.getState().restoreFromHash();
    expect(store.getState().open).toBe(true);
    expect(store.getState().activeTab).toBe("remote-access");
  });
});

describe("settings React panel", () => {
  it("opens the panel and switches tabs", () => {
    const store = createSettingsStore();
    renderApp(store);
    const panel = document.getElementById("settings-panel");
    expect(panel).toBeTruthy();
    expect(panel?.classList.contains("hidden")).toBe(true);

    act(() => store.getState().openSettings());
    expect(panel?.classList.contains("hidden")).toBe(false);
    expect(
      document.querySelector('[data-settings-panel="general"]')?.classList.contains("active"),
    ).toBe(true);

    fireEvent.click(required('[data-settings-tab="configuration"]'));
    expect(
      document.querySelector('[data-settings-panel="configuration"]')?.classList.contains(
        "active",
      ),
    ).toBe(true);
    expect(
      document.querySelector('[data-settings-panel="general"]')?.classList.contains("active"),
    ).toBe(false);
    expect(store.getState().activeTab).toBe("configuration");
  });

  it("keeps all vanilla sub-panel mount points and widget ids in the DOM", () => {
    renderApp();
    const expectedIds = [
      "theme-select",
      "language-select",
      "toggle-auto-compact",
      "thinking-effort",
      "thinking-effort-name",
      "toggle-show-thinking",
      "toggle-mobile-task-notifications",
      "mobile-draft-storage-row",
      "scene-profile-select",
      "scene-profile-editor",
      "setting-pi-version-value",
      "setting-app-version-value",
      "btn-check-updates",
      "toggle-beta-updates",
      "pkg-browse-search",
      "pkg-browse-list",
      "settings-cost-dashboard",
      "settings-api-keys",
      "provider-channel-list",
      "provider-channel-editor",
      "inline-config-textarea",
      "inline-models-textarea",
      "settings-remote-access",
    ];
    for (const id of expectedIds) {
      expect(document.getElementById(id), `missing #${id}`).toBeTruthy();
    }
    expect(document.querySelector("chat-settings-panel")).toBeTruthy();
  });

  it("lazy-loads the active tab through the controller when opened", () => {
    const store = createSettingsStore();
    const { controller } = renderApp(store);
    act(() => store.getState().openSettings());
    fireEvent.click(required('[data-settings-tab="usage"]'));
    expect(controller.loadForTab).toHaveBeenCalledWith("usage");
  });

  it("stays hidden when embedded so plugin-shell owns the layout", () => {
    const store = createSettingsStore();
    renderApp(store);
    act(() => store.getState().setEmbedded(true));
    expect(document.querySelector(".settings-panel")).toBe(null);
  });
});

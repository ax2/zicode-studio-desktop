import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { t } from "../../shared/i18n";
import {
  isSettingsHash,
  normalizeSettingsTabKey,
  settingsHashForTab,
  tabFromSettingsHash,
} from "./logic";
import { createConfigStore } from "./configStore";
import { createCostDashboardStore } from "./costDashboardStore";
import { createPackageBrowseStore } from "./packageBrowseStore";
import { createRemoteAccessStore } from "./remoteAccessStore";
import { createBackupStore } from "./backupStore";
import { createMemoryStore } from "./memoryStore";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";
import { SettingsApp, type SettingsController } from "./SettingsPanelApp";
import { createSettingsStore, type SettingsStore } from "./store";

function controllerStub(): SettingsController {
  return {
    configStore: createConfigStore({
      configGateway: { call: async () => ({ ok: false, error: "unavailable" }) },
      confirmImpl: () => false,
    }),
    memoryStore: createMemoryStore({
      call: async () => ({ ok: false, error: "unavailable" }),
    }),
    remoteAccessStore: createRemoteAccessStore(null),
    backupStore: createBackupStore({ getWorkspaceId: () => "workspace-a" }),
    costDashboardStore: createCostDashboardStore(),
    packageBrowseStore: createPackageBrowseStore({ control: null }),
    widgetsStore: createSettingsWidgetsStore(),
    getWorkspaceId: () => "workspace-a",
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

describe("memory section", () => {
  it("renders export and import actions", async () => {
    renderApp();
    await waitFor(() =>
      expect(document.getElementById("memory-section")).toBeTruthy(),
    );
    const actions = document.querySelector(".memory-actions");
    expect(actions).toBeTruthy();
    const labels = Array.from(actions?.querySelectorAll("button") ?? []).map(
      (button) => button.textContent?.trim(),
    );
    expect(labels).toContain(t("Export memory"));
    expect(labels).toContain(t("Import memory"));
    expect(document.querySelector(".memory-file-input")).toBeTruthy();
  });
});

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
      "setting-pi-version-value",
      "setting-app-version-value",
      "btn-check-updates",
      "toggle-beta-updates",
      "pkg-browse-search",
      "pkg-browse-list",
      "settings-api-keys",
      "provider-channel-list",
      "inline-config-textarea",
      "inline-models-textarea",
      "settings-remote-access",
    ];
    for (const id of expectedIds) {
      expect(document.getElementById(id), `missing #${id}`).toBeTruthy();
    }
    expect(document.querySelector("chat-settings-panel")).toBeTruthy();
  });

  it("opens the project homepage from the update button when auto-updates are unconfigured", () => {
    renderApp();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    fireEvent.click(required("#btn-check-updates"));
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement | undefined;
    expect(anchor).toBeTruthy();
    expect(anchor?.href).toBe(
      "https://github.com/ax2/zicode-studio-desktop",
    );
    expect(anchor?.target).toBe("_blank");
    clickSpy.mockRestore();
  });

  it("lazy-loads the active tab through the controller when opened", () => {
    const store = createSettingsStore();
    const { controller } = renderApp(store);
    act(() => store.getState().openSettings());
    fireEvent.click(required('[data-settings-tab="usage"]'));
    expect(controller.loadForTab).toHaveBeenCalledWith("usage");
  });

  it("exports a session backup from the general tab", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ backup: { workspaceId: "workspace-a", sessions: [] } }),
    } as Response);
    const createObjectUrl = vi.fn(() => "blob:session-backup");
    const revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      const store = createSettingsStore();
      renderApp(store);
      act(() => store.getState().openSettings());
      const button = required<HTMLButtonElement>("#export-sessions");
      expect(button).toBeTruthy();
      fireEvent.click(button);
      await waitFor(() =>
        expect(
          document.querySelector("#session-export-status")?.textContent,
        ).toContain(t("Session backup exported")),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "/v2/sessions/export?workspaceId=workspace-a",
      );
      expect(createObjectUrl).toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      vi.unstubAllGlobals();
      clickSpy.mockRestore();
    }
  });

  it("imports a session backup from the general tab", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        imported: ["session-a"],
        skipped: ["session-b"],
        errors: [],
      }),
    } as Response);
    try {
      const store = createSettingsStore();
      renderApp(store);
      act(() => store.getState().openSettings());
      const input = required<HTMLInputElement>("#import-sessions-input");
      const file = new File(
        [
          JSON.stringify({
            workspaceId: "workspace-a",
            sessions: [
              {
                sessionId: "session-a",
                projectPath: "/workspace",
                content: '{"type":"session","id":"session-a"}',
              },
            ],
          }),
        ],
        "backup.json",
        { type: "application/json" },
      );
      fireEvent.change(input, { target: { files: [file] } });
      const expected = t("Imported {imported}, skipped {skipped}")
        .replace("{imported}", "1")
        .replace("{skipped}", "1");
      await waitFor(() =>
        expect(
          document.querySelector("#session-import-status")?.textContent,
        ).toContain(expected),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "/v2/sessions/import",
        expect.objectContaining({ method: "POST" }),
      );
      const importCall = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes("/v2/sessions/import"),
      );
      expect(importCall).toBeTruthy();
      const body = JSON.parse(
        String((importCall?.[1] as RequestInit).body),
      );
      expect(body.sessions[0].sessionId).toBe("session-a");
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("stays hidden when embedded so plugin-shell owns the layout", () => {
    const store = createSettingsStore();
    renderApp(store);
    act(() => store.getState().setEmbedded(true));
    expect(document.querySelector(".settings-panel")).toBe(null);
  });
});

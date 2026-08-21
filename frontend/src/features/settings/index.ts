import { createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { createConfigStore, type ConfigGatewayLike } from "./configStore";
import { createMemoryStore } from "./memoryStore";
import { createCostDashboardStore, type CostDashboardData } from "./costDashboardStore";
import { createBackupStore } from "./backupStore";
import type { SettingsTabKey } from "./logic";
import { createRemoteAccessStore, type RemoteAccessGateway } from "./remoteAccessStore";
import {
  createPackageBrowseStore,
  type HostControlGatewayLike,
} from "./packageBrowseStore";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";
import {
  SettingsApp,
  SettingsContent,
  SettingsNav,
  type SettingsController,
} from "./SettingsPanelApp";
import { createSettingsStore, type SettingsStore } from "./store";
import { CHECK_INTERVAL_MS, useAppUpdaterStore } from "./updaterStore";

export interface SettingsPanelOptions {
  data?: unknown;
  getWorkspaceId?: () => string | undefined;
  control?: unknown;
  remoteAccessGateway?: unknown;
  configGateway?: unknown;
  onModelConfigurationChanged?: unknown;
  runtime?: unknown;
  getTarget?: () => unknown;
  onError?: (error: unknown) => void;
  notify?: (message: unknown) => void;
}

export interface SettingsPanelHandle {
  openSettings(tabKey?: string, opts?: { updateHash?: boolean }): void;
  closeSettings(opts?: { clearHash?: boolean }): void;
  getActiveTab(): SettingsTabKey;
  setOpenHandler(handler: ((tab: SettingsTabKey | null) => void) | null): void;
  renderNavigation(container: HTMLElement | null | undefined): void;
  renderContent(container: HTMLElement | null | undefined): void;
  deactivate(): void;
  thinkingControl: { updateUI(level: string): void };
  setTarget(target: unknown): void;
  selectScene(id: string): void;
}

export function setupSettingsPanel(options: SettingsPanelOptions = {}): SettingsPanelHandle {
  const getTarget = options.getTarget ?? (() => null);
  const store: SettingsStore = createSettingsStore();
  const configStore = createConfigStore({
    configGateway:
      (options.configGateway as ConfigGatewayLike | undefined) ??
      ({
        call: async () => ({ ok: false, error: "Configuration gateway unavailable." }),
      } as ConfigGatewayLike),
    getTarget: getTarget as () => { sceneId?: string } | null,
    onModelConfigurationChanged: options.onModelConfigurationChanged as
      | (() => void | Promise<void>)
      | undefined,
    invoke: (globalThis as {
      __TAURI__?: { core?: { invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown> } };
    }).__TAURI__?.core?.invoke,
  });
  const memoryStore = createMemoryStore(
    (options.configGateway as ConfigGatewayLike | undefined) ??
      ({
        call: async () => ({ ok: false, error: "Configuration gateway unavailable." }),
      } as ConfigGatewayLike),
  );
  const remoteAccessStore = createRemoteAccessStore(
    (options.remoteAccessGateway as RemoteAccessGateway | null | undefined) ?? null,
  );
  const backupStore = createBackupStore({
    invoke: (globalThis as {
      __TAURI__?: {
        core?: {
          invoke?: (
            command: string,
            params?: Record<string, unknown>,
          ) => Promise<unknown>;
        };
      };
    }).__TAURI__?.core?.invoke,
    getWorkspaceId: options.getWorkspaceId,
  });
  const costDashboardStore = createCostDashboardStore();
  const packageBrowseStore = createPackageBrowseStore({
    control: (options.control as HostControlGatewayLike | null | undefined) ?? null,
    notify: options.notify as
      | ((message: { type: string; title: string; message: string; detail?: string }) => void)
      | undefined,
  });
  const widgetsStore = createSettingsWidgetsStore({
    runtime: options.runtime as
      | {
          request(
            operation: { type: string; level: string },
            target: unknown,
            options?: { idempotencyKey?: string },
          ): Promise<unknown>;
        }
      | undefined,
    getTarget: getTarget as () => { sceneId?: string } | null,
    invoke: (globalThis as {
      __TAURI__?: { core?: { invoke?: (command: string, params?: Record<string, unknown>) => Promise<unknown> } };
    }).__TAURI__?.core?.invoke,
    onError: options.onError,
  });

  const rootElement = document.getElementById("settings-root");
  let panelRoot: Root | null = null;
  let navRoot: Root | null = null;
  let contentRoot: Root | null = null;
  let embeddedActive = false;

  const controller: SettingsController = {
    configStore,
    memoryStore,
    remoteAccessStore,
    backupStore,
    costDashboardStore,
    packageBrowseStore,
    widgetsStore,
    getWorkspaceId: options.getWorkspaceId,
    getSceneId: () =>
      (getTarget() as { sceneId?: string } | null)?.sceneId ?? "programming",
    wireVanilla() {},
    loadForTab(tab) {
      if (tab === "general") {
        void widgetsStore.getState().loadSceneProfiles();
        void backupStore.getState().load();
        void memoryStore.getState().load();
      } else if (tab === "usage") {
        if (options.data && options.getWorkspaceId) {
          void costDashboardStore
            .getState()
            .load(options.data as CostDashboardData, options.getWorkspaceId);
        }
      } else if (tab === "extensions") {
        void packageBrowseStore.getState().load();
      } else if (tab === "configuration") {
        void configStore.getState().loadAll();
      } else if (tab === "remote-access") {
        void remoteAccessStore.getState().load();
      }
    },
    reloadVisibleConfiguration() {
      const state = store.getState();
      if (state.activeTab !== "configuration") return;
      if (!embeddedActive && !state.open) return;
      controller.loadForTab("configuration");
    },
    setTarget(target) {
      widgetsStore.getState().setTarget(target as { sceneId?: string } | null);
      configStore.getState().setTarget(target as { sceneId?: string } | null);
      controller.reloadVisibleConfiguration();
    },
  };

  if (rootElement) {
    panelRoot = createRoot(rootElement);
    flushSync(() => {
      panelRoot?.render(createElement(SettingsApp, { store, controller }));
    });
  }

  store.getState().restoreFromHash();

  // plugin-shell clears and rebuilds the sidebar/main containers on every
  // activation (replaceChildren). Mount each React tree inside a wrapper so a
  // cleared container never leaves React's root referencing destroyed nodes.
  function mountNavRoot(container: HTMLElement, element: ReactNode) {
    if (navRoot) {
      navRoot.unmount();
      navRoot = null;
    }
    container.querySelector('[data-settings-root="nav"]')?.remove();
    const wrapper = document.createElement("div");
    wrapper.dataset.settingsRoot = "nav";
    container.append(wrapper);
    navRoot = createRoot(wrapper);
    navRoot.render(element);
  }

  function mountContentRoot(container: HTMLElement, element: ReactNode) {
    if (contentRoot) {
      contentRoot.unmount();
      contentRoot = null;
    }
    container.querySelector('[data-settings-root="content"]')?.remove();
    const wrapper = document.createElement("div");
    wrapper.dataset.settingsRoot = "content";
    container.append(wrapper);
    contentRoot = createRoot(wrapper);
    contentRoot.render(element);
  }

  return {
    openSettings: (tabKey = "general", opts) => store.getState().openSettings(tabKey, opts),
    closeSettings: (opts) => store.getState().closeSettings(opts),
    getActiveTab: () => store.getState().activeTab,
    setOpenHandler(handler) {
      store.getState().setOpenHandler(handler);
    },
    renderNavigation(container) {
      if (!container) return;
      embeddedActive = true;
      store.getState().setEmbedded(true);
      store.getState().hide();
      mountNavRoot(container, createElement(SettingsNav, { store }));
    },
    renderContent(container) {
      if (!container) return;
      embeddedActive = true;
      store.getState().setEmbedded(true);
      store.getState().hide();
      mountContentRoot(container, createElement(SettingsContent, { store, controller }));
      controller.loadForTab(store.getState().activeTab);
      void store.getState().loadVersions();
    },
    deactivate() {
      embeddedActive = false;
      store.getState().setEmbedded(false);
      navRoot?.unmount();
      navRoot = null;
      contentRoot?.unmount();
      contentRoot = null;
    },
    thinkingControl: {
      updateUI(level: string) {
        widgetsStore.getState().updateThinkingUI(level);
      },
    },
    setTarget(target) {
      controller.setTarget(target);
    },
    selectScene(id) {
      widgetsStore.getState().setSceneSelected(id);
    },
  };
}

export interface AppUpdaterHandle {
  checkNow(options?: { silent?: boolean }): Promise<unknown>;
  installUpdate(): Promise<void>;
}

export function setupAppUpdater({
  logger = console,
  enabled = false,
  settingsPanel: _settingsPanel = null,
}: {
  logger?: { warn?: (..._args: unknown[]) => void };
  enabled?: boolean;
  settingsPanel?: { openSettings?: (tab?: string) => void } | null;
} = {}): AppUpdaterHandle {
  useAppUpdaterStore.getState().configure(enabled, logger);

  const statusEl = document.getElementById("setting-update-status");
  const checkBtn = document.getElementById(
    "btn-check-updates",
  ) as HTMLButtonElement | null;
  const sidebarBtn = document.getElementById(
    "sidebar-update-btn",
  ) as HTMLButtonElement | null;

  function syncDom() {
    const state = useAppUpdaterStore.getState();
    if (statusEl) statusEl.textContent = state.status || "Click to check";
    if (checkBtn) {
      checkBtn.textContent = state.button || "Check now";
      checkBtn.disabled = state.disabled;
      checkBtn.dataset.mode = state.canInstall ? "install" : "check";
      checkBtn.setAttribute("aria-disabled", state.disabled ? "true" : "false");
      checkBtn.setAttribute("aria-busy", state.disabled ? "true" : "false");
    }
    if (sidebarBtn) sidebarBtn.classList.toggle("hidden", !state.sidebarVisible);
  }

  useAppUpdaterStore.subscribe(syncDom);
  syncDom();

  if (enabled) {
    sidebarBtn?.addEventListener("click", () => {
      void useAppUpdaterStore.getState().installUpdate();
    });

    let silentTimer: ReturnType<typeof setInterval> | null = null;
    function scheduleSilentChecks() {
      if (silentTimer) clearInterval(silentTimer);
      silentTimer = setInterval(() => {
        const state = useAppUpdaterStore.getState();
        if (Date.now() - state.lastCheckMs >= CHECK_INTERVAL_MS) {
          void state.checkNow({ silent: true });
        }
      }, CHECK_INTERVAL_MS);
    }

    window.addEventListener("picot-update-channel-changed", () => {
      useAppUpdaterStore.getState().showIdle();
      void useAppUpdaterStore.getState().checkNow({ silent: true });
    });

    scheduleSilentChecks();
    void useAppUpdaterStore.getState().checkNow({ silent: true });
  }

  return {
    checkNow: (options) => useAppUpdaterStore.getState().checkNow(options),
    installUpdate: () => useAppUpdaterStore.getState().installUpdate(),
  };
}

export { createSettingsStore } from "./store";
export {
  SETTINGS_TABS,
  isSettingsHash,
  normalizeSettingsTabKey,
  settingsHashForTab,
  tabFromSettingsHash,
} from "./logic";
export {
  fallbackSceneProfiles,
  getSelectedSceneId,
  normalizeSceneId,
  persistSelectedScene,
} from "./sceneProfiles";

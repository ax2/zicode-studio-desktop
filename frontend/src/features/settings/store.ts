import { create } from "zustand";
import {
  isSettingsHash,
  normalizeSettingsTabKey,
  settingsHashForTab,
  tabFromSettingsHash,
  type SettingsTabKey,
} from "./logic";

export interface SettingsStoreOptions {
  getHash?: () => string;
  replaceState?: (url: string) => void;
  loadVersions?: () => Promise<{ piVersion: string; appVersion: string }>;
}

interface SettingsState {
  open: boolean;
  activeTab: SettingsTabKey;
  embedded: boolean;
  piVersion: string;
  appVersion: string;
  openHandler: ((tab: SettingsTabKey | null) => void) | null;
  openSettings(tabKey?: string, opts?: { updateHash?: boolean }): void;
  closeSettings(opts?: { clearHash?: boolean }): void;
  selectTab(tabKey: string): void;
  navigateTab(tabKey: string): void;
  hide(): void;
  setEmbedded(embedded: boolean): void;
  setOpenHandler(handler: ((tab: SettingsTabKey | null) => void) | null): void;
  setVersions(piVersion: string, appVersion: string): void;
  loadVersions(): Promise<void>;
  restoreFromHash(): void;
}

async function defaultLoadVersions(): Promise<{ piVersion: string; appVersion: string }> {
  let piVersion = "Unavailable";
  try {
    const response = await fetch("/health");
    const health = (await response.json()) as { piVersion?: string };
    piVersion = health?.piVersion || "Unavailable";
  } catch {
    // Host unreachable; keep the fallback text.
  }
  let appVersion = "Unavailable";
  try {
    const tauri = (globalThis as { __TAURI__?: { app?: { getVersion?: () => Promise<string> } } })
      .__TAURI__;
    const version = await tauri?.app?.getVersion?.();
    appVersion = version ? `v${version}` : "Unavailable";
  } catch {
    // Not running inside Tauri.
  }
  return { piVersion, appVersion };
}

export function createSettingsStore(options: SettingsStoreOptions = {}) {
  const getHash = options.getHash ?? (() => window.location.hash);
  const replaceState =
    options.replaceState ??
    ((url: string) => {
      history.replaceState(history.state, "", url);
    });
  const loadVersions = options.loadVersions ?? defaultLoadVersions;

  return create<SettingsState>()((set, get) => ({
    open: false,
    activeTab: "general",
    embedded: false,
    piVersion: "Loading...",
    appVersion: "Loading...",
    openHandler: null,

    openSettings(tabKey = "general", { updateHash = true } = {}) {
      const tab = normalizeSettingsTabKey(tabKey);
      if (updateHash) {
        const next = settingsHashForTab(tab);
        if (getHash() !== next) {
          replaceState(`${window.location.pathname}${window.location.search}${next}`);
        }
      }
      set({ activeTab: tab });
      const { openHandler } = get();
      if (openHandler) {
        openHandler(tab);
        return;
      }
      set({ open: true });
      void get().loadVersions();
    },

    closeSettings({ clearHash = true } = {}) {
      if (clearHash && isSettingsHash(getHash())) {
        replaceState(`${window.location.pathname}${window.location.search}`);
      }
      const { openHandler } = get();
      if (openHandler) {
        openHandler(null);
        return;
      }
      set({ open: false });
    },

    selectTab(tabKey) {
      set({ activeTab: normalizeSettingsTabKey(tabKey) });
    },

    navigateTab(tabKey) {
      const tab = normalizeSettingsTabKey(tabKey);
      const next = settingsHashForTab(tab);
      if (getHash() !== next) {
        replaceState(`${window.location.pathname}${window.location.search}${next}`);
      }
      set({ activeTab: tab });
    },

    hide() {
      set({ open: false });
    },

    setEmbedded(embedded) {
      set({ embedded });
    },

    setOpenHandler(handler) {
      set({ openHandler: typeof handler === "function" ? handler : null });
      const next = get().openHandler;
      if (!next) return;
      set({ open: false });
      if (isSettingsHash(getHash())) {
        next(tabFromSettingsHash(getHash()));
      }
    },

    setVersions(piVersion, appVersion) {
      set({ piVersion, appVersion });
    },

    async loadVersions() {
      const versions = await loadVersions();
      set({ piVersion: versions.piVersion, appVersion: versions.appVersion });
    },

    restoreFromHash() {
      if (isSettingsHash(getHash())) {
        get().openSettings(tabFromSettingsHash(getHash()), { updateHash: false });
        return;
      }
      if (get().embedded || get().open) {
        get().closeSettings({ clearHash: false });
      }
    },
  }));
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

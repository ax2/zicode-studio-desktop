import { create } from "zustand";

export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const BETA_SETTINGS_KEY = "picot-settings-beta-updates";

export interface UpdateInfo {
  version?: string;
  downloadAndInstall?: (
    handler?: (event: unknown) => void,
  ) => Promise<unknown>;
}

export interface UpdateProgressEvent {
  event?: string;
  data?: { contentLength?: number; chunkLength?: number };
}

type TauriUpdater = {
  process?: { relaunch?: () => Promise<unknown> };
  updater?: { check?: () => Promise<unknown> };
  core?: { invoke?: (..._args: unknown[]) => Promise<unknown> };
};

type TauriGlobal = {
  __TAURI__?: TauriUpdater;
};

export interface AppUpdaterState {
  enabled: boolean;
  update: UpdateInfo | null;
  status: string;
  button: string;
  disabled: boolean;
  canInstall: boolean;
  sidebarVisible: boolean;
  checking: boolean;
  installing: boolean;
  totalBytes: number;
  downloadedBytes: number;
  lastCheckMs: number;
  logger: { warn?: (..._args: unknown[]) => void };
  configure(
    enabled: boolean,
    logger?: { warn?: (..._args: unknown[]) => void },
  ): void;
  showIdle(): void;
  showAvailable(nextUpdate: UpdateInfo | null | undefined): void;
  checkNow(options?: { silent?: boolean }): Promise<unknown>;
  installUpdate(): Promise<void>;
  formatProgress(): string;
}

export function betaUpdatesEnabled(): boolean {
  try {
    return localStorage.getItem(BETA_SETTINGS_KEY) === "true";
  } catch {
    return false;
  }
}

export const useAppUpdaterStore = create<AppUpdaterState>()((set, get) => ({
  enabled: false,
  update: null,
  status: "",
  button: "",
  disabled: false,
  canInstall: false,
  sidebarVisible: false,
  checking: false,
  installing: false,
  totalBytes: 0,
  downloadedBytes: 0,
  lastCheckMs: 0,
  logger: console,
  configure(enabled, logger = console) {
    set({
      enabled,
      logger,
      update: null,
      checking: false,
      installing: false,
      totalBytes: 0,
      downloadedBytes: 0,
    });
    if (!enabled) {
      set({
        status: "Automatic updates are not configured",
        button: "Use GitHub Releases",
        disabled: true,
        canInstall: false,
        sidebarVisible: false,
      });
      return;
    }
    get().showIdle();
  },
  showIdle() {
    set({
      status: "Click to check",
      button: "Check now",
      disabled: false,
      canInstall: false,
      sidebarVisible: false,
    });
  },
  showAvailable(nextUpdate) {
    const version = nextUpdate?.version ? `v${nextUpdate.version}` : "Update";
    set({
      update: nextUpdate,
      status: `${version} available`,
      button: "Download & install",
      disabled: false,
      canInstall: true,
      sidebarVisible: true,
    });
  },
  async checkNow({ silent = false } = {}) {
    const state = get();
    if (state.checking || state.installing) return state.update;
    set({ checking: true, lastCheckMs: Date.now() });
    if (!silent) {
      set({ status: "Checking…", button: "Checking…", disabled: true });
    }
    try {
      const tauri = (globalThis as unknown as TauriGlobal).__TAURI__;
      const beta = betaUpdatesEnabled();
      let result: unknown = null;
      if (beta) {
        const invoke = tauri?.core?.invoke;
        if (typeof invoke !== "function") {
          throw new Error("Tauri core API is unavailable");
        }
        result = await invoke("check_beta_update");
      } else {
        const check = tauri?.updater?.check;
        if (typeof check === "function") result = await check();
      }
      const update = result
        ? beta
          ? {
              ...(result as UpdateInfo),
              downloadAndInstall: () => get().installUpdate(),
            }
          : (result as UpdateInfo)
        : null;
      if (update) {
        get().showAvailable(update);
      } else {
        set({
          status: "Up to date",
          button: "Check now",
          disabled: false,
          canInstall: false,
          sidebarVisible: false,
        });
      }
      return update;
    } catch (error) {
      if (!silent) {
        set({ status: "Check failed", button: "Check now", disabled: false });
      }
      get().logger.warn?.("[Updater] Check failed:", error);
      return null;
    } finally {
      set({ checking: false });
    }
  },
  formatProgress() {
    const { totalBytes, downloadedBytes } = get();
    if (!totalBytes) return "Downloading…";
    const percent = Math.min(
      99,
      Math.floor((downloadedBytes / totalBytes) * 100),
    );
    return `Downloading ${percent}%…`;
  },
  async installUpdate() {
    const state = get();
    if (state.installing) return;
    if (!state.update) {
      await get().checkNow();
      if (!get().update) return;
    }

    set({
      installing: true,
      totalBytes: 0,
      downloadedBytes: 0,
      sidebarVisible: false,
      status: "Preparing download…",
      button: "Installing…",
      disabled: true,
    });

    try {
      const tauri = (globalThis as unknown as TauriGlobal).__TAURI__;
      const beta = betaUpdatesEnabled();
      if (beta) {
        const invoke = tauri?.core?.invoke;
        if (typeof invoke !== "function") {
          throw new Error("Tauri core API is unavailable");
        }
        await invoke("install_beta_update");
      } else {
        const update = get().update;
        if (typeof update?.downloadAndInstall !== "function") {
          throw new Error("Updater API is unavailable");
        }
        await update.downloadAndInstall(
          (rawEvent: unknown) => {
            const event = rawEvent as UpdateProgressEvent;
            if (event?.event === "Started") {
              set({
                totalBytes: event.data?.contentLength || 0,
                downloadedBytes: 0,
                status: get().formatProgress(),
                button: "Installing…",
                disabled: true,
              });
            } else if (event?.event === "Progress") {
              set({
                downloadedBytes:
                  get().downloadedBytes + (event.data?.chunkLength || 0),
                status: get().formatProgress(),
                button: "Installing…",
                disabled: true,
              });
            } else if (event?.event === "Finished") {
              set({
                status: "Installing…",
                button: "Installing…",
                disabled: true,
              });
            }
          },
        );
      }
      set({
        status: "Installed. Relaunching…",
        button: "Relaunching…",
        disabled: true,
      });
      const relaunch = tauri?.process?.relaunch;
      if (typeof relaunch !== "function") {
        throw new Error("Tauri process plugin is unavailable");
      }
      await relaunch();
    } catch (error) {
      get().logger.warn?.("[Updater] Install failed:", error);
      set({
        status: "Install failed",
        button: "Try again",
        disabled: false,
        canInstall: true,
        sidebarVisible: true,
      });
    } finally {
      set({ installing: false });
    }
  },
}));

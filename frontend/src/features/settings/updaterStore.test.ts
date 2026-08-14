import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { useAppUpdaterStore } from "./updaterStore";

function resetStore() {
  useAppUpdaterStore.setState({
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
  });
}

describe("app updater store", () => {
  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    Reflect.deleteProperty(globalThis, "__TAURI__");
    resetStore();
  });

  it("discovers an update through the mocked Tauri updater", async () => {
    const downloadAndInstall = vi.fn(async () => undefined);
    (globalThis as unknown as { __TAURI__?: unknown }).__TAURI__ = {
      process: { relaunch: vi.fn(async () => undefined) },
      updater: {
        check: vi.fn(async () => ({ version: "9.9.9", downloadAndInstall })),
      },
    };

    useAppUpdaterStore.getState().configure(true);
    const update = await useAppUpdaterStore.getState().checkNow({ silent: true });

    expect(update).toEqual(expect.objectContaining({ version: "9.9.9" }));
    expect(useAppUpdaterStore.getState().sidebarVisible).toBe(true);
    expect(useAppUpdaterStore.getState().status).toContain("available");
    expect(useAppUpdaterStore.getState().button).toBe("Download & install");
  });

  it("marks the update row as unconfigured when updates are disabled", () => {
    useAppUpdaterStore.getState().configure(false);

    const state = useAppUpdaterStore.getState();
    expect(state.status).toContain("not configured");
    expect(state.disabled).toBe(false);
    expect(state.sidebarVisible).toBe(false);
  });

  it("localizes the updater status and button for the active locale", () => {
    setLocale("zh-CN");
    useAppUpdaterStore.getState().configure(false);

    expect(useAppUpdaterStore.getState().status).toBe("自动更新尚未配置");
    expect(useAppUpdaterStore.getState().button).toBe("使用 GitHub Releases");
  });
});

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

describe("native desktop updater bridge", () => {
  beforeEach(() => { vi.unstubAllGlobals(); setLocale("en"); localStorage.clear(); Reflect.deleteProperty(globalThis, "__TAURI__"); resetStore(); });

it("reports an unavailable updater rather than claiming the app is up to date", async () => {
  const logger = { warn: vi.fn() };
  useAppUpdaterStore.getState().configure(true, logger);
  await useAppUpdaterStore.getState().checkNow();
  expect(useAppUpdaterStore.getState().status).toBe("Update check unavailable");
  expect(useAppUpdaterStore.getState().canInstall).toBe(false);
});
it("uses the native desktop bridge when plugin JavaScript is absent and pins the reviewed version", async () => {
  const invoke = vi.fn(async (command: string) => command === "check_desktop_update" ? { version: "0.5.4", body: "Changes" } : undefined);
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  useAppUpdaterStore.getState().configure(true);
  await useAppUpdaterStore.getState().checkNow();
  await useAppUpdaterStore.getState().installUpdate();
  expect(invoke.mock.calls).toEqual([
    ["check_desktop_update", { beta: false }],
    ["install_desktop_update", { expectedVersion: "0.5.4", beta: false }],
    ["restart_desktop_after_update"],
  ]);
  vi.unstubAllGlobals();
});
it("forgets a previously checked version when the update channel changes", async () => {
  useAppUpdaterStore.getState().showAvailable({ version: "0.5.4" });
  useAppUpdaterStore.getState().showIdle();
  expect(useAppUpdaterStore.getState().update).toBeNull();
});

});

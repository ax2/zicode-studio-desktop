import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { useAppUpdaterStore } from "./updaterStore";

const state = () => useAppUpdaterStore.getState();
const release = { version: "1.2.3", body: "Release notes", fullInstaller: true };

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  state().configure(true, { warn: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

it("downloads the reviewed release and waits for an explicit second click before exit", async () => {
  const invoke = vi.fn(async (command: string) => command === "check_desktop_update" ? release : undefined);
  const unlisten = vi.fn();
  vi.stubGlobal("__TAURI__", { core: { invoke }, event: { listen: async () => unlisten } });
  await state().installUpdate();
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["check_desktop_update", "install_desktop_update"]);
  expect(invoke).toHaveBeenCalledWith("install_desktop_update", { beta: false, expectedVersion: "1.2.3" });
  expect(state()).toMatchObject({ installerReady: true, disabled: false, button: "Install and exit", status: "Installer verified" });
  expect(unlisten).toHaveBeenCalledOnce();
  await state().checkNow({ silent: true });
  expect(state().installerReady).toBe(true);
  await state().installUpdate();
  expect(invoke.mock.lastCall).toEqual(["restart_desktop_after_update"]);
  expect(state().status).toBe("Closing Studio to install…");
});

it("can discard a verified installer and download again without exiting Studio", async () => {
  const invoke = vi.fn(async (command: string) => command === "check_desktop_update" ? release : undefined);
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  await state().installUpdate();
  await state().cancelDownload();
  expect(state()).toMatchObject({ installerReady: false, installing: false, disabled: false, button: "Download update" });
  await state().installUpdate();
  expect(invoke.mock.calls.map(([name]) => name)).toEqual(["check_desktop_update", "install_desktop_update", "cancel_desktop_update", "install_desktop_update"]);
});

it("reports progress, allows cancellation and retries the same reviewed release", async () => {
  let abort!: (error: Error) => void;
  let progress!: (event: {payload: {phase: string; downloaded: number; total: number}}) => void;
  let attempts = 0;
  const invoke = vi.fn(async (command: string) => {
    if (command === "check_desktop_update") return release;
    if (command === "cancel_desktop_update") abort(new Error("UPDATE_CANCELLED"));
    if (command === "install_desktop_update" && ++attempts === 1) {
      progress({ payload: { phase: "downloading", downloaded: 25, total: 100 } });
      await new Promise((_, reject) => { abort = reject; });
    }
  });
  vi.stubGlobal("__TAURI__", { core: { invoke }, event: { listen: async (_name: string, callback: typeof progress) => {
    progress = callback;
    return () => {};
  } } });
  await state().checkNow();
  const pending = state().installUpdate();
  await vi.waitFor(() => expect(state().status).toBe("Downloading 25%…"));
  await state().cancelDownload();
  await pending;
  expect(state()).toMatchObject({ status: "Download cancelled", canCancel: false, installerReady: false, canInstall: true });
  await state().installUpdate();
  expect(state().installerReady).toBe(true);
  expect(invoke).not.toHaveBeenCalledWith("restart_desktop_after_update");
});

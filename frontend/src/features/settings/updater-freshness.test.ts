import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "../../shared/i18n";
import { BETA_SETTINGS_KEY, useAppUpdaterStore } from "./updaterStore";

const state = () => useAppUpdaterStore.getState();
beforeEach(() => {
  setLocale("en"); localStorage.clear();
  useAppUpdaterStore.setState({ checking: false, installing: false });
  state().configure(true, { warn: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); state().configure(false); });

it("never contacts a feed or installs when automatic updates are disabled", async () => {
  const invoke = vi.fn(); vi.stubGlobal("__TAURI__", { core: { invoke } });
  state().configure(false);
  await state().checkNow(); await state().installUpdate();
  expect(invoke).not.toHaveBeenCalled();
  expect(state().status).toBe("Automatic updates are not configured");
});

it("clears the previously offered version and its notes when a check finds no update", async () => {
  vi.stubGlobal("__TAURI__", { updater: { check: vi.fn(async () => null) } });
  state().showAvailable({ version: "0.6.5", body: "Obsolete notes" });
  await state().checkNow();
  expect(state()).toMatchObject({ update: null, canInstall: false, sidebarVisible: false, status: "Up to date" });
});

it("clears stale install eligibility and notes after a silent failed check", async () => {
  vi.stubGlobal("__TAURI__", { updater: { check: vi.fn(async () => { throw new Error("Offline"); }) } });
  state().showAvailable({ version: "0.6.5", body: "Obsolete notes" });
  await state().checkNow({ silent: true });
  expect(state()).toMatchObject({ update: null, canInstall: false, sidebarVisible: false, disabled: false, status: "Update check unavailable" });
});

it("revokes an old install offer during a new check and blocks concurrent installation", async () => {
  let finish!: (value: null) => void;
  const downloadAndInstall = vi.fn();
  vi.stubGlobal("__TAURI__", { updater: { check: () => new Promise(resolve => { finish = resolve; }) } });
  state().showAvailable({ version: "0.6.5", downloadAndInstall });
  const checking = state().checkNow();
  expect(state()).toMatchObject({ checking: true, update: null, canInstall: false, disabled: true });
  await state().installUpdate();
  expect(downloadAndInstall).not.toHaveBeenCalled();
  finish(null); await checking;
});

it("ignores an in-flight offer after automatic updates are disabled", async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal("__TAURI__", { updater: { check: () => new Promise(resolve => { finish = resolve; }) } });
  const checking = state().checkNow();
  state().configure(false);
  finish({ version: "9.9.9" }); await checking;
  expect(state()).toMatchObject({ enabled: false, update: null, canInstall: false, status: "Automatic updates are not configured" });
});

it("does not apply an old channel's response after the channel changes", async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal("__TAURI__", { core: { invoke: () => new Promise(resolve => { finish = resolve; }) } });
  const checking = state().checkNow();
  localStorage.setItem(BETA_SETTINGS_KEY, "true"); state().showIdle();
  finish({ version: "9.9.9", body: "Old stable offer" }); await checking;
  expect(state()).toMatchObject({ checking: false, update: null, canInstall: false, status: "Click to check" });
});

it("does not let an obsolete failure clear the new channel's active check", async () => {
  let failOld!: (error: Error) => void, finishNew!: (value: unknown) => void;
  const invoke = vi.fn()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { failOld = reject; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  const old = state().checkNow();
  localStorage.setItem(BETA_SETTINGS_KEY, "true"); state().showIdle();
  const next = state().checkNow();
  failOld(new Error("Old stable request failed")); await old;
  expect(state()).toMatchObject({ checking: true, disabled: true, update: null, status: "Checking…" });
  finishNew({ version: "0.6.6-beta.1", body: "New beta notes" }); await next;
  expect(state()).toMatchObject({ checking: false, canInstall: true, update: { version: "0.6.6-beta.1", body: "New beta notes" } });
  expect(invoke.mock.calls).toEqual([["check_desktop_update", { beta: false }], ["check_desktop_update", { beta: true }]]);
});

it("keeps the refreshed stable offer when a superseded stable request finishes last", async () => {
  let older!: (result: unknown) => void;
  const invoke = vi.fn()
    .mockImplementationOnce(() => new Promise(resolve => { older = resolve; }))
    .mockResolvedValueOnce({ version: "0.7.2", fullInstaller: true });
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  const first = state().checkNow();
  state().showIdle();
  await state().checkNow();
  older({ version: "0.7.1", fullInstaller: true });
  await first;
  expect(state()).toMatchObject({ checking: false, canInstall: true, update: { version: "0.7.2" } });
});

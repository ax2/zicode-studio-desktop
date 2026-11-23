import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale, t } from "../../shared/i18n";
import { UpdatesTab } from "./UpdatesTab";
import { createSettingsStore } from "./store";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";
import { useAppUpdaterStore } from "./updaterStore";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("renders release Markdown formatting and only web links without embedded content", () => {
  setLocale("en");
  useAppUpdaterStore.getState().configure(true);
  useAppUpdaterStore.getState().showAvailable({ version: "1.0.0", body:
    "## Changes\n\n- **Search** [details](https://example.org/notes)\n- [local](file:///notes)\n\n![preview](https://example.org/image.png)\n\n<iframe>example</iframe>" });
  const view = render(<UpdatesTab store={createSettingsStore()} widgets={createSettingsWidgetsStore()} />);
  const notes = view.container.querySelector("details")!;
  expect(notes.querySelector("h2")?.textContent).toBe("Changes");
  expect(notes.querySelector("li strong")?.textContent).toBe("Search");
  expect(Array.from(notes.querySelectorAll("a"), a => a.href)).toEqual(["https://example.org/notes"]);
  expect(notes.querySelector("img,iframe")).toBeNull();
});

it("persists the selected mode and prepares a verified stable installer without exiting", async () => {
  setLocale("en");
  localStorage.clear();
  let saved = "notify";
  const invoke = vi.fn(async (command: string, args?: { mode?: string }) => {
    if (command === "desktop_update_preference") {
      saved = args?.mode ?? saved;
      return saved;
    }
    if (command === "check_desktop_update") return { version: "9.0.0", fullInstaller: true };
  });
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  const state = useAppUpdaterStore.getState;
  state().configure(true);
  const view = render(<UpdatesTab store={createSettingsStore()} widgets={createSettingsWidgetsStore()} />);
  const select = view.getByLabelText("Automatic updates");
  await act(async () => { fireEvent.change(select, { target: { value: "manual" } }); });
  await act(async () => { state().configure(true); await state().restoreMode(); });
  await act(async () => { await state().backgroundCheck(); });
  expect(state().mode).toBe("manual");
  expect(invoke.mock.calls.every(([name]) => name === "desktop_update_preference")).toBe(true);
  await act(async () => { fireEvent.change(select, { target: { value: "download" } }); });
  expect(invoke.mock.calls.map(([name]) => name).filter(name => name !== "desktop_update_preference")).toEqual(["check_desktop_update", "install_desktop_update"]);
  expect(state().installerReady).toBe(true);
  expect(view.getByText("Install and exit")).toBeTruthy();
  expect(view.getByRole("status").textContent).toContain("v9.0.0");
  await act(async () => { await state().backgroundCheck(); });
  expect(invoke.mock.calls.some(([name]) => name === "restart_desktop_after_update")).toBe(false);
  await act(async () => { state().configure(true); await state().restoreMode(); });
  expect(state().mode).toBe("download");
  localStorage.clear();
});

it.each(["en", "zh-CN"])("shows the native installed version and an honest manual stable-release entry (%s)", async locale => {
  setLocale(locale);
  const getVersion = vi.fn(async () => "0.6.5");
  const invoke = vi.fn();
  vi.stubGlobal("__TAURI__", { app: { getVersion }, core: { invoke } });
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ piVersion: "1.5.2" }) })));
  useAppUpdaterStore.getState().configure(false);
  const store = createSettingsStore();
  await store.getState().loadVersions();
  const view = render(<UpdatesTab store={store} widgets={createSettingsWidgetsStore()} />);
  expect(view.container.querySelector("#setting-app-version-value")?.textContent).toBe("v0.6.5");
  expect(view.container.querySelector("#setting-pi-version-value")?.textContent).toBe("1.5.2");
  expect(getVersion).toHaveBeenCalledOnce();
  expect(view.container.querySelector("#setting-update-status")?.textContent).toBe(t("Automatic updates are not configured"));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fireEvent.click(view.container.querySelector("#btn-check-updates") as HTMLButtonElement);
  const anchor = click.mock.contexts[0] as HTMLAnchorElement;
  expect(anchor.href).toBe("https://github.com/ax2/zicode-studio-desktop/releases/latest");
  expect(anchor.target).toBe("_blank"); expect(anchor.rel).toBe("noopener noreferrer");
  expect(invoke).not.toHaveBeenCalled();
  expect(view.queryByText(t("Check the latest version, release notes and Windows installer on GitHub."))).not.toBeNull();
  const restartWarning = t("Installing an update will restart Studio. Save your work first.");
  expect(view.queryByText(restartWarning)).toBeNull();
  act(() => useAppUpdaterStore.getState().configure(true));
  expect(view.queryByText(restartWarning)).toBeNull();
  act(() => useAppUpdaterStore.getState().showAvailable({ version: "0.6.6" }));
  expect(view.queryByText(restartWarning)).not.toBeNull();
  act(() => useAppUpdaterStore.getState().configure(false));
  expect(view.queryByText(restartWarning)).toBeNull();
});

it("localizes unavailable installed-version fallbacks without inventing a latest version", async () => {
  setLocale("zh-CN");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Host unavailable"); }));
  vi.stubGlobal("__TAURI__", {});
  useAppUpdaterStore.getState().configure(false);
  const store = createSettingsStore();
  const view = render(<UpdatesTab store={store} widgets={createSettingsWidgetsStore()} />);
  expect(view.container.querySelector("#setting-app-version-value")?.textContent).toBe(t("Loading..."));
  await act(async () => { await store.getState().loadVersions(); });
  expect(view.container.querySelector("#setting-app-version-value")?.textContent).toBe("不可用");
  expect(view.container.querySelector("#setting-pi-version-value")?.textContent).toBe("不可用");
  expect(view.queryByText("Up to date")).toBeNull();
});

it("rechecks an offered Windows update without starting the older install", async () => {
  setLocale("en");
  localStorage.clear();
  const install = vi.fn();
  const invoke = vi.fn(async () => ({ version: "0.7.2", fullInstaller: true }));
  vi.stubGlobal("__TAURI__", { core: { invoke } });
  useAppUpdaterStore.getState().configure(true);
  useAppUpdaterStore.getState().showAvailable({ version: "0.7.1", fullInstaller: true, downloadAndInstall: install });
  const view = render(<UpdatesTab store={createSettingsStore()} widgets={createSettingsWidgetsStore()} />);
  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Check now" })); });
  expect(view.getByRole("status").textContent).toContain("0.7.2");
  expect(invoke.mock.calls).toEqual([["check_desktop_update", { beta: false }]]);
  expect(install).not.toHaveBeenCalled();
});

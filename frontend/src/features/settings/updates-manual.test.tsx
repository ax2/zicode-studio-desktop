import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { setLocale, t } from "../../shared/i18n";
import { UpdatesTab } from "./UpdatesTab";
import { createSettingsStore } from "./store";
import { createSettingsWidgetsStore } from "./settingsWidgetsStore";
import { useAppUpdaterStore } from "./updaterStore";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

import { setLocale } from "i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAppUpdater } from "../react/settings.js";

function renderUpdaterDom() {
  document.body.innerHTML = `
    <span id="setting-update-status"></span>
    <button id="btn-check-updates"></button>
    <button id="sidebar-update-btn" class="hidden">Update</button>
  `;
}

describe("app updater sidebar action", () => {
  beforeEach(() => {
    setLocale("en");
    renderUpdaterDom();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, "__TAURI__");
  });

  it("opens update review from the sidebar without installing immediately", async () => {
    const downloadAndInstall = vi.fn(async () => undefined);
    const relaunch = vi.fn(async () => undefined);
    const openSettings = vi.fn();
    let offeredVersion = "0.7.1";

    globalThis.__TAURI__ = {
      process: { relaunch },
      updater: {
        check: vi.fn(async () => ({ version: offeredVersion, downloadAndInstall })),
      },
    };

    const notify = vi.fn();
    const handle = setupAppUpdater({ settingsPanel: { openSettings }, enabled: true, notify });

    const sidebarButton = document.getElementById("sidebar-update-btn");
    await vi.waitFor(() => expect(sidebarButton.classList.contains("hidden")).toBe(false));

    sidebarButton.click();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].title).toContain("0.7.1");
    notify.mock.calls[0][0].action.run();
    await handle.checkNow();
    expect(notify).toHaveBeenCalledTimes(1);
    offeredVersion = "0.7.2";
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60 * 1000);
    try {
      window.dispatchEvent(new Event("focus"));
      await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
      expect(notify.mock.calls[1][0].title).toContain("0.7.2");
      window.dispatchEvent(new Event("focus"));
      expect(globalThis.__TAURI__.updater.check).toHaveBeenCalledTimes(3);
    } finally { clock.mockRestore(); }
    expect(openSettings).toHaveBeenCalledWith("updates");
    expect(downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("does not contact an unsigned update feed by default", () => {
    const check = vi.fn();
    globalThis.__TAURI__ = { updater: { check } };

    setupAppUpdater();

    expect(check).not.toHaveBeenCalled();
    expect(document.getElementById("setting-update-status").textContent).toContain(
      "not configured",
    );
    // The button stays enabled as a GitHub Releases entry; it must never
    // trigger an unsigned feed check.
    expect(document.getElementById("btn-check-updates").disabled).toBe(false);
    document.getElementById("btn-check-updates").click();
    expect(check).not.toHaveBeenCalled();
  });
});

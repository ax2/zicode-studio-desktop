import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { getLocale, setLocale } from "../../i18n.js";

let app;
const locale = getLocale();
afterEach(async () => {
  await app?.canDeactivate(); app = undefined;
  document.body.replaceChildren(); setLocale(locale);
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("keyboard-selects mute for the background source tab without changing the active page", async () => {
  setLocale("en");
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, width: 900, height: 600 });
  const tabs = ["active", "background"].map(id => ({ id, url: `https://fixture.invalid/${id}`, title: id, zoom: 1, muted: false }));
  const settings = new Map(tabs.map(tab => [tab.id, { zoom: tab.zoom, muted: tab.muted }]));
  const requests = [], saves = [];
  let revision = 1;
  const invoke = vi.fn(async (command, args) => {
    if (command === "browser_get_state") return { startupMode: "browser", session: { revision, activeTab: "active", tabs } };
    if (command === "browser_save_session") { saves.push(args); return { revision: ++revision }; }
    const request = args.request; requests.push(request);
    if (request.kind === "status") return { surfaceRevision: 0, tabs };
    if (request.kind === "pageSettings") return { ...settings.get(request.tab) };
    if (request.kind === "setMuted") {
      settings.get(request.tab).muted = request.muted;
      return { ...settings.get(request.tab) };
    }
    return {};
  });
  const host = document.createElement("main"); document.body.append(host);
  app = setupBrowserApp({ invoke }); app.renderContent(host);
  await waitFor(() => expect(requests.some(request => request.kind === "present" && request.tab === "active")).toBe(true));
  const tab = host.querySelector('[data-browser-tab-id="background"] [role="tab"]');
  tab.focus();
  fireEvent.keyDown(tab, { key: "F10", shiftKey: true });
  const menu = document.querySelector('.browser-tab-menu:not([hidden])');
  expect(menu).not.toBeNull();
  expect(fireEvent.keyDown(menu, { key: "m" })).toBe(false);
  expect(document.activeElement.textContent).toBe("Mute tab");
  document.activeElement.click();
  await waitFor(() => expect(saves).toHaveLength(1));
  expect(requests.filter(request => request.kind === "setMuted")).toEqual([{ kind: "setMuted", tab: "background", muted: true }]);
  expect(saves[0]).toMatchObject({ activeTab: "active", tabs: [
    { id: "active", muted: false }, { id: "background", muted: true },
  ] });
  expect(host.querySelector('[aria-selected="true"]').closest('[data-browser-tab-id]').dataset.browserTabId).toBe("active");
  expect(menu.hidden).toBe(true);
});

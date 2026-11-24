import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserApp } from "./browser-app.js";
import { getLocale, setLocale, t } from "../../i18n.js";

const initialLocale = getLocale();
let app;
afterEach(async () => { await app?.canDeactivate(); document.body.replaceChildren(); setLocale(initialLocale); vi.unstubAllGlobals(); });
it("uses Stop only for the selected loading tab, then restores Reload", async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const active = "32343a13-7ecf-4ac4-a2d9-82bd58f8171b";
  const peer = "6ca0ed15-aa36-46ea-9d10-0cdbdb45ecc1";
  let emit; const calls = [];
  const invoke = vi.fn(async (name, args) => {
    calls.push({ name, args });
    if (name === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: active, tabs: [active, peer].map(id => ({ id, url: "https://example.org/", title: id })) } };
    if (name === "browser_control" && args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
    if (name === "browser_save_session") return { revision: 1 };
    return {};
  });
  app = setupBrowserApp({ invoke, listen: async (_event, callback) => { emit = payload => callback({ payload }); } });
  const container = document.createElement("main"); document.body.append(container); app.renderContent(container);
  await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(2));
  const [back, forward, button] = container.querySelectorAll(".browser-navigation > button");
  const status = () => container.querySelector('.browser-footer > [role="status"]').textContent;
  const selectTab = async id => {
    container.querySelector(`[data-browser-tab-id="${id}"] [role="tab"]`).click();
    await waitFor(() => expect(container.querySelector(`[data-browser-tab-id="${id}"] [role="tab"]`).getAttribute("aria-selected")).toBe("true"));
  };
  const history = (tab, canGoBack, canGoForward) => emit({ kind: "historyChanged", tab, history: { canGoBack, canGoForward } });
  expect([back.disabled, forward.disabled]).toEqual([true, true]);
  history(peer, false, true);
  expect([back.disabled, forward.disabled]).toEqual([true, true]);
  history(active, true, false);
  expect([back.disabled, forward.disabled]).toEqual([false, true]);
  back.click();
  await waitFor(() => expect(calls.some(c => c.args?.request?.action === "back" && c.args.request.tab === active)).toBe(true));
  await selectTab(peer);
  expect([back.disabled, forward.disabled]).toEqual([true, false]);
  forward.click();
  await waitFor(() => expect(calls.some(c => c.args?.request?.action === "forward" && c.args.request.tab === peer)).toBe(true));
  await selectTab(active);
  expect([back.disabled, forward.disabled]).toEqual([false, true]);
  emit({ tab: active, kind: "navigationStarted" });
  emit({ tab: peer, kind: "navigationFinished", success: false });
  expect(status()).toBe("");
  button.click();
  await waitFor(() => expect(calls.some(c => c.args?.request?.action === "stop" && c.args.request.tab === active)).toBe(true));
  expect(button.getAttribute("aria-label")).toBe(t("Reload"));
  emit({ tab: active, kind: "navigationFinished", success: false, canceled: false });
  expect(status()).toBe("");
  button.click();
  await waitFor(() => expect(calls.some(c => c.args?.request?.action === "reload" && c.args.request.tab === active)).toBe(true));
  await selectTab(peer);
  expect(status()).toBe(t("Page could not be loaded"));
  await selectTab(active);
  expect(status()).toBe("");
  await selectTab(peer);
  expect(status()).toBe(t("Page could not be loaded"));
  emit({ tab: peer, kind: "navigationStarted" });
  expect(status()).toBe("");
  emit({ tab: peer, kind: "navigationFinished", success: true });
  expect(status()).toBe("");
  expect(container.querySelectorAll(".browser-navigation > button").length).toBe(4); // Back, Forward, reload/stop, Go.
});

it("updates mounted browser controls when the language changes without altering navigation or address edits", async () => {
  setLocale("zh-CN");
  vi.stubGlobal("ResizeObserver", class { observe() {} });
  const active = "32343a13-7ecf-4ac4-a2d9-82bd58f8171b";
  const peer = "6ca0ed15-aa36-46ea-9d10-0cdbdb45ecc1";
  const tabs = [active, peer].map(id => ({ id, url: "https://example.invalid/", title: id }));
  let emit;
  const request = vi.fn(async (name, args) => {
    if (name === "browser_get_state") return { startupMode: "browser", session: { revision: 0, activeTab: active, tabs } };
    if (name === "browser_control" && args.request.kind === "status") return { surfaceRevision: 0, tabs: [] };
    if (name === "browser_control" && args.request.kind === "url") return { url: tabs[0].url };
    return {};
  });
  app = setupBrowserApp({ invoke: request, listen: async (_event, callback) => { emit = payload => callback({ payload }); } });
  const container = document.createElement("main");
  document.body.append(container);
  app.renderContent(container);
  await waitFor(() => expect(container.querySelectorAll('[role="tab"]').length).toBe(2));

  const navigation = container.querySelector(".browser-navigation");
  const [back, forward, reload, go] = navigation.querySelectorAll(":scope > button");
  const address = navigation.querySelector(".browser-address");
  const bookmark = navigation.querySelector(".browser-bookmark-toggle");
  const downloads = navigation.querySelector(".browser-downloads-open");
  emit({ kind: "historyChanged", tab: active, history: { canGoBack: true, canGoForward: false } });
  emit({ kind: "navigationStarted", tab: active });

  address.focus();
  address.value = "unsent local search";
  address.setSelectionRange(6, 11);
  address.dispatchEvent(new Event("input", { bubbles: true }));
  const selected = container.querySelector('[role="tab"][aria-selected="true"]');
  request.mockClear();
  function assertLabels() {
    expect(address.placeholder).toBe(t("Search or enter a web address"));
    expect(address.getAttribute("aria-label")).toBe(t("Web address"));
    expect(go.textContent).toBe(t("Go"));
    for (const [button, label, shortcut] of [
      [back,"Back"," (Alt+←)"], [forward,"Forward"," (Alt+→)"], [reload,"Stop loading",""],
      [bookmark,"Bookmark this page"," (Ctrl+D)"], [downloads,"Downloads"," (Ctrl+J)"],
    ]) {
      expect(button.getAttribute("aria-label")).toBe(t(label));
      expect(button.title).toBe(t(label) + shortcut);
    }
    expect(back.disabled).toBe(false);
    expect(forward.disabled).toBe(true);
    expect(reload.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(address.value).toBe("unsent local search");
    expect([address.selectionStart, address.selectionEnd]).toEqual([6,11]);
    expect(document.activeElement).toBe(address);
    expect(container.querySelector('[role="tab"][aria-selected="true"]')).toBe(selected);
  }
  setLocale("en");
  assertLabels();
  setLocale("zh-CN");
  assertLabels();
  expect(request.mock.calls.every(([name, params]) => name === "browser_control" && params.request.kind === "menuLanguage")).toBe(true);
});

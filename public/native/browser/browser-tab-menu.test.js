import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/dom";
import { setupBrowserTabMenu } from "./browser-tab-menu.js";
import { getLocale, setLocale } from "../../i18n.js";

const locale = getLocale();
beforeEach(() => setLocale("en"));
afterEach(() => { document.body.replaceChildren(); setLocale(locale); });

function setup() {
  const host = document.createElement("div");
  const row = document.createElement("div"); row.dataset.browserTabId = "source";
  const tab = document.createElement("button"); tab.textContent = "Source"; row.append(tab); host.append(row); document.body.append(host);
  const actions = ["Mute tab", "Close other tabs", "Close unavailable", " Close tab", "Pin tab"].map(label => ({ label, action: vi.fn(), disabled: label === "Close unavailable" }));
  const focusTab = vi.fn(() => tab.focus());
  const api = setupBrowserTabMenu(host, { available: () => true, actionsFor: () => actions, focusTab });
  fireEvent.contextMenu(tab);
  const menu = document.querySelector('[role="menu"]');
  const items = [...menu.querySelectorAll("button")];
  return { api, host, tab, menu, items, actions, focusTab };
}

it("cycles matching localized initial letters and skips disabled actions without invoking them", () => {
  const { menu, items, actions } = setup();
  expect(document.activeElement).toBe(items[0]);
  expect(fireEvent.keyDown(menu, { key: "c" })).toBe(false);
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(menu, { key: "C", shiftKey: true });
  expect(document.activeElement).toBe(items[3]);
  fireEvent.keyDown(menu, { key: "c" });
  expect(document.activeElement).toBe(items[1]);
  for (const action of actions) expect(action.action).not.toHaveBeenCalled();
});

it("matches displayed translated characters, leaves unmatched keys and space to their normal behavior", () => {
  const { menu, items } = setup();
  items[4].textContent = "固定标签";
  fireEvent.keyDown(menu, { key: "固" });
  expect(document.activeElement).toBe(items[4]);
  for (const key of ["x", " ", "Enter"]) {
    expect(fireEvent.keyDown(menu, { key })).toBe(true);
    expect(document.activeElement).toBe(items[4]);
  }
});

it("does not intercept composition or command modifiers while a menu item is focused", () => {
  const { menu, items } = setup();
  for (const options of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
    for (const key of ["c", "ArrowDown", "Home", "End", "Escape", "Tab"]) {
      expect(fireEvent.keyDown(menu, { key, ...options })).toBe(true);
      expect(document.activeElement).toBe(items[0]);
      expect(menu.hidden).toBe(false);
    }
  }
});

it("keeps ordinary arrow navigation, boundaries and focus restoration after a letter selection", () => {
  const { menu, items, tab, focusTab } = setup();
  fireEvent.keyDown(menu, { key: "c" });
  fireEvent.keyDown(menu, { key: "ArrowDown" }); expect(document.activeElement).toBe(items[3]);
  fireEvent.keyDown(menu, { key: "End" }); expect(document.activeElement).toBe(items[4]);
  fireEvent.keyDown(menu, { key: "ArrowDown" }); expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(menu, { key: "ArrowUp" }); expect(document.activeElement).toBe(items[4]);
  fireEvent.keyDown(menu, { key: "Home" }); expect(document.activeElement).toBe(items[0]);
  expect(fireEvent.keyDown(menu, { key: "Escape" })).toBe(false);
  expect(menu.hidden).toBe(true); expect(document.activeElement).toBe(tab); expect(focusTab).toHaveBeenCalledWith("source");
});

it("opens from keyboard and lets a selected ordinary button invoke exactly its source action", () => {
  const { api, menu, tab, actions } = setup();
  api.close(); tab.focus();
  expect(fireEvent.keyDown(tab, { key: "F10", shiftKey: true })).toBe(false);
  expect(menu.hidden).toBe(false); expect(document.activeElement).toBe(menu.querySelector("button"));
  const pin = menu.querySelectorAll("button")[4];
  fireEvent.keyDown(menu, { key: "p" }); expect(document.activeElement).toBe(pin);
  pin.click();
  expect(actions[4].action).toHaveBeenCalledOnce();
  expect(menu.hidden).toBe(true); expect(document.activeElement).toBe(tab);
  expect(fireEvent.keyDown(tab, { key: "ContextMenu" })).toBe(false);
  expect(menu.hidden).toBe(false);
});

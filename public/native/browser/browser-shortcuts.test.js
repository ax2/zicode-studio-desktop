import { afterEach, expect, it, vi } from "vitest";
import { setupBrowserShortcuts } from "./browser-shortcuts.js";
let shortcuts;
afterEach(() => { shortcuts?.destroy(); document.body.replaceChildren(); });
function setup(overrides = {}) {
  const address = document.createElement("input"); address.value = "https://example.org/"; document.body.append(address);
  const args = { available: () => true, getTab: () => ({ id: "a" }), focusChrome: vi.fn(async () => {}), find: vi.fn(), address, report: vi.fn(), ...overrides };
  shortcuts = setupBrowserShortcuts(args); return args;
}
it("focuses and selects the address from chrome, without intercepting composition or other modifiers", () => {
  const args = setup(); const key = new KeyboardEvent("keydown", { key: "l", ctrlKey: true, cancelable: true }); document.dispatchEvent(key);
  expect(key.defaultPrevented).toBe(true); expect(document.activeElement).toBe(args.address); expect(args.address.selectionStart).toBe(0); expect(args.address.selectionEnd).toBe(args.address.value.length);
  for (const options of [{ shiftKey: true }, { altKey: true }, { isComposing: true }]) { const event = new KeyboardEvent("keydown", { key: "l", ctrlKey: true, cancelable: true, ...options }); document.dispatchEvent(event); expect(event.defaultPrevented).toBe(false); }
  expect(args.focusChrome).not.toHaveBeenCalled();
});
it("hands native focus back before opening find and ignores unrelated or inactive native events", async () => {
  const args = setup(); await shortcuts.native({ tab: "a", action: "find" }); expect(args.focusChrome).toHaveBeenCalledWith("a"); expect(args.find).toHaveBeenCalledOnce();
  await shortcuts.native({ tab: "other", action: "find" }); await shortcuts.native({ tab: "a", action: "execute" }); expect(args.focusChrome).toHaveBeenCalledTimes(1);
});
it("does not change the new tab or a modal after an asynchronous focus handoff", async () => {
  let id = "a", available = true, resolve;
  const args = setup({ getTab: () => ({ id }), available: () => available, focusChrome: vi.fn(() => new Promise(done => { resolve = done; })) });
  const first = shortcuts.native({ tab: "a", action: "find" }); id = "b"; resolve(); await first; expect(args.find).not.toHaveBeenCalled();
  const second = shortcuts.native({ tab: "b", action: "find" }); available = false; resolve(); await second; expect(args.find).not.toHaveBeenCalled();
  await shortcuts.native({ tab: "b", action: "find" }); expect(args.focusChrome).toHaveBeenCalledTimes(2);
});

it("routes tab shortcuts with the current source and suppresses repeats, composition and unrelated modifiers", () => {
  const action = vi.fn(); setup({ tabAction: action });
  for (const [key, shiftKey, name] of [["t", false, "newTab"], ["t", true, "reopenTab"], ["w", false, "closeTab"], ["Tab", false, "nextTab"], ["Tab", true, "previousTab"]]) {
    const event = new KeyboardEvent("keydown", { key, ctrlKey: true, shiftKey, cancelable: true }); document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true); expect(action).toHaveBeenLastCalledWith(name, "a");
  }
  expect(action).toHaveBeenCalledTimes(5);
  for (const options of [{ repeat: true }, { isComposing: true }, { altKey: true }, { ctrlKey: false }]) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, cancelable: true, ...options }));
  }
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, shiftKey: true }));
  expect(action).toHaveBeenCalledTimes(5);
});
it("does not intercept tab shortcuts in another application view or behind a modal", () => {
  const action = vi.fn(); setup({ available: () => false, tabAction: action });
  const event = new KeyboardEvent("keydown", { key: "w", ctrlKey: true, cancelable: true }); document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false); expect(action).not.toHaveBeenCalled();
});
it("checks native tab identity after focus, reports failure and does not close a replacement tab", async () => {
  let id = "a", resolve; const action = vi.fn();
  const args = setup({ getTab: () => ({ id }), tabAction: action, focusChrome: () => new Promise(done => { resolve = done; }) });
  const old = shortcuts.native({ tab: "a", action: "closeTab" }); id = "b"; resolve(); await old; expect(action).not.toHaveBeenCalled();
  const next = shortcuts.native({ tab: "b", action: "nextTab" }); resolve(); await next; expect(action).toHaveBeenCalledWith("nextTab", "b");
  args.tabAction.mockRejectedValueOnce(Error("Storage unavailable"));
  const fail = shortcuts.native({ tab: "b", action: "closeTab" }); resolve(); await fail; expect(args.report).toHaveBeenCalledWith(expect.objectContaining({ message: "Storage unavailable" }));
});
it("can create a tab from an empty browser without interpreting the key as a window close", () => {
  const action = vi.fn(); setup({ getTab: () => null, tabAction: action });
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true })); expect(action).toHaveBeenCalledWith("newTab", undefined);
});


it("uses plain F11 for fullscreen while retaining composition, modifier and modal guards", async () => {
  const fullscreen = vi.fn(); const args = setup({ fullscreen });
  const key = new KeyboardEvent("keydown", { key: "F11", cancelable: true }); document.dispatchEvent(key); expect(key.defaultPrevented).toBe(true); expect(fullscreen).toHaveBeenCalledOnce();
  for (const options of [{ ctrlKey: true }, { altKey: true }, { shiftKey: true }, { metaKey: true }, { isComposing: true }, { repeat: true }]) document.dispatchEvent(new KeyboardEvent("keydown", { key: "F11", ...options }));
  expect(fullscreen).toHaveBeenCalledOnce(); await shortcuts.native({ tab: "a", action: "fullscreen" }); expect(args.focusChrome).toHaveBeenCalledWith("a"); expect(fullscreen).toHaveBeenCalledTimes(2);
});


it("routes tab search from chrome and only after a valid native focus handoff", async () => {
  const searchTabs = vi.fn();
  let id = "a";
  const args = setup({ searchTabs, getTab: () => ({ id }) });
  const press = overrides => document.dispatchEvent(new KeyboardEvent("keydown", {
    key: "A", ctrlKey: true, shiftKey: true, cancelable: true, ...overrides,
  }));
  expect(press()).toBe(false);
  expect(searchTabs).toHaveBeenCalledWith(false, "a");
  for (const overrides of [{ shiftKey: false }, { altKey: true }, { isComposing: true }, { repeat: true }]) press(overrides);
  expect(searchTabs).toHaveBeenCalledTimes(1);
  await shortcuts.native({ tab: "other", action: "searchTabs" });
  expect(args.focusChrome).not.toHaveBeenCalled();
  await shortcuts.native({ tab: "a", action: "searchTabs" });
  expect(searchTabs).toHaveBeenLastCalledWith(true, "a");
  args.focusChrome.mockImplementationOnce(async () => { id = "b"; });
  await shortcuts.native({ tab: "a", action: "searchTabs" });
  expect(searchTabs).toHaveBeenCalledTimes(2);
});

it("routes page refresh and history accelerators without taking focus away from the native page", async () => {
  const pageAction = vi.fn();
  const args = setup({ pageAction });
  for (const [key, modifiers, action] of [
    ["F5", {}, "reload"], ["r", { ctrlKey: true }, "reload"],
    ["ArrowLeft", { altKey: true }, "back"], ["ArrowRight", { altKey: true }, "forward"],
  ]) {
    const press = overrides => document.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true, ...modifiers, ...overrides }));
    expect(press()).toBe(false);
    expect(pageAction).toHaveBeenLastCalledWith(action, "a");
    expect(press({ isComposing: true })).toBe(true);
    expect(press({ shiftKey: true })).toBe(true);
  }
  expect(pageAction).toHaveBeenCalledTimes(4);
  await shortcuts.native({ tab: "other", action: "reload" });
  expect(pageAction).toHaveBeenCalledTimes(4);
  await shortcuts.native({ tab: "a", action: "reload" });
  expect(pageAction).toHaveBeenCalledTimes(5);
  expect(args.focusChrome).not.toHaveBeenCalled();
});

it("routes numbered tab shortcuts while leaving native focus to tab activation", async () => {
  const tabAction = vi.fn();
  const args = setup({ tabAction });
  const press = (key, modifiers) => document.dispatchEvent(new KeyboardEvent("keydown", {
    key, ctrlKey: true, cancelable: true, ...modifiers,
  }));
  for (const digit of "123456789") {
    expect(press(digit)).toBe(false);
    expect(tabAction).toHaveBeenLastCalledWith(`tab${digit}`, "a");
    expect(press(digit, { shiftKey: true })).toBe(true);
  }
  expect(press("1", { repeat: true })).toBe(false);
  await shortcuts.native({ tab: "other", action: "tab1" });
  await shortcuts.native({ tab: "a", action: "tab0" });
  expect(tabAction).toHaveBeenCalledTimes(9);
  await shortcuts.native({ tab: "a", action: "tab9" });
  expect(tabAction).toHaveBeenLastCalledWith("tab9", "a");
  expect(args.focusChrome).not.toHaveBeenCalled();
});

it("uses page-only zoom accelerators without changing native focus", async () => {
  const pageAction = vi.fn();
  const args = setup({ pageAction });
  const press = (key, modifiers) => document.dispatchEvent(new KeyboardEvent("keydown", {
    key, ctrlKey: true, cancelable: true, ...modifiers,
  }));
  for (const [key, shiftKey, action] of [
    ["=", false, "zoomIn"], ["+", true, "zoomIn"], ["-", false, "zoomOut"], ["0", false, "zoomReset"],
  ]) {
    expect(press(key, { shiftKey })).toBe(false);
    expect(pageAction).toHaveBeenLastCalledWith(action, "a");
    expect(press(key, { shiftKey, altKey: true })).toBe(true);
  }
  expect(press("_", { shiftKey: true })).toBe(true);
  expect(press("=", { repeat: true })).toBe(false);
  await shortcuts.native({ tab: "other", action: "zoomIn" });
  expect(pageAction).toHaveBeenCalledTimes(4);
  await shortcuts.native({ tab: "a", action: "zoomOut" });
  expect(pageAction).toHaveBeenLastCalledWith("zoomOut", "a");
  expect(args.focusChrome).not.toHaveBeenCalled();
});

it("opens browser panels from chrome and from the same active native tab", async () => {
  const openPanel = vi.fn();
  const args = setup({ openPanel });
  for (const [key, action] of [["d", "bookmark"], ["h", "history"], ["j", "downloads"]]) {
    const press = modifiers => document.dispatchEvent(new KeyboardEvent("keydown", {
      key, ctrlKey: true, cancelable: true, ...modifiers,
    }));
    expect(press()).toBe(false);
    expect(openPanel).toHaveBeenLastCalledWith(action, false, "a");
    for (const modifiers of [{ altKey: true }, { shiftKey: true }, { isComposing: true }]) {
      expect(press(modifiers)).toBe(true);
    }
    expect(press({ repeat: true })).toBe(false);
    await shortcuts.native({ tab: "other", action });
    await shortcuts.native({ tab: "a", action });
    expect(openPanel).toHaveBeenLastCalledWith(action, true, "a");
  }
  expect(openPanel).toHaveBeenCalledTimes(6);
  expect(args.focusChrome).toHaveBeenCalledTimes(3);
});

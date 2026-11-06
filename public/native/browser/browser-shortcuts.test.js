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

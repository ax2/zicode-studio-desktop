import { t } from "../../i18n.js";
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserOptions } from "./browser-options.js";
afterEach(() => document.body.replaceChildren());
it("keeps selection explicit and closes options before requesting it", () => {
  const action = vi.fn(() => expect(menu.open).toBe(false));
  const startup = document.createElement("select");
  const menu = createBrowserOptions(startup, action); document.body.append(menu);
  menu.open = true; expect(action).not.toHaveBeenCalled();
  menu.querySelector("button").click(); expect(action).toHaveBeenCalledOnce();
  expect(menu.contains(startup)).toBe(true);
});
it("dismisses with Escape or outside focus and retains composition keystrokes", () => {
  const menu = createBrowserOptions(document.createElement("select"), vi.fn());
  const outside = document.createElement("button"); document.body.append(menu, outside);
  menu.open = true; const button = menu.querySelector("button");button.focus();
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }));
  expect(menu.open).toBe(true);
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(menu.open).toBe(false); expect(document.activeElement).toBe(menu.querySelector("summary"));
  menu.open = true; outside.focus(); expect(menu.open).toBe(false);
});

it("keeps the options overlay until the bookmark or history dialog takes over", async () => {
  for (const name of ["Bookmarks", "Browsing history"]) {
    let finish;
    const open = vi.fn(() => new Promise(resolve => { finish = resolve; }));
    const menu = createBrowserOptions(document.createElement("select"), vi.fn(), { bookmarks: open, history: open });
    document.body.append(menu);
    menu.open = true;
    [...menu.querySelectorAll("button")].find(button => button.textContent === t(name)).click();
    expect(menu.open).toBe(true);
    expect(open).toHaveBeenCalledOnce();
    finish();
    await Promise.resolve();
    expect(menu.open).toBe(false);
    menu.remove();
  }
});

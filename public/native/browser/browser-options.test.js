import { getLocale, setLocale, t } from "../../i18n.js";
import { afterEach, expect, it, vi } from "vitest";
import { createBrowserOptions } from "./browser-options.js";
afterEach(() => document.body.replaceChildren());
it("relabels the retained translation entry when Studio switches language", () => {
  const locale = getLocale();
  try {
    setLocale("zh-CN");
    const translate = vi.fn();
    const menu = createBrowserOptions(document.createElement("select"), vi.fn(), {translateSelection: translate});
    document.body.append(menu);
    menu.open = true;
    const button = [...menu.querySelectorAll("button")].find(node => node.textContent === t("Translate selected text"));
    expect(button).toBeDefined();
    setLocale("en");
    expect(button.textContent).toBe("Translate selected text");
    expect(menu.querySelector("summary").getAttribute("aria-label")).toBe("Browser options");
    expect(translate).not.toHaveBeenCalled();
    button.click();
    expect(translate).toHaveBeenCalledOnce();
  } finally {
    setLocale(locale);
  }
});
it("keeps selection explicit and closes options before requesting it", () => {
  const action = vi.fn(() => expect(menu.open).toBe(false));
  const startup = document.createElement("select");
  const menu = createBrowserOptions(startup, action); document.body.append(menu);
  menu.open = true; expect(action).not.toHaveBeenCalled();
  menu.querySelector('[data-i18n-text="Select all page text"]').click(); expect(action).toHaveBeenCalledOnce();
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

it("groups library commands and displays the configured Downloads shortcut", () => {
  const downloads = vi.fn();
  const menu = createBrowserOptions(document.createElement("select"), vi.fn(), { downloads, bookmarks: vi.fn() });
  const command = menu.querySelector('[data-i18n-text="Downloads"]');
  expect(command.parentElement).toBe(menu.querySelector('[data-i18n-text="Bookmarks"]').parentElement);
  expect(command.dataset.shortcut).toBe("Ctrl+J");
  expect(command.style.getPropertyValue("--browser-command-icon")).toContain("image/svg+xml");
  command.click();
  expect(downloads).toHaveBeenCalledOnce();
});

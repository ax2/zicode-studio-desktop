import { expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { setupBrowserWindowClose } from "./browser-window-close.js";

it("preserves an editor that declines to leave, and waits for pending tab saves before close", async () => {
  let active = "notes", allow = false, release;
  const shell = { getActivePluginId: () => active, activate: vi.fn(async id => { if (allow) active = id; }) };
  const browser = { finishWindowWrites: vi.fn(() => new Promise(resolve => { release = resolve; })) };
  const invoke = vi.fn().mockResolvedValue(true);
  setupBrowserWindowClose({ shell, browser, invoke, report: vi.fn() });
  const close = () => window.dispatchEvent(new Event("zicode:browser-window-close", { cancelable: true }));
  expect(close()).toBe(false);
  await Promise.resolve();
  expect(invoke).not.toHaveBeenCalled();
  allow = true;
  close(); close();
  await waitFor(() => expect(browser.finishWindowWrites).toHaveBeenCalledTimes(1));
  expect(invoke).not.toHaveBeenCalled();
  release();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("browser_window_command", {action:"close"}));
});

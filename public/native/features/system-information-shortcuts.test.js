// @vitest-environment node
import { expect, it, vi } from "vitest";
import { setupSystemInformationShortcut } from "./system-information-shortcuts.js";

it("opens system settings from the tray event without requesting sensor access", async () => {
  const openSettings = vi.fn(), stop = vi.fn();
  let receive;
  const listen = vi.fn(async (name, callback) => {
    expect(name).toBe("studio-open-system-information");
    receive = callback;
    return stop;
  });
  const dispose = setupSystemInformationShortcut({ listen, openSettings });
  await Promise.resolve();
  receive();
  expect(openSettings).toHaveBeenCalledExactlyOnceWith("system");
  dispose();
  expect(stop).toHaveBeenCalledTimes(1);
  receive();
  expect(openSettings).toHaveBeenCalledTimes(1);
});

it("releases a listener that finishes registering after disposal", async () => {
  let complete, receive;
  const openSettings = vi.fn(), stop = vi.fn();
  const listen = (_name, callback) => {
    receive = callback;
    return new Promise(resolve => { complete = resolve; });
  };
  const dispose = setupSystemInformationShortcut({ listen, openSettings });
  dispose();
  complete(stop);
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
  receive();
  expect(openSettings).not.toHaveBeenCalled();
});

it("keeps an absent desktop bridge a no-op and reports listener failures", async () => {
  const openSettings = vi.fn(), onError = vi.fn();
  setupSystemInformationShortcut({ openSettings })();
  const error = new Error("listener unavailable");
  setupSystemInformationShortcut({ listen: () => Promise.reject(error), openSettings, onError });
  await Promise.resolve();
  await Promise.resolve();
  expect(onError).toHaveBeenCalledExactlyOnceWith(error);
  expect(openSettings).not.toHaveBeenCalled();
});

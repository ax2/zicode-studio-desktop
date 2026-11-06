import { afterEach, expect, it, vi } from "vitest";
import { withBrowserViewportRetry } from "./browser-viewport-retry.js";
const changed = "Browser viewport must fit inside its owner window";
afterEach(() => vi.unstubAllGlobals());
it("remeasures after a frame when native resizing invalidates the first measurement", async () => {
  let width = 1200; const measured = [];
  vi.stubGlobal("requestAnimationFrame", done => { width = 800; done(); });
  await withBrowserViewportRetry(async () => { measured.push(width); if (width > 800) throw Error(changed); });
  expect(measured).toEqual([1200, 800]);
});
it("stops after three failed attempts and does not retry unrelated native failures", async () => {
  vi.stubGlobal("requestAnimationFrame", done => done());
  const work = vi.fn(async () => { throw changed; }); await expect(withBrowserViewportRetry(work)).rejects.toBe(changed); expect(work).toHaveBeenCalledTimes(3);
  const denied = vi.fn(async () => { throw Error("Browser navigation blocked"); }); await expect(withBrowserViewportRetry(denied)).rejects.toThrow("Browser navigation blocked"); expect(denied).toHaveBeenCalledTimes(1);
});
it("does not present an old tab or an overlay-hidden page after the failed attempt", async () => {
  let active = true; vi.stubGlobal("requestAnimationFrame", done => { active = false; done(); });
  const work = vi.fn(async () => { throw Error(changed); }); await withBrowserViewportRetry(work, () => active); expect(work).toHaveBeenCalledTimes(1);
});

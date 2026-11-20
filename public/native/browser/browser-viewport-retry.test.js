import { afterEach, expect, it, vi } from "vitest";
import { createHiddenBrowserView, withBrowserViewportRetry } from "./browser-viewport-retry.js";
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

it("creates a hidden view at a safe size only when the native owner rejects the measured bounds", async () => {
  const measured = { x: 0, y: 80, width: 1200, height: 600 };
  const safe = { x: 0, y: 0, width: 1, height: 1 };
  const create = vi.fn().mockRejectedValueOnce(changed).mockResolvedValueOnce({ tab: "candidate" });
  await expect(createHiddenBrowserView(create, measured)).resolves.toEqual({ tab: "candidate" });
  expect(create.mock.calls).toEqual([[measured], [safe]]);
  create.mockReset().mockRejectedValue(Error("Browser navigation blocked"));
  await expect(createHiddenBrowserView(create, measured)).rejects.toThrow("Browser navigation blocked");
  expect(create.mock.calls).toEqual([[measured]]);
});

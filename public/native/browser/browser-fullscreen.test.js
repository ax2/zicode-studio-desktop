import { afterEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/dom";
import { createBrowserFullscreen } from "./browser-fullscreen.js";

afterEach(() => document.body.replaceChildren());
function setup(extra = {}) {
  let state = false;
  const args = { control: vi.fn(async request => { if (request.enabled !== undefined) state = request.enabled; return { fullscreen: state }; }), beforeChange: vi.fn(), afterChange: vi.fn(), report: vi.fn(), ...extra };
  const view = createBrowserFullscreen(args); document.body.append(view.element, view.exit); return { view, ...args };
}
it("offers a visible exit after entering and reads authoritative window state before toggling", async () => {
  const h = setup(); expect(h.view.exit.hidden).toBe(true); await h.view.toggle();
  expect(h.beforeChange).toHaveBeenCalledOnce(); expect(h.afterChange).toHaveBeenCalledOnce();
  expect(h.control).toHaveBeenCalledWith({ kind: "fullscreen", enabled: true }); expect(h.view.exit.hidden).toBe(false); expect(h.view.element.getAttribute("aria-pressed")).toBe("true");
  h.view.exit.click(); await waitFor(() => expect(h.view.exit.hidden).toBe(true)); expect(h.control).toHaveBeenCalledWith({ kind: "fullscreen", enabled: false });
});
it("waits for an in-flight entry before leaving Browser and coalesces repeated toggles", async () => {
  let complete, state = false;
  const h = setup({ control: vi.fn(async request => { if (request.enabled === true) await new Promise(resolve => { complete = resolve; }); if (request.enabled !== undefined) state = request.enabled; return { fullscreen: state }; }) });
  const entry = h.view.toggle(); expect(h.view.toggle()).toBe(entry);
  await waitFor(() => expect(complete).toBeTypeOf("function")); expect(h.view.element.disabled).toBe(true);
  const leave = h.view.leave(); complete(); await entry; await leave;
  expect(state).toBe(false); expect(h.control.mock.calls.filter(([r]) => r.enabled !== undefined).map(([r]) => r.enabled)).toEqual([true, false]);
});
it("keeps exit available after a failed exit instead of pretending the window was restored", async () => {
  const h = setup({ control: vi.fn(async request => { if (request.enabled === false) throw Error("Window refused fullscreen exit"); return { fullscreen: true }; }) });
  await h.view.refresh(); h.view.exit.click(); await waitFor(() => expect(h.report).toHaveBeenCalledOnce());
  expect(h.view.exit.hidden).toBe(false); expect(h.view.exit.disabled).toBe(false); await expect(h.view.leave()).rejects.toThrow("Window refused");
});
it("ignores an old resize read when a later fullscreen command has already completed", async () => {
  let first = true, release, state = false;
  const h = setup({ control: vi.fn(async request => { if (first) { first = false; return new Promise(resolve => { release = resolve; }); } if (request.enabled !== undefined) state = request.enabled; return { fullscreen: state }; }) });
  const read = h.view.refresh(); await h.view.toggle(); release({ fullscreen: false }); await read;
  expect(h.view.exit.hidden).toBe(false); expect(h.view.element.getAttribute("aria-pressed")).toBe("true");
});

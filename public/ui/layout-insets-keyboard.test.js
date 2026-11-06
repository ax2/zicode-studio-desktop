import { afterEach, expect, it, vi } from "vitest";
import { setupMessagesInsets } from "./layout-insets.js";

const handles = [];
afterEach(() => {
  for (const destroy of handles.splice(0)) destroy();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
});

function fixture(coarse = false) {
  vi.stubGlobal("innerHeight", 900);
  vi.stubGlobal("matchMedia", vi.fn(query => ({ matches: coarse && query === "(pointer: coarse)" })));
  const viewport = Object.assign(new EventTarget(), { height: 900, offsetTop: 0 });
  const main = document.createElement("main"), messages = document.createElement("div");
  const header = document.createElement("header"), inputArea = document.createElement("section");
  const input = document.createElement("textarea"); inputArea.append(input);
  main.append(header, messages, inputArea); document.body.append(main);
  const frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const flush = () => { while (frames.length) frames.shift()(); };
  handles.push(setupMessagesInsets({ main, messages, header, inputArea, visualViewport: viewport }));
  flush(); input.focus(); flush();
  return { main, input, viewport, flush };
}

it("keeps navigation visible when a focused desktop composer moves into a smaller window", () => {
  const c = fixture();
  for (const height of [600, 480, 740, 520, 900]) {
    window.innerHeight = height; c.viewport.height = height;
    window.dispatchEvent(new Event("resize")); c.viewport.dispatchEvent(new Event("resize")); c.flush();
    expect(document.activeElement).toBe(c.input);
    expect(document.body.classList.contains("mobile-keyboard-open")).toBe(false);
    expect(c.main.style.getPropertyValue("--mobile-visual-viewport-bottom")).toBe("0px");
  }
});

it("still avoids a keyboard that occludes the visual viewport on a fine pointer device", () => {
  const c = fixture();
  c.viewport.height = 500; c.viewport.offsetTop = 40;
  c.viewport.dispatchEvent(new Event("resize")); c.flush();
  expect(document.body.classList.contains("mobile-keyboard-open")).toBe(true);
  expect(c.main.style.getPropertyValue("--mobile-visual-viewport-bottom")).toBe("360px");
  expect(c.main.style.getPropertyValue("--mobile-visual-viewport-top")).toBe("40px");
  c.input.blur(); c.flush();
  expect(document.body.classList.contains("mobile-keyboard-open")).toBe(false);
});

it("retains layout-resizing touch keyboard support without treating initial focus as a keyboard", () => {
  const c = fixture(true);
  expect(document.body.classList.contains("mobile-keyboard-open")).toBe(false);
  window.innerHeight = 540; c.viewport.height = 540;
  window.dispatchEvent(new Event("resize")); c.flush();
  expect(document.body.classList.contains("mobile-keyboard-open")).toBe(true);
  c.viewport.height = 900; window.innerHeight = 900;
  window.dispatchEvent(new Event("resize")); c.flush();
  expect(document.body.classList.contains("mobile-keyboard-open")).toBe(false);
});

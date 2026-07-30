import { afterEach, describe, expect, it } from "vitest";

import { applyTheme, getCurrentTheme, themes } from "./themes.js";

describe("appearance themes", () => {
  afterEach(() => {
    // biome-ignore lint/suspicious/noDocumentCookie: synchronous test cleanup
    document.cookie = "pi-studio-theme=; Max-Age=0; Path=/";
    document.documentElement.removeAttribute("data-theme");
    localStorage.clear();
  });

  it("defaults to the named white theme without color swatches", () => {
    // biome-ignore lint/suspicious/noDocumentCookie: synchronous test setup
    document.cookie = "pi-studio-theme=; Max-Age=0; Path=/";
    expect(getCurrentTheme()).toBe("clean");
    expect(themes.clean.name["zh-CN"]).toBe("明亮白色");
    expect(themes.clean.colors).toBeUndefined();

    applyTheme("unknown");
    expect(document.documentElement.dataset.theme).toBe("clean");
  });
});

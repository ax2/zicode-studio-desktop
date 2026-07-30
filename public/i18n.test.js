import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, t, translateDocument } from "./i18n.js";

describe("desktop localization", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("zh-CN");
  });

  it("uses Simplified Chinese and can switch to English", () => {
    document.body.innerHTML = "<button>Settings</button>";
    setLocale("zh-CN");
    translateDocument();
    expect(getLocale()).toBe("zh-CN");
    expect(document.querySelector("button").textContent).toBe("设置");
    expect(t("Appearance")).toBe("外观");

    setLocale("en");
    expect(document.querySelector("button").textContent).toBe("Settings");
  });
});

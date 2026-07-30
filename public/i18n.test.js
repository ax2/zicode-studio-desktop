import { afterEach, describe, expect, it } from "vitest";

import { getLocale, setLocale, t, translateDocument } from "./i18n.js";

describe("desktop localization", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("zh-CN");
  });

  it("uses Simplified Chinese and can switch to English", () => {
    document.body.innerHTML = `
      <button>Settings</button>
      <p>Type a message below to start chatting with Pi,
         or select a session from the sidebar.</p>
      <span>Programming</span>
    `;
    setLocale("zh-CN");
    translateDocument();
    expect(getLocale()).toBe("zh-CN");
    expect(document.querySelector("button").textContent).toBe("设置");
    expect(t("Appearance")).toBe("外观");
    expect(document.querySelector("p").textContent).toContain("在下方输入消息");
    expect(document.querySelector("span").textContent).toBe("编程");

    setLocale("en");
    expect(document.querySelector("button").textContent).toBe("Settings");
    expect(document.querySelector("span").textContent).toBe("Programming");
  });
});

import { describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n.js";
import { renderStartupFailure } from "../react/startup-failure.js";

describe("startup failure", () => {
  it("renders a localized pairing block and retries explicitly", () => {
    setLocale("zh-CN");
    document.body.innerHTML = '<div class="app-layout">Starting…</div>';
    const reload = vi.fn();
    renderStartupFailure(
      { code: "device_pairing_required" },
      { documentRef: document, reload },
    );

    const surface = document.querySelector("[data-startup-failure]");
    expect(document.body.classList.contains("startup-failed")).toBe(true);
    expect(document.querySelector(".app-layout").hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".app-layout").getAttribute("aria-hidden")).toBe("true");
    expect(surface.getAttribute("role")).toBe("alertdialog");
    expect(surface.getAttribute("aria-modal")).toBe("true");
    expect(surface.textContent).toContain("此设备尚未配对");
    expect(document.activeElement.textContent).toBe("重试");
    surface.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement.textContent).toBe("重试");
    document.activeElement.click();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("explains an active device revocation without reconnecting silently", () => {
    setLocale("zh-CN");
    document.body.innerHTML = '<div class="app-layout">Chat</div>';

    renderStartupFailure({ code: "device_access_revoked" }, { documentRef: document });

    expect(document.querySelector("[data-startup-failure]").textContent).toContain(
      "此设备的访问权限已被撤销",
    );
  });

  it("explains that the desktop is offline and how to recover", () => {
    setLocale("zh-CN");
    document.body.innerHTML = '<div class="app-layout">Chat</div>';

    renderStartupFailure({ code: "desktop_offline" }, { documentRef: document });

    const text = document.querySelector("[data-startup-failure]").textContent;
    expect(text).toContain("桌面离线");
    expect(text).toContain("无法连接到你的 ZiCode 桌面");
    expect(text).toContain("稍等几秒后重试");
  });
});

import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { setLocale } from "../../shared/i18n.js";
import { LanQrModalApp, type LanQrStore } from "./LanQrModalApp";

function makeStore(overrides: Partial<LanQrStore> = {}) {
  return create<LanQrStore>()(() => ({
    kind: "session",
    open: true,
    status: "ready",
    dataUrl: "data:image/png;base64,abc",
    url: "https://relay.zicode.com/d/dev-test",
    caFingerprint: null,
    expiryText: "",
    expired: false,
    ...overrides,
  }));
}

afterEach(() => {
  document.body.innerHTML = "";
  setLocale("zh-CN");
});

describe("LAN QR modal", () => {
  it("copies the mobile link and shows confirmation", () => {
    setLocale("zh-CN");
    const store = makeStore();
    const { container } = render(
      <LanQrModalApp
        store={store.getState()}
        onTabClick={vi.fn()}
        onClose={vi.fn()}
        onBackdropClick={vi.fn()}
        onRefresh={vi.fn()}
        onOpenLink={vi.fn()}
      />,
    );
    const copy = container.querySelector("#lan-qr-copy") as HTMLElement;
    expect(copy).toBeTruthy();
    expect(copy.textContent).toContain("复制链接");
    fireEvent.click(copy);
    expect(copy.textContent).toContain("已复制");
  });
});

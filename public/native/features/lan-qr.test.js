import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSION_URL =
  "https://192.168.1.42:57652/app/workspaces/workspace-a/sessions/session-a?pairingToken=one-time";
const SETUP_URL = "http://192.168.1.42:57668/";

function setupDom() {
  document.body.innerHTML = `
    <button id="lan-qr-btn" type="button">QR</button>
    <div id="lan-qr-modal" class="hidden">
      <div id="lan-qr-modal-backdrop"></div>
      <button id="lan-qr-modal-close" type="button">Close</button>
      <button id="lan-qr-tab-session" data-lan-qr-kind="session" type="button"></button>
      <button id="lan-qr-tab-setup" data-lan-qr-kind="setup" type="button"></button>
      <div id="lan-qr-loading"></div>
      <img id="lan-qr-image" class="hidden" alt="QR" />
      <div id="lan-qr-hint"></div>
      <code id="lan-qr-address" class="hidden"></code>
      <div id="lan-qr-meta" class="hidden"></div>
      <button id="lan-qr-refresh" type="button" class="hidden">Refresh</button>
      <button id="lan-qr-open-link" type="button" class="hidden">Open link</button>
    </div>
  `;
}

function qrResponse(url) {
  const kind = String(url).includes("kind=setup") ? "setup" : "session";
  return Promise.resolve({
    ok: true,
    json: async () => ({
      kind,
      dataUrl: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
      url: kind === "setup" ? SETUP_URL : SESSION_URL,
      expiresAt: kind === "session" ? Math.floor(Date.now() / 1000) + 300 : null,
      caFingerprint: "AA:BB:CC",
    }),
  });
}

describe("LAN QR modal", () => {
  beforeEach(() => {
    vi.resetModules();
    setupDom();
    global.fetch = vi.fn(qrResponse);
  });

  it("creates a fresh current-chat QR and opens it through the native control gateway", async () => {
    const control = { openExternal: vi.fn().mockResolvedValue(undefined) };
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
const { setupLanQr } = await import("../react/lan-qr.js");
    setupLanQr({ control, desktopToken: "desktop-window-token" });

    document.getElementById("lan-qr-btn").click();
    await vi.waitFor(() => {
      expect(document.getElementById("lan-qr-image").classList.contains("hidden")).toBe(false);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("kind=session&path=%2F"),
      { headers: { "x-zicode-desktop-token": "desktop-window-token" } },
    );
    expect(document.getElementById("lan-qr-meta").textContent).toMatch(/04:|05:/);
    document.getElementById("lan-qr-open-link").click();
    expect(control.openExternal).toHaveBeenCalledWith(SESSION_URL);
    expect(openSpy).not.toHaveBeenCalled();
    document.getElementById("lan-qr-modal-close").click();
  });

  it("traps Tab inside the modal while open and ignores hidden actions", async () => {
const { setupLanQr } = await import("../react/lan-qr.js");
    setupLanQr();
    document.getElementById("lan-qr-btn").click();
    const modal = document.getElementById("lan-qr-modal");
    expect(modal.classList.contains("hidden")).toBe(false);

    const closeBtn = document.getElementById("lan-qr-modal-close");
    const setupTab = document.getElementById("lan-qr-tab-setup");
    closeBtn.focus();

    setupTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(closeBtn);

    closeBtn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
    );
    expect(document.activeElement).toBe(setupTab);

    document.getElementById("lan-qr-modal-close").click();
  });

  it("switches to a non-expiring certificate setup QR with the trusted fingerprint", async () => {
const { setupLanQr } = await import("../react/lan-qr.js");
    setupLanQr();
    document.getElementById("lan-qr-btn").click();
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    document.getElementById("lan-qr-tab-setup").click();
    await vi.waitFor(() => {
      expect(document.getElementById("lan-qr-address").textContent).toBe(SETUP_URL);
    });
    expect(global.fetch.mock.calls[1][0]).toContain("kind=setup");
    expect(document.getElementById("lan-qr-meta").textContent).toContain("AA:BB:CC");
    expect(document.getElementById("lan-qr-tab-setup").getAttribute("aria-selected")).toBe(
      "true",
    );
    document.getElementById("lan-qr-modal-close").click();
  });

  it("shows an explicit refresh action after a one-time QR expires", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        kind: "session",
        dataUrl: "data:image/svg+xml,%3Csvg%3E%3C/svg%3E",
        url: SESSION_URL,
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }),
    }));
const { setupLanQr } = await import("../react/lan-qr.js");
    setupLanQr();
    document.getElementById("lan-qr-btn").click();
    await vi.waitFor(() => {
      expect(document.getElementById("lan-qr-refresh").classList.contains("hidden")).toBe(false);
    });
    document.getElementById("lan-qr-refresh").click();
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    document.getElementById("lan-qr-modal-close").click();
  });

  it("never exposes the desktop pairing button to a remote browser", async () => {
    const fetchImpl = vi.fn();
const { refreshLanQrButton } = await import("../react/lan-qr.js");
    await refreshLanQrButton({
      locationRef: { hostname: "192.168.1.42" },
      fetchImpl,
    });
    expect(document.getElementById("lan-qr-btn").classList.contains("hidden")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

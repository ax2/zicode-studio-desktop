import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n.js";
import { setupRemoteAccessSettings } from "./remote-access-settings.js";

describe("remote access settings", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="settings-remote-access"></div>';
  });

  it("explains that encrypted LAN transport remains off", () => {
    setupRemoteAccessSettings({ gateway: { listDevices: vi.fn() } });
    expect(document.getElementById("settings-remote-access").textContent).toContain(
      "HTTPS/WSS",
    );
  });

  it("renders paired and revoked devices", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({ configuredEnabled: false, running: false })),
      listDevices: vi.fn(async () => [
        {
          deviceId: "phone",
          deviceName: "Alice's phone",
          pairedAt: 1_700_000_000,
          lastSeenAt: 1_700_000_100,
          revokedAt: null,
        },
        {
          deviceId: "tablet",
          deviceName: "Tablet",
          pairedAt: 1_600_000_000,
          lastSeenAt: 1_600_000_100,
          revokedAt: 1_600_000_200,
        },
      ]),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();
    expect(document.querySelectorAll(".remote-device-card")).toHaveLength(2);
    expect(document.body.textContent).toContain("Alice's phone");
    expect(document.querySelectorAll(".remote-device-revoke")).toHaveLength(1);
  });

  it("requires a second tap before revoking a device", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({ configuredEnabled: false, running: false })),
      listDevices: vi
        .fn()
        .mockResolvedValueOnce([
          {
            deviceId: "phone",
            deviceName: "Phone",
            pairedAt: 1,
            lastSeenAt: 1,
            revokedAt: null,
          },
        ])
        .mockResolvedValueOnce([]),
      revokeDevice: vi.fn(async () => true),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();
    const revoke = document.querySelector(".remote-device-revoke");
    revoke.click();
    expect(gateway.revokeDevice).not.toHaveBeenCalled();
    expect(revoke.textContent).toBe(t("Confirm revoke"));
    revoke.click();
    await vi.waitFor(() => expect(gateway.revokeDevice).toHaveBeenCalledWith("phone"));
  });

  it("shows the running HTTPS address and persists the explicit switch", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({
        configuredEnabled: true,
        running: true,
        urls: ["https://192.168.1.20:57652"],
        enrollmentUrls: ["http://192.168.1.20:57668"],
        caFingerprint: "AA:BB",
      })),
      listDevices: vi.fn(async () => []),
      setEnabled: vi.fn(async () => ({
        configuredEnabled: false,
        running: true,
        restartRequired: true,
        urls: ["https://192.168.1.20:57652"],
        enrollmentUrls: ["http://192.168.1.20:57668"],
        caFingerprint: "AA:BB",
      })),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();
    expect(document.body.textContent).toContain("https://192.168.1.20:57652");
    expect(document.body.textContent).toContain("http://192.168.1.20:57668");
    expect(document.body.textContent).toContain("AA:BB");
    const toggle = document.querySelector('[role="switch"]');
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.click();
    await vi.waitFor(() => expect(gateway.setEnabled).toHaveBeenCalledWith(false));
    expect(document.body.textContent).toContain(t("Restart required"));
  });

  it("marks recently active devices online and stale ones offline", async () => {
    const now = Math.floor(Date.now() / 1000);
    const gateway = {
      getStatus: vi.fn(async () => ({ configuredEnabled: true, running: true })),
      listDevices: vi.fn(async () => [
        {
          deviceId: "fresh",
          deviceName: "Fresh phone",
          pairedAt: now - 60_000,
          lastSeenAt: now - 10,
          revokedAt: null,
        },
        {
          deviceId: "stale",
          deviceName: "Stale phone",
          pairedAt: now - 60_000,
          lastSeenAt: now - 3_600,
          revokedAt: null,
        },
      ]),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();
    const badges = [...document.querySelectorAll(".remote-device-status")];
    expect(badges.map((badge) => badge.textContent.trim())).toEqual([
      t("Online"),
      t("Offline"),
    ]);
    expect(badges[0].classList.contains("is-online")).toBe(true);
    expect(badges[1].classList.contains("is-offline")).toBe(true);
  });
});

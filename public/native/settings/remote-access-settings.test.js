import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n.js";
import { setupRemoteAccessSettings } from "./remote-access-settings.js";

describe("remote access settings", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="settings-remote-access"></div>';
  });

  it("explains that encrypted LAN transport remains off", () => {
    setupRemoteAccessSettings({ gateway: { listDevices: vi.fn() } });
    expect(document.getElementById("settings-remote-access").textContent).toContain("HTTPS/WSS");
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

  it("prefills and saves the optional public tunnel addresses", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({
        configuredEnabled: true,
        running: true,
        urls: ["https://www.zicode.com:39010"],
        enrollmentUrls: ["http://www.zicode.com:39011"],
        publicUrl: "https://www.zicode.com:39010",
        publicEnrollmentUrl: "http://www.zicode.com:39011",
        caFingerprint: "AA:BB",
      })),
      listDevices: vi.fn(async () => []),
      setPublic: vi.fn(async () => ({ restartRequired: true })),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();

    const inputs = document.querySelectorAll(".remote-access-public input");
    expect(inputs).toHaveLength(2);
    expect(inputs[0].value).toBe("https://www.zicode.com:39010");
    expect(inputs[1].value).toBe("http://www.zicode.com:39011");

    inputs[0].value = "https://studio.zicode.com";
    const save = document.querySelector(".remote-access-public-save button");
    save.click();
    await vi.waitFor(() =>
      expect(gateway.setPublic).toHaveBeenCalledWith(
        "https://studio.zicode.com",
        "http://www.zicode.com:39011",
      ),
    );
  });

  it("prefills and toggles the server relay switch", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({
        configuredEnabled: true,
        running: true,
        publicUrl: "https://relay.zicode.com/d/dev-ax2-01",
        relayEnabled: true,
        relayUrl: "wss://relay.zicode.com",
        relayDeviceId: "dev-ax2-01",
      })),
      listDevices: vi.fn(async () => []),
      setRelay: vi.fn(async () => ({ restartRequired: true })),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();

    const section = document.querySelector(".remote-access-relay");
    expect(section.querySelector("input").value).toBe("wss://relay.zicode.com");
    expect(section.textContent).toContain("dev-ax2-01");
    const relayToggle = section.querySelector('[role="switch"]');
    expect(relayToggle.getAttribute("aria-checked")).toBe("true");

    relayToggle.click();
    await vi.waitFor(() =>
      expect(gateway.setRelay).toHaveBeenCalledWith(false, "wss://relay.zicode.com"),
    );
  });

  it("saves an edited relay address with the save button", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({
        configuredEnabled: true,
        running: true,
        publicUrl: "https://relay.zicode.com/d/dev-ax2-01",
        relayEnabled: false,
        relayUrl: "",
      })),
      listDevices: vi.fn(async () => []),
      setRelay: vi.fn(async () => ({ restartRequired: true })),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();

    const section = document.querySelector(".remote-access-relay");
    const input = section.querySelector("input");
    input.value = "wss://relay.example.com";
    section.querySelector(".remote-access-relay-save button").click();
    await vi.waitFor(() =>
      expect(gateway.setRelay).toHaveBeenCalledWith(false, "wss://relay.example.com"),
    );
  });

  it("blocks enabling relay without a public HTTPS address", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({
        configuredEnabled: true,
        running: true,
        relayEnabled: false,
        relayUrl: "",
      })),
      listDevices: vi.fn(async () => []),
      setRelay: vi.fn(),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();

    const section = document.querySelector(".remote-access-relay");
    const input = section.querySelector("input");
    input.value = "wss://relay.zicode.com";
    section.querySelector('[role="switch"]').click();
    await vi.waitFor(() =>
      expect(section.querySelector('[role="status"]').textContent).toContain("HTTPS"),
    );
    expect(gateway.setRelay).not.toHaveBeenCalled();
  });

  it("rejects a non-websocket relay address", async () => {
    const gateway = {
      getStatus: vi.fn(async () => ({
        configuredEnabled: true,
        running: true,
        publicUrl: "https://relay.zicode.com/d/dev-ax2-01",
        relayEnabled: false,
        relayUrl: "",
      })),
      listDevices: vi.fn(async () => []),
      setRelay: vi.fn(),
    };
    const settings = setupRemoteAccessSettings({ gateway });
    await settings.load();

    const section = document.querySelector(".remote-access-relay");
    const input = section.querySelector("input");
    input.value = "https://relay.zicode.com";
    section.querySelector('[role="switch"]').click();
    await vi.waitFor(() =>
      expect(section.querySelector('[role="status"]').textContent).toContain(
        t("Invalid relay address"),
      ),
    );
    expect(gateway.setRelay).not.toHaveBeenCalled();
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
    expect(badges.map((badge) => badge.textContent.trim())).toEqual([t("Online"), t("Offline")]);
    expect(badges[0].classList.contains("is-online")).toBe(true);
    expect(badges[1].classList.contains("is-offline")).toBe(true);
  });
});

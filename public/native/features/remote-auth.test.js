import { describe, expect, it, vi } from "vitest";
import {
  createAuthenticatedHostFetch,
  isLoopbackHost,
  remoteDeviceId,
  remoteDeviceName,
  remoteE2eePublicKey,
  resolveRemoteAuth,
} from "./remote-auth.js";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

describe("remote auth", () => {
  it("treats an injected native window on localhost as a desktop client", async () => {
    const auth = await resolveRemoteAuth({
      location: { href: "http://127.0.0.1:9000/app/workspaces/a/sessions/b" },
      history: { replaceState: vi.fn() },
      storage: storage(),
      fetchImpl: vi.fn(),
      desktopToken: "desktop-window-token",
    });
    expect(auth).toEqual({
      clientType: "desktop",
      deviceToken: "",
      desktopToken: "desktop-window-token",
    });
    expect(isLoopbackHost("localhost")).toBe(true);
  });

  it("exchanges a LAN pairing token, stores the device token, and cleans the URL", async () => {
    const localStorage = storage();
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ deviceToken: "picot-device-token" }),
    }));

    const auth = await resolveRemoteAuth({
      location: {
        href: "http://192.168.1.10:9000/app/workspaces/a/sessions/b?pairingToken=pair-1#hash",
      },
      history: { replaceState },
      storage: localStorage,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "/v2/auth/exchange",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"pairingToken":"pair-1"'),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      deviceName: expect.any(String),
    });
    expect(auth).toEqual({ clientType: "remote", deviceToken: "picot-device-token" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app/workspaces/a/sessions/b#hash");
  });

  it("mirrors the paired device token into a cookie for resource loads", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ deviceToken: "cookie-device-token" }),
    }));

    await resolveRemoteAuth({
      location: {
        href: "http://192.168.1.10:9000/app?pairingToken=pair-1",
      },
      history: { replaceState: vi.fn() },
      storage: storage(),
      fetchImpl,
    });

    expect(document.cookie).toContain("zicode_device_token=cookie-device-token");
  });

  it("reuses a stable remote device id", () => {
    const localStorage = storage();
    const first = remoteDeviceId(localStorage);
    expect(remoteDeviceId(localStorage)).toBe(first);
  });

  it("derives a readable mobile device name", () => {
    expect(remoteDeviceName({ userAgent: "Mozilla/5.0 (Linux; Android 15)" })).toBe(
      "Android device",
    );
    expect(remoteDeviceName({ userAgent: "", platform: "Linux armv8l" })).toBe("Linux armv8l");
  });

  it("blocks an unpaired non-loopback device before opening the runtime socket", async () => {
    await expect(
      resolveRemoteAuth({
        location: { href: "https://zicode.local/app/workspaces/a/sessions/b" },
        history: { replaceState: vi.fn() },
        storage: storage(),
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "device_pairing_required" });
  });

  it("removes a rejected pairing token from browser history", async () => {
    const replaceState = vi.fn();
    await expect(
      resolveRemoteAuth({
        location: {
          href: "https://zicode.local/app/workspaces/a/sessions/b?pairingToken=expired#hash",
        },
        history: { replaceState },
        storage: storage(),
        fetchImpl: vi.fn(async () => ({ ok: false })),
      }),
    ).rejects.toMatchObject({ code: "pairing_rejected" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app/workspaces/a/sessions/b#hash");
  });

  it("pins the desktop E2EE public key from the pairing link", async () => {
    const localStorage = storage();
    const e2eeKey = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)));
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ deviceToken: "picot-device-token" }),
    }));

    await resolveRemoteAuth({
      location: {
        href: `http://192.168.1.10:9000/app/?pairingToken=pair-1&ek=${encodeURIComponent(e2eeKey)}`,
      },
      history: { replaceState },
      storage: localStorage,
      fetchImpl,
    });

    expect(remoteE2eePublicKey(localStorage)).toBe(e2eeKey);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/app/");
  });

  it("ignores a malformed E2EE public key from the pairing link", async () => {
    const localStorage = storage();
    const replaceState = vi.fn();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ deviceToken: "picot-device-token" }),
    }));

    await resolveRemoteAuth({
      location: {
        href: "http://192.168.1.10:9000/app/?pairingToken=pair-2&ek=AAEC",
      },
      history: { replaceState },
      storage: localStorage,
      fetchImpl,
    });

    expect(remoteE2eePublicKey(localStorage)).toBe("");
  });

  it("shows a distinct error after too many pairing attempts", async () => {
    await expect(
      resolveRemoteAuth({
        location: { href: "https://zicode.local/?pairingToken=retry" },
        history: { replaceState: vi.fn() },
        storage: storage(),
        fetchImpl: vi.fn(async () => ({ ok: false, status: 429 })),
      }),
    ).rejects.toMatchObject({ code: "pairing_rate_limited" });
  });

  it("adds the device token only to same-origin Host requests", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const hostFetch = createAuthenticatedHostFetch({
      deviceToken: "picot-device-token",
      location: { origin: "https://zicode.local" },
      fetchImpl,
    });

    await hostFetch("/v2/bootstrap?workspaceId=a");
    const sameOriginHeaders = new Headers(fetchImpl.mock.calls[0][1].headers);
    expect(sameOriginHeaders.get("authorization")).toBe("Bearer picot-device-token");

    await hostFetch("https://models.example/v1/models", {
      headers: { accept: "application/json" },
    });
    expect(fetchImpl.mock.calls[1][1]).toEqual({ headers: { accept: "application/json" } });
  });
});

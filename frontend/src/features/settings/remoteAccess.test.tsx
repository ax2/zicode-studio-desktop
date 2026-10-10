import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../shared/i18n";
import { RemoteAccessTab } from "./RemoteAccessTab";
import {
  createRemoteAccessStore,
  formatBytes,
  type RemoteAccessGateway,
} from "./remoteAccessStore";

function gatewayStub(overrides: Partial<RemoteAccessGateway> = {}): RemoteAccessGateway {
  return {
    getStatus: vi.fn(async () => ({ running: false, configuredEnabled: false })),
    listDevices: vi.fn(async () => []),
    setEnabled: vi.fn(async (enabled) => ({ configuredEnabled: enabled, running: enabled })),
    setPublic: vi.fn(async () => ({})),
    setRelay: vi.fn(async (enabled) => ({ relayEnabled: enabled })),
    updateRelayTurn: vi.fn(async () => ({})),
    probeTurn: vi.fn(async () => ({ result: "protocol" })),
    revokeDevice: vi.fn(async () => ({})),
    ...overrides,
  };
}

describe("remote access store", () => {
  it("loads status and devices from the gateway", async () => {
    const gateway = gatewayStub({
      getStatus: vi.fn(async () => ({ running: true, urls: ["https://local.example"] })),
      listDevices: vi.fn(async () => [{ deviceId: "d1", deviceName: "OPPO" }]),
    });
    const store = createRemoteAccessStore(gateway);
    await store.getState().load();
    expect(store.getState().status.running).toBe(true);
    expect(store.getState().devices).toHaveLength(1);
    expect(gateway.getStatus).toHaveBeenCalled();
  });

  it("seeds the public and relay inputs from status", async () => {
    const gateway = gatewayStub({
      getStatus: vi.fn(async () => ({
        publicUrl: "https://www.zicode.com:39010",
        publicEnrollmentUrl: "http://www.zicode.com:39011",
        relayUrl: "wss://relay.zicode.com",
        relayTurnUrl: "turn:turn.remote.zicode.com:3478",
      })),
    });
    const store = createRemoteAccessStore(gateway);
    await store.getState().load();
    expect(store.getState().publicUrlInput).toBe("https://www.zicode.com:39010");
    expect(store.getState().relayUrlInput).toBe("wss://relay.zicode.com");
    expect(store.getState().turnUrlInput).toBe("turn:turn.remote.zicode.com:3478");
  });

  it("toggles secure mobile access through the gateway", async () => {
    const setEnabled = vi.fn(async (enabled: boolean) => ({ configuredEnabled: enabled }));
    const gateway = gatewayStub({ setEnabled });
    const store = createRemoteAccessStore(gateway);
    await store.getState().toggleEnabled();
    expect(setEnabled).toHaveBeenCalledWith(true);
    expect(store.getState().status.configuredEnabled).toBe(true);
  });

  it("validates public addresses before saving", async () => {
    const setPublic = vi.fn(async () => ({}));
    const gateway = gatewayStub({ setPublic });
    const store = createRemoteAccessStore(gateway);
    store.getState().setPublicInputs("not-a-url", "");
    await store.getState().savePublic();
    expect(store.getState().publicSaveStatus).toBeTruthy();
    expect(setPublic).not.toHaveBeenCalled();
  });

  it("requires a relay address and public URL before enabling relay", async () => {
    const setRelay = vi.fn(async () => ({}));
    const gateway = gatewayStub({ setRelay });
    const store = createRemoteAccessStore(gateway);
    await store.getState().saveRelay(true);
    expect(store.getState().relaySaveStatus).toBeTruthy();
    expect(setRelay).not.toHaveBeenCalled();
  });

  it("revokes a device and reloads", async () => {
    const revokeDevice = vi.fn(async () => ({}));
    const listDevices = vi.fn(async () => [{ deviceId: "d2" }]);
    const gateway = gatewayStub({ revokeDevice, listDevices });
    const store = createRemoteAccessStore(gateway);
    await store.getState().revokeDevice("d1");
    expect(revokeDevice).toHaveBeenCalledWith("d1");
    expect(store.getState().devices[0].deviceId).toBe("d2");
  });

  it("runs a TURN probe and surfaces the server verdict", async () => {
    const probeTurn = vi.fn(async () => ({ result: "unauthenticated" }));
    const gateway = gatewayStub({ probeTurn });
    const store = createRemoteAccessStore(gateway);
    const pending = store.getState().runTurnProbe();
    expect(store.getState().turnProbeStatus).toBe("busy");
    await pending;
    expect(probeTurn).toHaveBeenCalled();
    expect(store.getState().turnProbeStatus).toBe("unauthenticated");
  });

  it("surfaces gateway failures from the TURN probe", async () => {
    const probeTurn = vi.fn(async () => {
      throw new Error("boom");
    });
    const gateway = gatewayStub({ probeTurn });
    const store = createRemoteAccessStore(gateway);
    await store.getState().runTurnProbe();
    expect(store.getState().turnProbeStatus).toBe("error");
    expect(store.getState().turnProbeDetail).toContain("boom");
  });

  it("formats byte counts", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("remote access React tab", () => {
  it("renders the overview, relay, and device sections from the store", async () => {
    const gateway = gatewayStub({
      getStatus: vi.fn(async () => ({
        running: true,
        relayEnabled: true,
        relayConnected: true,
        relayDeviceId: "dev-ax2-01",
        e2eeFingerprint: "ab:cd:ef",
        urls: ["https://local.example"],
      })),
      listDevices: vi.fn(async () => [{ deviceId: "d1", deviceName: "OPPO" }]),
    });
    const store = createRemoteAccessStore(gateway);
    render(<RemoteAccessTab store={store} />);
    await waitFor(() => expect(store.getState().status.running).toBe(true));
    expect(screen.getByText("dev-ax2-01")).toBeTruthy();
    expect(screen.getByText("ab:cd:ef")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("OPPO")).toBeTruthy());
    expect(document.querySelector(".remote-device-card")).toBeTruthy();
    expect(document.querySelector(".settings-toggle.on")).toBeTruthy();
  });

  it("arms the revoke button with a two-step confirmation", async () => {
    const gateway = gatewayStub({
      listDevices: vi.fn(async () => [{ deviceId: "d1", deviceName: "OPPO" }]),
    });
    const store = createRemoteAccessStore(gateway);
    render(<RemoteAccessTab store={store} />);
    await waitFor(() => expect(screen.getByText("OPPO")).toBeTruthy());
    const button = document.querySelector(".remote-device-revoke") as HTMLButtonElement;
    act(() => button.click());
    expect(button.textContent).toBe(t("Confirm revoke"));
  });

  it("tests the TURN connection from the relay section", async () => {
    const probeTurn = vi.fn(async () => ({ result: "ok" }));
    const gateway = gatewayStub({ probeTurn });
    const store = createRemoteAccessStore(gateway);
    render(<RemoteAccessTab store={store} />);
    await waitFor(() =>
      expect(document.querySelector(".remote-access-turn-probe button")).toBeTruthy(),
    );
    const buttons = document.querySelectorAll(".remote-access-turn-probe button");
    const button = buttons[buttons.length - 1] as HTMLButtonElement;
    act(() => button.click());
    await waitFor(() => expect(store.getState().turnProbeStatus).toBe("ok"));
    expect(probeTurn).toHaveBeenCalled();
    const statuses = document.querySelectorAll('[data-turn-probe-status="ok"]');
    const status = statuses[statuses.length - 1];
    expect(status?.textContent).toContain(
      t("TURN connection OK — credentials match the server."),
    );
  });
});

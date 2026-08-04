import { describe, expect, it } from "vitest";
import { createInMemoryRuntimeAdapter } from "./runtime-gateway.js";
import { RemoteAccessGateway } from "./remote-access-gateway.js";

describe("RemoteAccessGateway", () => {
  it("lists paired devices through a local-only auth request", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const gateway = new RemoteAccessGateway(adapter);
    const response = gateway.listDevices();
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({ type: "auth_request", operation: "list_devices" });
    adapter.receive({
      type: "auth_response",
      requestId: sent.requestId,
      devices: [{ deviceId: "phone", deviceName: "Phone" }],
    });
    await expect(response).resolves.toEqual([{ deviceId: "phone", deviceName: "Phone" }]);
  });

  it("creates pairing credentials and revokes a selected device", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const gateway = new RemoteAccessGateway(adapter);
    const pairing = gateway.createPairing();
    const pairingRequest = adapter.takeSent();
    adapter.receive({
      type: "auth_response",
      requestId: pairingRequest.requestId,
      pairingToken: "pair-1",
      expiresAt: 100,
    });
    await expect(pairing).resolves.toMatchObject({ pairingToken: "pair-1" });

    const revocation = gateway.revokeDevice("phone");
    const revokeRequest = adapter.takeSent();
    expect(revokeRequest).toMatchObject({ operation: "revoke_device", deviceId: "phone" });
    adapter.receive({
      type: "auth_response",
      requestId: revokeRequest.requestId,
      revoked: true,
    });
    await expect(revocation).resolves.toBe(true);
  });

  it("reads and updates the explicit remote access switch", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const gateway = new RemoteAccessGateway(adapter);
    const status = gateway.getStatus();
    const statusRequest = adapter.takeSent();
    expect(statusRequest).toMatchObject({ operation: "remote_access_status" });
    adapter.receive({
      type: "auth_response",
      requestId: statusRequest.requestId,
      configuredEnabled: false,
      running: false,
    });
    await expect(status).resolves.toMatchObject({ configuredEnabled: false });

    const update = gateway.setEnabled(true);
    const updateRequest = adapter.takeSent();
    expect(updateRequest).toMatchObject({
      operation: "set_remote_access_enabled",
      enabled: true,
    });
    adapter.receive({
      type: "auth_response",
      requestId: updateRequest.requestId,
      configuredEnabled: true,
      restartRequired: true,
    });
    await expect(update).resolves.toMatchObject({ configuredEnabled: true });
  });

  it("saves the optional public tunnel addresses", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const gateway = new RemoteAccessGateway(adapter);
    const update = gateway.setPublic(
      "https://www.zicode.com:39010",
      "http://www.zicode.com:39011",
    );
    const sent = adapter.takeSent();
    expect(sent).toMatchObject({
      operation: "set_remote_access_public",
      publicUrl: "https://www.zicode.com:39010",
      publicEnrollmentUrl: "http://www.zicode.com:39011",
    });
    adapter.receive({
      type: "auth_response",
      requestId: sent.requestId,
      restartRequired: true,
      publicUrl: "https://www.zicode.com:39010",
      publicEnrollmentUrl: "http://www.zicode.com:39011",
    });
    await expect(update).resolves.toMatchObject({ restartRequired: true });
  });

  it("rejects pending requests after disconnect", async () => {
    const adapter = createInMemoryRuntimeAdapter();
    const gateway = new RemoteAccessGateway(adapter);
    const response = gateway.listDevices();
    adapter.disconnect();
    await expect(response).rejects.toThrow("disconnected");
  });
});

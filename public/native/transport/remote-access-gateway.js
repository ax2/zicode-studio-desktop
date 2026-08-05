export class RemoteAccessGateway {
  #adapter;
  #generation = 0;
  #nextRequestId = 1;
  #pending = new Map();

  constructor(adapter) {
    this.#adapter = adapter;
    adapter.setReceiver((frame) => this.#receive(frame));
    adapter.setConnectionListener?.((connected) => {
      if (!connected) this.#disconnect();
    });
  }

  createPairing() {
    return this.#request("create_pairing");
  }

  getStatus() {
    return this.#request("remote_access_status");
  }

  setEnabled(enabled) {
    return this.#request("set_remote_access_enabled", { enabled: Boolean(enabled) });
  }

  setPublic(publicUrl, publicEnrollmentUrl = "") {
    return this.#request("set_remote_access_public", {
      publicUrl: publicUrl || "",
      publicEnrollmentUrl: publicEnrollmentUrl || "",
    });
  }

  setRelay(relayEnabled, relayUrl = "") {
    return this.#request("set_remote_access_relay", {
      relayEnabled: Boolean(relayEnabled),
      relayUrl: relayUrl || "",
    });
  }

  updateRelayTurn(relayTurnUrl = "", relayTurnRealm = "", relayTurnSecret = "") {
    return this.#request("set_remote_access_turn", {
      relayTurnUrl: relayTurnUrl || "",
      relayTurnRealm: relayTurnRealm || "",
      relayTurnSecret: relayTurnSecret || "",
    });
  }

  async listDevices() {
    const frame = await this.#request("list_devices");
    return Array.isArray(frame?.devices) ? frame.devices : [];
  }

  async revokeDevice(deviceId) {
    const frame = await this.#request("revoke_device", { deviceId });
    return frame?.revoked === true;
  }

  #request(operation, parameters = {}) {
    if (typeof this.#adapter.ready === "function") {
      return this.#adapter.ready().then(() => this.#sendRequest(operation, parameters));
    }
    return this.#sendRequest(operation, parameters);
  }

  #sendRequest(operation, parameters) {
    const requestId = `auth-${this.#nextRequestId++}`;
    const generation = this.#generation;
    return new Promise((resolve, reject) => {
      this.#pending.set(requestId, { resolve, reject, generation });
      try {
        this.#adapter.send({
          type: "auth_request",
          requestId,
          operation,
          ...parameters,
        });
      } catch (error) {
        this.#pending.delete(requestId);
        reject(error);
      }
    });
  }

  #receive(frame) {
    const pending = this.#pending.get(frame?.requestId);
    if (!pending || pending.generation !== this.#generation) return;
    this.#pending.delete(frame.requestId);
    if (frame.error) {
      const error = new Error(frame.error.message ?? String(frame.error));
      error.code = frame.error.code;
      pending.reject(error);
      return;
    }
    pending.resolve(frame);
  }

  #disconnect() {
    this.#generation += 1;
    for (const pending of this.#pending.values()) {
      pending.reject(new Error("Host disconnected before the remote access request completed"));
    }
    this.#pending.clear();
  }
}

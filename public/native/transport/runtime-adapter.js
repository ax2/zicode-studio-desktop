export function resolveHostWebSocketUrl(env = globalThis.window || globalThis) {
  const location = env?.location || globalThis.location;
  const protocol = location?.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location?.host}/v2/ws`;
}

export class HostRuntimeAdapter {
  #WebSocketImpl;
  #clientId;
  #clientType;
  #connected = false;
  #connectionListeners = new Set();
  #deviceToken;
  #fatalErrorListeners = new Set();
  #nextSubscriptionId = 1;
  #receivers = new Set();
  #readyWaiters = [];
  #reconnectAttempts = 0;
  #reconnectBaseDelayMs;
  #reconnectMaxDelayMs;
  #reconnectTimer = null;
  #shouldReconnect = false;
  #subscriptions = new Map();
  #url;
  #socket = null;

  constructor({
    url,
    WebSocketImpl = globalThis.WebSocket,
    clientId,
    clientType = "desktop",
    deviceToken,
    reconnectBaseDelayMs = 250,
    reconnectMaxDelayMs = 5000,
  }) {
    if (!url || !clientId) throw new Error("HostRuntimeAdapter requires url and clientId");
    if (!WebSocketImpl) throw new Error("WebSocket is unavailable");
    this.#url = url;
    this.#WebSocketImpl = WebSocketImpl;
    this.#clientId = clientId;
    this.#clientType = clientType;
    this.#deviceToken = deviceToken;
    this.#reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.#reconnectMaxDelayMs = reconnectMaxDelayMs;
  }

  setReceiver(listener) {
    this.#receivers.add(listener);
    return () => this.#receivers.delete(listener);
  }

  setConnectionListener(listener) {
    this.#connectionListeners.add(listener);
    return () => this.#connectionListeners.delete(listener);
  }

  setFatalErrorListener(listener) {
    this.#fatalErrorListeners.add(listener);
    return () => this.#fatalErrorListeners.delete(listener);
  }

  connect() {
    this.#shouldReconnect = true;
    this.#clearReconnectTimer();
    if (this.#socket && this.#socket.readyState < 2) return;
    const socket = new this.#WebSocketImpl(this.#url);
    this.#socket = socket;
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: 2,
          clientType: this.#clientType,
          clientId: this.#clientId,
          ...(this.#clientType === "remote" && this.#deviceToken
            ? { deviceToken: this.#deviceToken }
            : {}),
        }),
      );
    };
    socket.onmessage = ({ data }) => {
      let frame;
      try {
        frame = JSON.parse(data);
      } catch {
        this.#receive({
          type: "error",
          error: { code: "invalid_json", message: "Host returned invalid JSON" },
        });
        return;
      }
      if (frame.type === "hello_ack") {
        if (frame.protocolVersion !== 2) {
          socket.close();
          return;
        }
        this.#connected = true;
        this.#reconnectAttempts = 0;
        for (const target of this.#subscriptions.values()) this.#sendSubscription(target);
        for (const listener of this.#connectionListeners) listener(true);
        for (const resolve of this.#readyWaiters.splice(0)) resolve();
        return;
      }
      if (
        this.#clientType === "remote" &&
        ["unauthorized_device", "device_access_revoked", "remote_auth_required"].includes(
          frame?.error?.code,
        )
      ) {
        this.#shouldReconnect = false;
        this.#clearReconnectTimer();
        const error = new Error(frame.error.message || "Remote device access was rejected");
        error.code =
          frame.error.code === "device_access_revoked"
            ? "device_access_revoked"
            : "device_pairing_required";
        for (const listener of this.#fatalErrorListeners) listener(error);
        this.#receive(frame);
        socket.close();
        return;
      }
      if (frame.type === "runtime_subscribed") return;
      this.#receive(frame);
    };
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#connected = false;
      for (const listener of this.#connectionListeners) listener(false);
      this.#scheduleReconnect();
    };
    socket.onerror = () => {};
  }

  disconnect() {
    this.#shouldReconnect = false;
    this.#clearReconnectTimer();
    this.#socket?.close();
  }

  /**
   * Replace a connection that may have gone stale while a mobile browser was
   * suspended. A connection already being established is left alone, and a
   * fatal remote-auth rejection cannot be bypassed by lifecycle events.
   */
  reconnectNow() {
    if (!this.#shouldReconnect) return false;
    if (!this.#connected && this.#socket?.readyState < 2) return false;
    this.#clearReconnectTimer();
    const socket = this.#socket;
    this.#socket = null;
    if (this.#connected) {
      this.#connected = false;
      for (const listener of this.#connectionListeners) listener(false);
    }
    if (socket?.readyState < 2) socket.close();
    this.connect();
    return true;
  }

  ready() {
    if (this.#connected) return Promise.resolve();
    return new Promise((resolve) => this.#readyWaiters.push(resolve));
  }

  isConnected() {
    return this.#connected && this.#isSocketOpen();
  }

  send(frame) {
    if (!this.#connected || !this.#isSocketOpen()) {
      this.#scheduleReconnect();
      throw new Error("ZiCode Studio Desktop Host runtime is disconnected");
    }
    this.#socket.send(JSON.stringify(frame));
  }

  subscribeTarget(target) {
    const key = `${target.workspaceId}\u0000${target.sessionId}\u0000${target.instanceId}`;
    if (this.#subscriptions.has(key)) return;
    this.#subscriptions.set(key, structuredClone(target));
    if (this.#connected) this.#sendSubscription(target);
  }

  #sendSubscription(target) {
    if (!this.#isSocketOpen()) return;
    this.#socket.send(
      JSON.stringify({
        type: "runtime_subscribe",
        requestId: `subscribe-${this.#nextSubscriptionId++}`,
        target,
      }),
    );
  }

  #isSocketOpen() {
    return this.#socket?.readyState === 1;
  }

  #scheduleReconnect() {
    if (!this.#shouldReconnect || this.#reconnectTimer) return;
    const delay = Math.min(
      this.#reconnectBaseDelayMs * 2 ** this.#reconnectAttempts,
      this.#reconnectMaxDelayMs,
    );
    this.#reconnectAttempts += 1;
    this.#reconnectTimer = globalThis.setTimeout(() => {
      this.#reconnectTimer = null;
      this.connect();
    }, delay);
  }

  #clearReconnectTimer() {
    if (!this.#reconnectTimer) return;
    globalThis.clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #receive(frame) {
    for (const receiver of this.#receivers) receiver(frame);
  }
}

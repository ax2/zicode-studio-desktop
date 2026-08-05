import {
  base64ToBytes,
  e2eeFrame,
  handshakeFrame,
  NoiseXkInitiator,
  parseE2eeFrame,
  parseHandshakeFrame,
} from "./e2ee.js";
import { isP2pSignalFrame, P2P_STATE, P2pTransport } from "./p2p.js";

export function resolveHostWebSocketUrl(env = globalThis.window || globalThis) {
  const location = env?.location || globalThis.location;
  const protocol = location?.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location?.host}/v2/ws`;
}

export class HostRuntimeAdapter {
  #WebSocketImpl;
  #clientId;
  #clientType;
  #e2eePublicKey;
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
  #e2ee = null;
  #url;
  #socket = null;
  #p2pEnabled = false;
  #iceServers = [];
  #P2pTransportImpl = P2pTransport;
  #RTCPeerConnectionImpl;
  #p2p = null;
  #p2pConnected = false;
  #p2pUnavailable = false;
  #p2pRetryDelayMs = 60_000;
  #p2pMaxAttempts = 5;
  #p2pAttempts = 0;
  #p2pRetryTimer = null;
  #p2pListeners = new Set();

  constructor({
    url,
    WebSocketImpl = globalThis.WebSocket,
    clientId,
    clientType = "desktop",
    deviceToken,
    e2eePublicKey,
    reconnectBaseDelayMs = 250,
    reconnectMaxDelayMs = 5000,
    p2pEnabled = false,
    iceServers = [],
    P2pTransportImpl = P2pTransport,
    RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
    p2pRetryDelayMs = 60_000,
    p2pMaxAttempts = 5,
  }) {
    if (!url || !clientId) throw new Error("HostRuntimeAdapter requires url and clientId");
    if (!WebSocketImpl) throw new Error("WebSocket is unavailable");
    this.#url = url;
    this.#WebSocketImpl = WebSocketImpl;
    this.#clientId = clientId;
    this.#clientType = clientType;
    this.#deviceToken = deviceToken;
    this.#e2eePublicKey = e2eePublicKey;
    this.#reconnectBaseDelayMs = reconnectBaseDelayMs;
    this.#reconnectMaxDelayMs = reconnectMaxDelayMs;
    this.#p2pEnabled = p2pEnabled;
    this.#iceServers = iceServers;
    this.#P2pTransportImpl = P2pTransportImpl;
    this.#RTCPeerConnectionImpl = RTCPeerConnectionImpl;
    this.#p2pRetryDelayMs = p2pRetryDelayMs;
    this.#p2pMaxAttempts = p2pMaxAttempts;
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

  setP2pListener(listener) {
    this.#p2pListeners.add(listener);
    return () => this.#p2pListeners.delete(listener);
  }

  connect() {
    this.#shouldReconnect = true;
    this.#clearReconnectTimer();
    if (this.#socket && this.#socket.readyState < 2) return;
    this.#e2ee = null;
    this.#teardownP2p();
    const socket = new this.#WebSocketImpl(this.#url);
    this.#socket = socket;
    socket.onopen = () => {
      if (this.#clientType === "remote" && this.#e2eePublicKey) {
        this.#e2ee = { initiator: new NoiseXkInitiator(base64ToBytes(this.#e2eePublicKey)) };
        socket.send(handshakeFrame(this.#e2ee.initiator.begin()));
        return;
      }
      this.#sendHello();
    };
    socket.onmessage = ({ data }) => {
      const text = String(data);
      if (this.#e2ee && !this.#e2ee.initiator.isReady()) {
        const handshake = parseHandshakeFrame(text);
        if (!handshake) {
          socket.close();
          return;
        }
        const response = this.#e2ee.initiator.advance(handshake);
        if (response) socket.send(handshakeFrame(response));
        if (!this.#e2ee.initiator.isReady()) return;
        this.#e2ee.ready = true;
        this.#sendHello();
        for (const target of this.#subscriptions.values()) this.#sendSubscription(target);
        return;
      }
      let plaintext = text;
      if (this.#e2ee?.ready) {
        const payload = parseE2eeFrame(text);
        if (!payload) {
          socket.close();
          return;
        }
        try {
          plaintext = new TextDecoder().decode(this.#e2ee.initiator.decrypt(payload));
        } catch {
          socket.close();
          return;
        }
      }
      let frame;
      try {
        frame = JSON.parse(plaintext);
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
        this.#p2pAttempts = 0;
        this.#clearP2pRetryTimer();
        for (const target of this.#subscriptions.values()) this.#sendSubscription(target);
        for (const listener of this.#connectionListeners) listener(true);
        for (const resolve of this.#readyWaiters.splice(0)) resolve();
        this.#startP2p();
        return;
      }
      if (
        this.#clientType === "remote" &&
        [
          "unauthorized_device",
          "device_access_revoked",
          "remote_auth_required",
          "desktop_offline",
        ].includes(frame?.error?.code)
      ) {
        this.#shouldReconnect = false;
        this.#clearReconnectTimer();
        const error = new Error(frame.error.message || "Remote device access was rejected");
        error.code =
          frame.error.code === "device_access_revoked"
            ? "device_access_revoked"
            : frame.error.code === "desktop_offline"
              ? "desktop_offline"
              : "device_pairing_required";
        for (const listener of this.#fatalErrorListeners) listener(error);
        this.#receive(frame);
        socket.close();
        return;
      }
      if (frame.type === "runtime_subscribed") return;
      if (this.#handleP2pFrame(frame)) return;
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
    this.#teardownP2p();
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

  isP2pConnected() {
    return this.#p2pConnected;
  }

  send(frame) {
    if (!this.#connected || !this.#isSocketOpen()) {
      this.#scheduleReconnect();
      throw new Error("ZiCode Studio Desktop Host runtime is disconnected");
    }
    if (this.#p2pConnected && this.#p2p) {
      if (this.#p2p.send(JSON.stringify(frame))) return;
      // The data channel went away; fall back to the WebSocket for this frame.
      this.#p2pConnected = false;
      this.#emitP2pState();
    }
    this.#sendText(JSON.stringify(frame));
  }

  subscribeTarget(target) {
    const key = `${target.workspaceId}\u0000${target.sessionId}\u0000${target.instanceId}`;
    if (this.#subscriptions.has(key)) return;
    this.#subscriptions.set(key, structuredClone(target));
    if (this.#connected) this.#sendSubscription(target);
  }

  #sendSubscription(target) {
    if (!this.#isSocketOpen()) return;
    this.#sendText(
      JSON.stringify({
        type: "runtime_subscribe",
        requestId: `subscribe-${this.#nextSubscriptionId++}`,
        target,
      }),
    );
  }

  #sendHello() {
    if (!this.#isSocketOpen()) return;
    this.#sendText(
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
  }

  #sendText(text) {
    if (!this.#isSocketOpen()) return;
    if (this.#e2ee?.ready) {
      this.#socket.send(e2eeFrame(this.#e2ee.initiator.encrypt(new TextEncoder().encode(text))));
      return;
    }
    this.#socket.send(text);
  }

  #isSocketOpen() {
    return this.#socket?.readyState === 1;
  }

  /**
   * M2 P2P: as the offerer, negotiate a WebRTC DataChannel with the desktop
   * after `hello_ack`. Signaling rides this WebSocket; once the channel is
   * open, runtime frames travel over it and the WebSocket stays as the
   * control/fallback path. Failure (including an old gateway that rejects
   * the offer) silently keeps the WebSocket data path.
   */
  #startP2p() {
    if (!this.#p2pEnabled || this.#p2pUnavailable || this.#p2p) return;
    if (typeof this.#P2pTransportImpl !== "function") return;
    try {
      const transport = new this.#P2pTransportImpl({
        signal: (frame) => this.#sendText(JSON.stringify(frame)),
        onData: (data) => this.#receiveP2pData(data),
        onState: (state) => {
          this.#p2pConnected = state === P2P_STATE.CONNECTED;
          if (state === P2P_STATE.CONNECTED) {
            this.#p2pAttempts = 0;
          } else if (state === P2P_STATE.FAILED) {
            this.#p2pConnected = false;
            this.#scheduleP2pRetry();
          } else if (state === P2P_STATE.CLOSED) {
            this.#p2pConnected = false;
          }
          this.#emitP2pState();
        },
        iceServers: this.#iceServers,
        RTCPeerConnectionImpl: this.#RTCPeerConnectionImpl,
      });
      this.#p2p = transport;
      transport.start();
    } catch {
      this.#p2pUnavailable = true;
      this.#p2p = null;
    }
  }

  /**
   * Consume inbound frames that belong to the P2P control plane: signaling
   * frames feed the transport, and a rejected offer (old gateway) disables
   * P2P for this session. Returns true when the frame was consumed.
   */
  #handleP2pFrame(frame) {
    if (isP2pSignalFrame(frame)) {
      if (this.#p2p && !this.#p2pUnavailable) {
        this.#p2p.handleSignal(frame);
        if (frame.type === "p2p_close") this.#p2pConnected = false;
      }
      return true;
    }
    if (
      this.#p2p &&
      !this.#p2pConnected &&
      frame?.type === "error" &&
      !frame.requestId &&
      ["unsupported_runtime_request", "p2p_unavailable", "p2p_signal_failed"].includes(
        frame?.error?.code,
      )
    ) {
      // The desktop side does not support P2P; keep the WebSocket data path.
      this.#p2pUnavailable = true;
      this.#p2p = null;
      this.#p2pConnected = false;
      this.#emitP2pState();
      this.#clearP2pRetryTimer();
      return true;
    }
    return false;
  }

  #receiveP2pData(data) {
    let text;
    if (typeof data === "string") {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (data && typeof data.byteLength === "number") {
      text = new TextDecoder().decode(data);
    } else {
      return;
    }
    let frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    this.#receive(frame);
  }

  #teardownP2p() {
    this.#clearP2pRetryTimer();
    if (this.#p2p) {
      try {
        this.#p2p.close();
      } catch {
        // already closed
      }
    }
    this.#p2p = null;
    this.#p2pConnected = false;
    this.#emitP2pState();
  }

  /**
   * Re-attempt P2P after a failure (for example the phone moved to the same
   * LAN) with a bounded number of tries. A rejected offer disables P2P for
   * the session, so this never hammers an old gateway.
   */
  #scheduleP2pRetry() {
    if (this.#p2pUnavailable || !this.#connected || this.#p2pRetryTimer) return;
    this.#p2pAttempts += 1;
    if (this.#p2pAttempts > this.#p2pMaxAttempts) return;
    if (this.#p2p) {
      try {
        this.#p2p.close();
      } catch {
        // already closed
      }
      this.#p2p = null;
    }
    this.#p2pRetryTimer = globalThis.setTimeout(() => {
      this.#p2pRetryTimer = null;
      this.#startP2p();
    }, this.#p2pRetryDelayMs);
  }

  #clearP2pRetryTimer() {
    if (this.#p2pRetryTimer) {
      globalThis.clearTimeout(this.#p2pRetryTimer);
      this.#p2pRetryTimer = null;
    }
  }

  #emitP2pState() {
    for (const listener of this.#p2pListeners) listener(this.#p2pConnected);
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

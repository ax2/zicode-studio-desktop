import { describe, expect, it, vi } from "vitest";
import {
  bytesToBase64,
  e2eeFrame,
  generateX25519KeyPair,
  handshakeFrame,
  NoiseXkResponder,
  parseE2eeFrame,
  parseHandshakeFrame,
  utf8Bytes,
} from "./e2ee.js";
import { HostRuntimeAdapter } from "./runtime-adapter.js";
import { RuntimeGateway } from "./runtime-gateway.js";

class FakeWebSocket {
  static OPEN = 1;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

class FakeP2pTransport {
  static instances = [];

  constructor({ signal, onData, onState }) {
    this.signal = signal;
    this.onData = onData;
    this.onState = onState;
    this.handled = [];
    this.sentData = [];
    this.sendResult = true;
    this.closed = false;
    FakeP2pTransport.instances.push(this);
  }

  start() {
    this.signal({ type: "p2p_offer", sdp: "offer-sdp" });
  }

  handleSignal(frame) {
    this.handled.push(frame);
  }

  send(data) {
    this.sentData.push(data);
    return this.sendResult;
  }

  close() {
    this.closed = true;
  }

  emitConnected() {
    this.onState("connected");
  }

  emitFailed() {
    this.onState("failed");
  }

  emitData(text) {
    this.onData(text);
  }
}

const target = {
  workspaceId: "workspace-a",
  sessionId: "session-a",
  instanceId: "instance-a",
};

describe("HostRuntimeAdapter", () => {
  it("performs v2 handshake, subscribes by opaque target, and forwards frames", async () => {
    FakeWebSocket.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://127.0.0.1:9000/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "desktop-a",
    });
    const gateway = new RuntimeGateway(adapter);
    const events = [];
    gateway.subscribe((event) => events.push(event));
    adapter.connect();
    expect(adapter.isConnected()).toBe(false);
    const socket = FakeWebSocket.instances[0];
    socket.open();
    expect(socket.sent[0]).toEqual({
      type: "hello",
      protocolVersion: 2,
      clientType: "desktop",
      clientId: "desktop-a",
    });
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    expect(adapter.isConnected()).toBe(true);

    const pending = gateway.request({ type: "prompt", message: "hello" }, target, {
      idempotencyKey: "intent-1",
    });
    expect(socket.sent[1]).toMatchObject({ type: "runtime_subscribe", target });
    const request = socket.sent[2];
    expect(request).toMatchObject({ type: "runtime_request", target });
    socket.receive({
      type: "runtime_response",
      requestId: request.requestId,
      acceptance: "accepted",
      response: { success: true },
    });
    await expect(pending).resolves.toMatchObject({ acceptance: "accepted" });

    socket.receive({ type: "runtime_event", target, sequence: 1, event: { type: "agent_start" } });
    expect(events).toHaveLength(1);
  });

  it("sends a remote device token only in hello and resubscribes after reconnect", () => {
    FakeWebSocket.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://host/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientType: "remote",
      clientId: "phone",
      deviceToken: "device-secret",
    });
    adapter.setReceiver(() => {});
    adapter.setConnectionListener(() => {});
    adapter.connect();
    let socket = FakeWebSocket.instances[0];
    socket.open();
    expect(socket.sent[0].deviceToken).toBe("device-secret");
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    adapter.subscribeTarget(target);
    expect(JSON.stringify(socket.sent.slice(1))).not.toContain("device-secret");

    socket.close();
    adapter.connect();
    socket = FakeWebSocket.instances[1];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    expect(socket.sent[1]).toMatchObject({ type: "runtime_subscribe", target });
  });

  it("automatically reconnects and resubscribes when the host socket closes", async () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.instances.length = 0;
      const adapter = new HostRuntimeAdapter({
        url: "ws://host/v2/ws",
        WebSocketImpl: FakeWebSocket,
        clientId: "desktop-a",
        reconnectBaseDelayMs: 10,
      });
      adapter.connect();
      let socket = FakeWebSocket.instances[0];
      socket.open();
      socket.receive({ type: "hello_ack", protocolVersion: 2 });
      adapter.subscribeTarget(target);

      socket.close();
      await vi.advanceTimersByTimeAsync(10);
      expect(FakeWebSocket.instances).toHaveLength(2);

      socket = FakeWebSocket.instances[1];
      socket.open();
      expect(socket.sent[0]).toMatchObject({ type: "hello", clientId: "desktop-a" });
      socket.receive({ type: "hello_ack", protocolVersion: 2 });
      expect(socket.sent[1]).toMatchObject({ type: "runtime_subscribe", target });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops reconnecting and reports a revoked remote device", async () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.instances.length = 0;
      const adapter = new HostRuntimeAdapter({
        url: "wss://host/v2/ws",
        WebSocketImpl: FakeWebSocket,
        clientType: "remote",
        clientId: "phone",
        deviceToken: "device-secret",
        reconnectBaseDelayMs: 10,
      });
      const fatal = vi.fn();
      adapter.setFatalErrorListener(fatal);
      adapter.connect();
      const socket = FakeWebSocket.instances[0];
      socket.open();
      socket.receive({
        type: "error",
        error: { code: "device_access_revoked", message: "Access revoked" },
      });

      expect(fatal).toHaveBeenCalledWith(
        expect.objectContaining({ code: "device_access_revoked" }),
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a remote desktop that went offline with a clear code", async () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.instances.length = 0;
      const adapter = new HostRuntimeAdapter({
        url: "wss://host/v2/ws",
        WebSocketImpl: FakeWebSocket,
        clientType: "remote",
        clientId: "phone",
        deviceToken: "device-secret",
        reconnectBaseDelayMs: 10,
      });
      const fatal = vi.fn();
      adapter.setFatalErrorListener(fatal);
      adapter.connect();
      const socket = FakeWebSocket.instances[0];
      socket.open();
      socket.receive({
        type: "error",
        error: { code: "desktop_offline", message: "ZiCode Studio Desktop is offline" },
      });

      expect(fatal).toHaveBeenCalledWith(expect.objectContaining({ code: "desktop_offline" }));
      await vi.advanceTimersByTimeAsync(100);
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores target subscriptions before announcing a connected transport", () => {
    FakeWebSocket.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://host/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "desktop-a",
    });
    adapter.subscribeTarget(target);
    adapter.setConnectionListener((connected) => {
      if (connected) {
        FakeWebSocket.instances[0].send(JSON.stringify({ type: "listener_ready_probe" }));
      }
    });

    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });

    expect(socket.sent[1]).toMatchObject({ type: "runtime_subscribe", target });
    expect(socket.sent[2]).toEqual({ type: "listener_ready_probe" });
  });

  it("replaces a stale foreground connection and restores subscriptions exactly once", async () => {
    vi.useFakeTimers();
    try {
      FakeWebSocket.instances.length = 0;
      const adapter = new HostRuntimeAdapter({
        url: "wss://host/v2/ws",
        WebSocketImpl: FakeWebSocket,
        clientType: "remote",
        clientId: "phone",
        deviceToken: "device-secret",
        reconnectBaseDelayMs: 10,
      });
      const connectionStates = [];
      adapter.setConnectionListener((connected) => connectionStates.push(connected));
      adapter.connect();
      const staleSocket = FakeWebSocket.instances[0];
      staleSocket.open();
      staleSocket.receive({ type: "hello_ack", protocolVersion: 2 });
      adapter.subscribeTarget(target);

      expect(adapter.reconnectNow()).toBe(true);
      expect(staleSocket.readyState).toBe(3);
      expect(connectionStates).toEqual([true, false]);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(adapter.reconnectNow()).toBe(false);

      const replacement = FakeWebSocket.instances[1];
      replacement.open();
      replacement.receive({ type: "hello_ack", protocolVersion: 2 });
      expect(replacement.sent[1]).toMatchObject({ type: "runtime_subscribe", target });
      expect(connectionStates).toEqual([true, false, true]);
      await vi.advanceTimersByTimeAsync(100);
      expect(FakeWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reconnect a remote device after fatal authorization rejection", () => {
    FakeWebSocket.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "wss://host/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientType: "remote",
      clientId: "phone",
      deviceToken: "device-secret",
    });
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({
      type: "error",
      error: { code: "device_access_revoked", message: "Access revoked" },
    });

    expect(adapter.reconnectNow()).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("performs the E2EE handshake and exchanges encrypted frames", async () => {
    FakeWebSocket.instances.length = 0;
    const desktopKey = generateX25519KeyPair();
    const adapter = new HostRuntimeAdapter({
      url: "wss://host/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientType: "remote",
      clientId: "phone",
      deviceToken: "device-secret",
      e2eePublicKey: bytesToBase64(desktopKey.publicKey),
    });
    const gateway = new RuntimeGateway(adapter);
    const events = [];
    gateway.subscribe((event) => events.push(event));
    adapter.connect();

    const socket = FakeWebSocket.instances[0];
    socket.open();

    // 第一帧必须是 e2ee_handshake，而不是明文 hello。
    const firstFrame = JSON.stringify(socket.sent[0]);
    expect(socket.sent[0].type).toBe("e2ee_handshake");
    const responder = new NoiseXkResponder(desktopKey);
    const second = responder.accept(parseHandshakeFrame(firstFrame));
    socket.receive(JSON.parse(handshakeFrame(second)));

    // 第三帧仍是握手；随后 adapter 立即发送加密 hello（中继按序转发）。
    const thirdFrame = JSON.stringify(socket.sent[1]);
    expect(socket.sent[1].type).toBe("e2ee_handshake");
    responder.finish(parseHandshakeFrame(thirdFrame));

    const helloFrame = JSON.stringify(socket.sent[2]);
    expect(socket.sent[2].type).toBe("e2ee_frame");
    const helloPlaintext = new TextDecoder().decode(responder.decrypt(parseE2eeFrame(helloFrame)));
    expect(JSON.parse(helloPlaintext)).toMatchObject({
      type: "hello",
      clientType: "remote",
      deviceToken: "device-secret",
    });

    // 桌面回包也是密文。
    socket.receive(
      JSON.parse(
        e2eeFrame(
          responder.encrypt(utf8Bytes(JSON.stringify({ type: "hello_ack", protocolVersion: 2 }))),
        ),
      ),
    );
    await vi.waitFor(() => expect(adapter.isConnected()).toBe(true));

    // 会话消息双向都走密文帧。
    adapter.subscribeTarget(target);
    const subscribeFrame = JSON.stringify(socket.sent.at(-1));
    const subscribePlaintext = new TextDecoder().decode(
      responder.decrypt(parseE2eeFrame(subscribeFrame)),
    );
    expect(JSON.parse(subscribePlaintext)).toMatchObject({ type: "runtime_subscribe" });

    socket.receive(
      JSON.parse(
        e2eeFrame(responder.encrypt(utf8Bytes(JSON.stringify({ type: "runtime_event" })))),
      ),
    );
    await vi.waitFor(() => expect(events).toContainEqual({ type: "runtime_event" }));
  });

  it("negotiates P2P after hello_ack and sends the offer over the WebSocket", () => {
    FakeWebSocket.instances.length = 0;
    FakeP2pTransport.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://127.0.0.1:9000/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "phone-a",
      clientType: "remote",
      deviceToken: "token-a",
      p2pEnabled: true,
      P2pTransportImpl: FakeP2pTransport,
    });
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });

    expect(FakeP2pTransport.instances).toHaveLength(1);
    const transport = FakeP2pTransport.instances[0];
    expect(socket.sent.at(-1)).toEqual({ type: "p2p_offer", sdp: "offer-sdp" });
    expect(transport.closed).toBe(false);
  });

  it("routes p2p signaling frames to the transport without reaching the app", () => {
    FakeWebSocket.instances.length = 0;
    FakeP2pTransport.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://127.0.0.1:9000/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "phone-a",
      clientType: "remote",
      deviceToken: "token-a",
      p2pEnabled: true,
      P2pTransportImpl: FakeP2pTransport,
    });
    const events = [];
    adapter.setReceiver((frame) => events.push(frame));
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    const transport = FakeP2pTransport.instances[0];

    socket.receive({ type: "p2p_answer", sdp: "answer-sdp" });
    socket.receive({ type: "p2p_ice", candidate: { candidate: "cand" } });
    expect(transport.handled).toHaveLength(2);
    expect(events).toHaveLength(0);
  });

  it("switches runtime frames and events to the DataChannel once connected", () => {
    FakeWebSocket.instances.length = 0;
    FakeP2pTransport.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://127.0.0.1:9000/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "phone-a",
      clientType: "remote",
      deviceToken: "token-a",
      p2pEnabled: true,
      P2pTransportImpl: FakeP2pTransport,
    });
    const events = [];
    adapter.setReceiver((frame) => events.push(frame));
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    const transport = FakeP2pTransport.instances[0];
    transport.emitConnected();
    expect(adapter.isP2pConnected()).toBe(true);

    const before = socket.sent.length;
    adapter.send({ type: "runtime_request", requestId: "r1" });
    expect(socket.sent.length).toBe(before);
    expect(transport.sentData.at(-1)).toBe(
      JSON.stringify({ type: "runtime_request", requestId: "r1" }),
    );

    transport.emitData(JSON.stringify({ type: "runtime_response", requestId: "r1" }));
    expect(events).toContainEqual({ type: "runtime_response", requestId: "r1" });
  });

  it("falls back to the WebSocket when the P2P channel is unavailable", () => {
    FakeWebSocket.instances.length = 0;
    FakeP2pTransport.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://127.0.0.1:9000/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "phone-a",
      clientType: "remote",
      deviceToken: "token-a",
      p2pEnabled: true,
      P2pTransportImpl: FakeP2pTransport,
    });
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    const transport = FakeP2pTransport.instances[0];

    transport.emitFailed();
    adapter.send({ type: "runtime_request", requestId: "r1" });
    expect(socket.sent.at(-1)).toEqual({ type: "runtime_request", requestId: "r1" });

    transport.emitConnected();
    transport.sendResult = false;
    adapter.send({ type: "runtime_request", requestId: "r2" });
    expect(socket.sent.at(-1)).toEqual({ type: "runtime_request", requestId: "r2" });
    expect(adapter.isP2pConnected()).toBe(false);
  });

  it("disables P2P when an old gateway rejects the offer", () => {
    FakeWebSocket.instances.length = 0;
    FakeP2pTransport.instances.length = 0;
    const adapter = new HostRuntimeAdapter({
      url: "ws://127.0.0.1:9000/v2/ws",
      WebSocketImpl: FakeWebSocket,
      clientId: "phone-a",
      clientType: "remote",
      deviceToken: "token-a",
      p2pEnabled: true,
      P2pTransportImpl: FakeP2pTransport,
    });
    const events = [];
    adapter.setReceiver((frame) => events.push(frame));
    adapter.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    expect(FakeP2pTransport.instances).toHaveLength(1);

    socket.receive({
      type: "error",
      error: { code: "unsupported_runtime_request", message: "unsupported" },
    });
    adapter.send({ type: "runtime_request", requestId: "r1" });
    expect(socket.sent.at(-1)).toEqual({ type: "runtime_request", requestId: "r1" });
    expect(events).toHaveLength(0);

    // A reconnect does not re-attempt P2P on this session.
    socket.receive({ type: "hello_ack", protocolVersion: 2 });
    expect(FakeP2pTransport.instances).toHaveLength(1);
  });
});

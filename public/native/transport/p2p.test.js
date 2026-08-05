import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isP2pSignalFrame, P2P_STATE, P2pTransport } from "./p2p.js";

class FakeDataChannel {
  constructor(label) {
    this.label = label;
    this.readyState = "connecting";
    this.sent = [];
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.readyState = "closed";
  }

  emitOpen() {
    this.readyState = "open";
    this.onopen?.();
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }
}

class FakePeerConnection {
  static instances = [];

  constructor() {
    this.connectionState = "new";
    this.localDescription = null;
    this.remoteDescription = null;
    this.remoteCandidates = [];
    this.closed = false;
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(label) {
    this.dc = new FakeDataChannel(label);
    return this.dc;
  }

  async createOffer() {
    return { type: "offer", sdp: "offer-sdp" };
  }

  async createAnswer() {
    return { type: "answer", sdp: "answer-sdp" };
  }

  async setLocalDescription(description) {
    this.localDescription = description;
  }

  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate) {
    this.remoteCandidates.push(candidate);
  }

  close() {
    this.closed = true;
    this.connectionState = "closed";
    this.onconnectionstatechange?.();
  }

  emitConnectionState(state) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  emitCandidate(candidate) {
    this.onicecandidate?.({ candidate });
  }
}

function makeTransport(options = {}) {
  const signals = [];
  const states = [];
  const messages = [];
  const transportInstance = new P2pTransport({
    signal: (frame) => signals.push(frame),
    onData: (data) => messages.push(data),
    onState: (state, detail) => states.push({ state, detail }),
    RTCPeerConnectionImpl: FakePeerConnection,
    ...options,
  });
  return { transport: transportInstance, signals, states, messages };
}

beforeEach(() => {
  FakePeerConnection.instances.length = 0;
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("P2P transport signaling", () => {
  it("offerer sends a p2p_offer with the local SDP", async () => {
    const { transport, signals, states } = makeTransport();
    transport.start();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(transport.getState()).toBe(P2P_STATE.NEGOTIATING);
    expect(states[0].state).toBe(P2P_STATE.NEGOTIATING);
    expect(signals[0]).toMatchObject({ type: "p2p_offer", sdp: "offer-sdp" });
  });

  it("answerer replies with a p2p_answer and sends candidates once remote is set", async () => {
    const { transport, signals } = makeTransport();
    transport.handleSignal({ type: "p2p_offer", sdp: "offer-sdp" });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    expect(transport.getState()).toBe(P2P_STATE.NEGOTIATING);
    expect(pc.remoteDescription).toEqual({ type: "offer", sdp: "offer-sdp" });
    expect(signals[0]).toMatchObject({ type: "p2p_answer", sdp: "answer-sdp" });

    pc.emitCandidate({ toJSON: () => ({ candidate: "local-1" }) });
    expect(signals.some((frame) => frame.type === "p2p_ice")).toBe(true);
    expect(pc.remoteCandidates).toHaveLength(0);
  });

  it("offerer buffers local candidates until the answer arrives", async () => {
    const { transport, signals } = makeTransport();
    transport.start();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    pc.emitCandidate({ toJSON: () => ({ candidate: "local-1" }) });
    expect(signals.some((frame) => frame.type === "p2p_ice")).toBe(false);

    transport.handleSignal({ type: "p2p_answer", sdp: "answer-sdp" });
    await vi.waitFor(() =>
      expect(signals.some((frame) => frame.type === "p2p_ice")).toBe(true),
    );
    expect(pc.remoteCandidates).toHaveLength(0);
  });

  it("buffers remote candidates received before the offer is accepted", async () => {
    const { transport } = makeTransport();
    transport.handleSignal({ type: "p2p_ice", candidate: { candidate: "early-1" } });
    transport.handleSignal({ type: "p2p_offer", sdp: "offer-sdp" });
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    expect(pc.remoteCandidates).toEqual([{ candidate: "early-1" }]);
  });

  it("reports connected and forwards data channel messages", async () => {
    const { transport, states, messages } = makeTransport();
    transport.start();
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    pc.dc.emitOpen();
    expect(transport.getState()).toBe(P2P_STATE.CONNECTED);
    expect(states.some((entry) => entry.state === P2P_STATE.CONNECTED)).toBe(true);

    pc.dc.emitMessage("hello from desktop");
    expect(messages).toEqual(["hello from desktop"]);
    expect(transport.send("reply")).toBe(true);
    expect(pc.dc.sent).toEqual(["reply"]);
  });

  it("refuses to send before the channel is open", async () => {
    const { transport } = makeTransport();
    transport.start();
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    expect(transport.send("early")).toBe(false);
  });

  it("fails after the negotiation timeout so the caller can fall back", () => {
    vi.useFakeTimers();
    const { transport, states } = makeTransport();
    transport.start();
    vi.advanceTimersByTime(15_000);
    expect(transport.getState()).toBe(P2P_STATE.FAILED);
    expect(states.at(-1)).toMatchObject({ state: P2P_STATE.FAILED, detail: "negotiation timeout" });
  });

  it("reports failure when the peer connection fails", async () => {
    const { transport, states } = makeTransport();
    transport.start();
    await vi.waitFor(() => expect(FakePeerConnection.instances).toHaveLength(1));
    FakePeerConnection.instances[0].emitConnectionState("failed");
    expect(transport.getState()).toBe(P2P_STATE.FAILED);
    expect(states.at(-1).state).toBe(P2P_STATE.FAILED);
  });

  it("closes cleanly and stops accepting signals", async () => {
    const { transport, signals } = makeTransport();
    transport.start();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    const pc = FakePeerConnection.instances[0];
    transport.close();
    expect(pc.closed).toBe(true);
    expect(transport.getState()).toBe(P2P_STATE.CLOSED);
    transport.handleSignal({ type: "p2p_answer", sdp: "x" });
    expect(signals).toHaveLength(1);
  });

  it("recognizes only the P2P signaling frame types", () => {
    expect(isP2pSignalFrame({ type: "p2p_offer" })).toBe(true);
    expect(isP2pSignalFrame({ type: "p2p_ice", candidate: {} })).toBe(true);
    expect(isP2pSignalFrame({ type: "runtime_event" })).toBe(false);
    expect(isP2pSignalFrame(null)).toBe(false);
  });

  it("requires WebRTC support", () => {
    expect(() => makeTransport({ RTCPeerConnectionImpl: null })).toThrow(/RTCPeerConnection/);
  });
});

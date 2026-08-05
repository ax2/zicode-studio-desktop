// M2 P2P data transport (WebRTC DataChannel).
//
// Signaling rides the existing authenticated runtime WebSocket as
// `p2p_offer` / `p2p_answer` / `p2p_ice` frames, so the rendezvous relay
// stays a pure transport and the desktop remains the authentication
// authority. WebRTC DTLS encrypts the data channel in transit; because the
// desktop itself is the remote peer (not an untrusted middlebox), no
// additional app-layer encryption is needed on this path.
//
// The app keeps the M1 relay data path untouched: when the P2P connection
// fails or times out, the transport reports `failed` and the caller falls
// back to the existing runtime frames.

export const P2P_STATE = Object.freeze({
  IDLE: "idle",
  NEGOTIATING: "negotiating",
  CONNECTED: "connected",
  FAILED: "failed",
  CLOSED: "closed",
});

export const P2P_SIGNAL_TYPES = Object.freeze([
  "p2p_offer",
  "p2p_answer",
  "p2p_ice",
  "p2p_close",
]);

export function isP2pSignalFrame(frame) {
  return Boolean(frame && P2P_SIGNAL_TYPES.includes(frame.type));
}

const DEFAULT_NEGOTIATION_TIMEOUT_MS = 15_000;
const DEFAULT_LABEL = "zicode-p2p";

/**
 * One side of a WebRTC DataChannel connection. The phone is the offerer
 * (it dials out after pairing); the desktop answers. ICE servers are
 * configurable so STUN/TURN candidates can be injected once the server
 * deployment exists; without them the module still works for host
 * candidates (same LAN / loopback).
 */
export class P2pTransport {
  #RTCPeerConnectionImpl;
  #pc = null;
  #dc = null;
  #signal;
  #onData;
  #onState;
  #iceServers;
  #label;
  #negotiationTimeoutMs;
  #state = P2P_STATE.IDLE;
  #pendingLocalCandidates = [];
  #pendingRemoteCandidates = [];
  #negotiationTimer = null;
  #closed = false;

  constructor({
    signal,
    onData,
    onState,
    iceServers = [],
    label = DEFAULT_LABEL,
    negotiationTimeoutMs = DEFAULT_NEGOTIATION_TIMEOUT_MS,
    RTCPeerConnectionImpl = globalThis.RTCPeerConnection,
  }) {
    if (typeof signal !== "function") throw new Error("P2pTransport requires a signal function");
    if (typeof onData !== "function") throw new Error("P2pTransport requires an onData listener");
    if (!RTCPeerConnectionImpl) throw new Error("RTCPeerConnection is unavailable");
    this.#signal = signal;
    this.#onData = onData;
    this.#onState = onState ?? (() => {});
    this.#iceServers = iceServers;
    this.#label = label;
    this.#negotiationTimeoutMs = negotiationTimeoutMs;
    this.#RTCPeerConnectionImpl = RTCPeerConnectionImpl;
  }

  getState() {
    return this.#state;
  }

  /** Offerer entry point: create the data channel and send a p2p_offer. */
  start() {
    if (this.#closed || this.#state !== P2P_STATE.IDLE) return;
    this.#setState(P2P_STATE.NEGOTIATING);
    this.#createPeerConnection();
    this.#dc = this.#pc.createDataChannel(this.#label);
    this.#wireDataChannel(this.#dc);
    this.#armNegotiationTimer();
    this.#createAndSendOffer();
  }

  /** Handle an incoming signaling frame from the runtime channel. */
  handleSignal(frame) {
    if (this.#closed || !frame || !isP2pSignalFrame(frame)) return;
    if (this.#state === P2P_STATE.IDLE) {
      // Answerer entry: the first frame is the desktop's offer.
      if (frame.type === "p2p_ice") {
        // Candidates may be routed ahead of the offer; hold them until the
        // remote description is set.
        this.#queueRemoteCandidate(frame.candidate);
        return;
      }
      if (frame.type === "p2p_close") {
        this.close();
        return;
      }
      if (frame.type !== "p2p_offer") return;
      this.#setState(P2P_STATE.NEGOTIATING);
      this.#createPeerConnection();
      this.#pc.ondatachannel = (event) => this.#wireDataChannel(event.channel);
      this.#armNegotiationTimer();
      this.#acceptOffer(frame);
      return;
    }
    if (this.#state !== P2P_STATE.NEGOTIATING) return;
    if (frame.type === "p2p_answer") {
      this.#acceptAnswer(frame);
    } else if (frame.type === "p2p_ice") {
      this.#queueRemoteCandidate(frame.candidate);
    } else if (frame.type === "p2p_close") {
      this.close();
    }
  }

  send(data) {
    if (this.#state !== P2P_STATE.CONNECTED || this.#dc?.readyState !== "open") return false;
    this.#dc.send(data);
    return true;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearNegotiationTimer();
    if (this.#dc) {
      try {
        this.#dc.close();
      } catch {
        // already closed
      }
    }
    if (this.#pc) {
      try {
        this.#pc.close();
      } catch {
        // already closed
      }
    }
    this.#state = P2P_STATE.CLOSED;
    this.#onState(P2P_STATE.CLOSED);
  }

  #createPeerConnection() {
    this.#pc = new this.#RTCPeerConnectionImpl({ iceServers: this.#iceServers });
    this.#pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const candidate = event.candidate.toJSON?.() ?? event.candidate;
      if (this.#pc.remoteDescription) {
        this.#signal({ type: "p2p_ice", candidate });
      } else {
        this.#pendingLocalCandidates.push(candidate);
      }
    };
    this.#pc.onconnectionstatechange = () => {
      const state = this.#pc.connectionState;
      if (state === "connected") {
        this.#clearNegotiationTimer();
        this.#setState(P2P_STATE.CONNECTED);
      } else if (state === "failed") {
        this.#clearNegotiationTimer();
        this.#fail("peer connection failed");
      } else if (state === "closed" && !this.#closed) {
        this.#clearNegotiationTimer();
        this.#state = P2P_STATE.CLOSED;
        this.#onState(P2P_STATE.CLOSED);
      }
    };
  }

  #wireDataChannel(dc) {
    this.#dc = dc;
    dc.onopen = () => {
      if (this.#state === P2P_STATE.NEGOTIATING) {
        this.#clearNegotiationTimer();
        this.#setState(P2P_STATE.CONNECTED);
      }
    };
    dc.onmessage = (event) => this.#onData(event.data);
    dc.onclose = () => {
      if (!this.#closed && this.#state === P2P_STATE.CONNECTED) {
        this.#fail("data channel closed");
      }
    };
  }

  async #createAndSendOffer() {
    try {
      const offer = await this.#pc.createOffer();
      await this.#pc.setLocalDescription(offer);
      this.#signal({ type: "p2p_offer", sdp: offer.sdp });
    } catch (error) {
      this.#fail(`offer failed: ${error?.message || error}`);
    }
  }

  async #acceptOffer(frame) {
    try {
      await this.#pc.setRemoteDescription({ type: "offer", sdp: frame.sdp });
      this.#flushRemoteCandidates();
      const answer = await this.#pc.createAnswer();
      await this.#pc.setLocalDescription(answer);
      this.#signal({ type: "p2p_answer", sdp: answer.sdp });
      this.#flushLocalCandidates();
    } catch (error) {
      this.#fail(`answer failed: ${error?.message || error}`);
    }
  }

  async #acceptAnswer(frame) {
    try {
      await this.#pc.setRemoteDescription({ type: "answer", sdp: frame.sdp });
      this.#flushRemoteCandidates();
      this.#flushLocalCandidates();
    } catch (error) {
      this.#fail(`answer processing failed: ${error?.message || error}`);
    }
  }

  #queueRemoteCandidate(candidate) {
    if (!candidate) return;
    if (this.#pc?.remoteDescription) {
      this.#addRemoteCandidate(candidate);
    } else {
      this.#pendingRemoteCandidates.push(candidate);
    }
  }

  #addRemoteCandidate(candidate) {
    if (!this.#pc) return;
    this.#pc.addIceCandidate(candidate).catch(() => {
      // A candidate that no longer matches the negotiated description is
      // harmless; the connection still proceeds with the rest.
    });
  }

  #flushLocalCandidates() {
    const candidates = this.#pendingLocalCandidates.splice(0);
    for (const candidate of candidates) this.#signal({ type: "p2p_ice", candidate });
  }

  #flushRemoteCandidates() {
    const candidates = this.#pendingRemoteCandidates.splice(0);
    for (const candidate of candidates) this.#addRemoteCandidate(candidate);
  }

  #armNegotiationTimer() {
    this.#clearNegotiationTimer();
    this.#negotiationTimer = globalThis.setTimeout(() => {
      this.#negotiationTimer = null;
      if (this.#state === P2P_STATE.NEGOTIATING) {
        this.#fail("negotiation timeout");
      }
    }, this.#negotiationTimeoutMs);
  }

  #clearNegotiationTimer() {
    if (this.#negotiationTimer) {
      globalThis.clearTimeout(this.#negotiationTimer);
      this.#negotiationTimer = null;
    }
  }

  #setState(state) {
    if (this.#closed || this.#state === state) return;
    this.#state = state;
    this.#onState(state);
  }

  #fail(reason) {
    this.#clearNegotiationTimer();
    this.#state = P2P_STATE.FAILED;
    this.#onState(P2P_STATE.FAILED, reason);
  }
}

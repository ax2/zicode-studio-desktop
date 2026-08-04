# ADR 0006: Server rendezvous + relay architecture for productized mobile access

- Status: Proposed (2026-08-04)
- Date: 2026-08-04

## Context

ZiCode must let every user's phone reach their own desktop from the public internet.
The per-user tunnel built in round 106 (SSH reverse tunnel / frpc) works for the
developer but cannot scale to all users: it requires custom CA installs, firewall
configuration, and per-user servers. The product needs a zero-configuration model.

The product is local-first (ADR 0003): the desktop remains the only authority over
sessions, notes, files, and credentials. Cloud sync stays closed until end-to-end
encryption and conflict protocols exist (product roadmap M6 note). Any relay
architecture must therefore be a channel, not a store.

## Decision

Adopt a **server rendezvous + relay** architecture for productized remote access:

1. Both the desktop and the mobile app make **outbound** connections to a vendor
   rendezvous server (WSS). No inbound ports, NAT traversal, or firewall changes
   are required from users.
2. The server is **stateless for content**: routing, online status, pairing
   forwarding, and rate limiting only. It never persists conversations, files, or
   content keys.
3. Pairing reuses the existing one-time pairing token, device token, revocation,
   and rate-limiting model from `RemoteAuth`. The desktop remains the issuer of
   device credentials; the server only forwards.
4. The data plane evolves in phases:
   - M1: relay fallback over WSS (no E2EE, disclosed in the privacy policy);
   - M2: WebRTC P2P with STUN, TURN fallback;
   - M3: end-to-end encrypted data plane (WebRTC DTLS or Noise), so the server
     technically cannot read content.
5. The existing strict-authentication gateway semantics (no loopback bypass for
   tunneled peers, device token required) carry over: server-forwarded requests
   still authenticate at the desktop.
6. The mobile client is a WebView shell (Capacitor) around the existing
   `public/native` frontend, not a native UI rewrite.
7. The tunnel-based solution from round 106 stays as the developer/LAN path.

## Consequences

- Users get zero-configuration public access; both endpoints only dial out.
- The vendor operates a data channel: ICP filing, privacy policy, domestic nodes,
  and a telecom value-added service license assessment are required before
  commercial launch (see the detailed plan).
- E2EE (M3) is what reconciles the architecture with the local-first and
  "no cloud sync without E2EE" positions; M1/M2 must be explicit about disclosure.
- P2P (M2) is the primary bandwidth cost control; relay traffic is the fallback.

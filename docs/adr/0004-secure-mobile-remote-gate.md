# ADR 0004: Gate mobile remote access behind transport and route authorization

- Status: Accepted; LAN activation implemented behind an explicit switch
- Date: 2026-08-01

## Context

ZiCode now has a responsive phone interface and an existing pairing/token store, but the Host serves
conversations, workspace files, notes, artifacts, plugin operations, and runtime control from one
HTTP/WebSocket origin. Binding that origin to the LAN before every route is authenticated would let an
untrusted device bypass UI restrictions and call the Host directly. Plain HTTP would also expose
prompts, source code, pairing credentials, and device tokens in transit.

## Decision

The Host remains loopback-only by default. Encrypted LAN transport starts only after an explicit
desktop setting is enabled and the application restarts. These invariants are enforced:

1. A non-loopback WebSocket peer must identify as `remote` and present a valid paired-device token;
   claiming `desktop` is rejected.
2. Non-loopback HTTP requests to `/v2/*` require `Authorization: Bearer <device-token>`, except the
   minimal health endpoint, WebSocket upgrade, and one-time pairing exchange.
3. Only a local desktop client may create new pairing credentials. A remote device cannot pair more
   devices.
4. The browser adds its device token only to same-origin Host requests and never to model providers or
   other external origins.
5. Pairing-required, expired-link, and startup failures render a blocking, localized recovery screen
   instead of leaving the mobile client on an indefinite loading state.
6. Pairing exchange failures are rate-limited per peer address. Device identifiers are bounded and
   validated before they reach persistent storage.
7. The local Settings application lists paired and revoked devices without exposing token hashes.
   Revocation invalidates HTTP authentication immediately and closes an active remote WebSocket
   within five seconds; the remote client stops automatic reconnect and shows a recovery screen.
8. A stable local CA signs ephemeral server certificates for current private LAN addresses. The CA
   private key is stored only in the OS credential vault; a missing key/certificate half fails closed.
9. Remote WebSocket Origin must exactly match one of the advertised HTTPS origins. Missing Origin is
   accepted only from loopback peers.
10. A separate HTTP enrollment listener serves only setup instructions and the public CA certificate.
    The user must compare its fingerprint with the trusted desktop Settings page before installation.
11. Static assets may remain public, but no workspace or runtime data route bypasses the remote
    authorization gate.

The HTTP QR issuer enforces item 3 from the actual peer address in addition to normal device
authentication. A valid remote bearer token therefore cannot request either the certificate-setup QR
or a new one-time session QR.

## Consequences

- Responsive mobile work can continue without prematurely exposing the Host.
- Existing loopback desktop behavior remains token-free and backward compatible.
- A paired mobile browser reuses the same HTTP and WebSocket APIs over HTTPS/WSS.
- Native Android/iOS execution of Pi remains out of scope; Pi and tools stay on the desktop host.

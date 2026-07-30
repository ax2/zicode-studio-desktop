# ADR 0003: Separate Picot metadata and use QR device authorization

- Status: Superseded for LAN transport by the loopback-only security change on 2026-07-30
- Date: 2026-07-14

## Context

Picot needs stable UI identity and remote-client authorization without taking ownership of Pi sessions,
credentials, settings, or project trust. The original decision retained LAN access without transport
encryption.

## Decision

SQLite stores only Picot metadata: workspace IDs, UI preferences, suspension policy, schema version,
and paired-device token hashes. Pi continues to own session JSONL, `AuthStorage`, settings files, and
`trust.json`. Losing or resetting the Picot database cannot mutate Pi sessions or workspace files.

Project Trust is a blocking, default-deny startup gate before project resources execute. Current-session
settings use native RPC; project and global defaults atomically merge into Pi settings while preserving
unknown keys.

Remote pairing is QR-only. A single-use pairing token expires after five minutes and exchanges for a
revocable long-term device token; only its hash is persisted. Remote clients may use approved runtime
operations but cannot invoke folder picking, app launching, package changes, updates, workspace
deletion, or other dangerous Host operations.

The original LAN transport decision is no longer active. The Host now binds only to `127.0.0.1`, and
the LAN QR endpoint is disabled. LAN access may return only after every exposed route has authenticated
authorization and the transport protects prompts, source code, and credentials in transit.

## Consequences

- Import, sharing, encrypted transport, session indexing/FTS, and arbitrary TUI rendering remain
  deferred.
- Authorization is enforced by the Host route family, not by hiding frontend controls.
- Credentials, pairing secrets, prompt content, and command content must not appear in diagnostics.

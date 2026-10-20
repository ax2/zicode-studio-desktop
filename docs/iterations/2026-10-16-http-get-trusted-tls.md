# HTTP GET Host Trusted TLS Conformance

Date: 2026-10-16  
Scope: ZiCode Studio Desktop Host and test harness only. No ZiDevTools source or package was modified.

## Goal

Verify a successful HTTPS request through the same confirmed Host route that previously had only negative evidence for an untrusted local certificate.

## Changes

- Added a test-only trusted-root list to the HTTP service grant state. The Host copies it into the test client builder only under `cfg(test)`; production requests always use an empty extra-root list and keep reqwest's default certificate validation.
- Extended the real loopback Host fixture to first reject a locally signed certificate before its CA is trusted, then add that CA to test state and make a second separately prepared and confirmed HTTPS call.
- The server certificate SAN includes `127.0.0.1`; the route verifies `GET /actuator/health`, HTTP 200 JSON and an audited successful completion. Existing untrusted-certificate failure remains asserted.
- Updated the profile documentation to distinguish the test CA case from successful use of an operating-system trusted root.

## Validation

- `bun run check:rust:static` passed: cargo check and warnings-as-errors Clippy. Repository-wide `cargo fmt --check` remains advisory because of existing formatting drift; no global formatting was applied.
- `cargo test --manifest-path src-tauri/Cargo.toml --bin zicode-studio-desktop host_routes_confirm_then_fetch_and_persist_audit_events -- --nocapture` passed 1/1. The route completed both untrusted rejection and test-root-trusted HTTPS success after user confirmation, with output and audit assertions.
- One test attempt failed during fixture construction because the project CA helper requires at least one private LAN IP. The fixture was corrected to include both a private SAN and `127.0.0.1`; the final complete run passed. The subsequent run also updated expected audit counts for the added HTTPS operation.
- Before/after read-only storage scans both completed without unknown entries. `target` changed from 29,377,159,548 B / 74,275 files to 29,378,982,771 B / 74,291 files (+1,823,223 logical bytes); `.cache` remained 310,353,261 B / 155 files; `.cache/task-scratch` remained 749,240,625 B / 29,994 files; `site` remained 29,644,753 B / 431 files. E: free space changed from 60,901,601,280 B to 60,995,342,336 B; volume delta can include unrelated activity. No project cache or output was deleted.
- No release build, version bump, package download, cache cleanup or user-data change was performed.

## Remaining work

- Exercise a hostname with a system-trusted certificate under ordinary OS root stores, DNS rebinding/changed-address behavior, and cross-platform resolver/TLS behavior.
- Complete full Pi → Host → real provider View flow and provider fixtures. DevTools full catalog acceptance remains 0/154.

## All-tools matrix synchronization

Updated `devtools-all-tools-matrix.json`, its Markdown matrix row and the blocked-tools list from the passing test-CA HTTPS 200 evidence above. The test-only trusted CA path is no longer listed as pending. Operating-system default roots, public DNS/DNS changes, other Host boundaries, provider package and complete Pi/View acceptance remain open. The row stays `await_host_conformance`; full-tool acceptance stays 0/154.

## Provider package handoff

Sent the DevTools session a scoped request for the Spring Actuator package: manifest v2 with the exact `service.http.get.v1` profile and optional `service.http.read` permission; self-contained View using the Studio bridge only; 200/503 display, refusal, cancellation and error fixtures; versioned `.zicode-plugin` plus an external SHA-256 receipt and scope mapping. The request explicitly preserves the standalone DevTools application and forbids sibling-repository coupling. The provider session acknowledged the request and said it will handle the package after its current SQL formatter validation and catalog sync. No package or conformance receipt has been delivered, so Studio acceptance remains pending at 0/154.

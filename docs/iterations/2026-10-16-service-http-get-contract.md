# Service HTTP GET plugin contract freeze

Date: 2026-10-16  
Scope: ZiCode Studio Desktop documentation only. No ZiDevTools source or runtime was modified.

## Goal

Make the already implemented `service.http.get.v1` profile concrete enough for an independent provider plugin to implement without guessing the Host wire shape, consent result or bounds.

## Changes

- Added `docs/plugins/service-http-get-contract.md` with exact manifest declaration, View API/result shape, Host prepare/commit/cancel requests and responses, error code inventory, endpoint mappings and resource budgets.
- Corrected `docs/plugins/service-http-get-preview.md`: JSON response complexity is already bounded in code (depth 32, 20,000 nodes, 16 KiB key length); the previous text incorrectly listed those limits as unset.
- Distinguished the View-facing response from Host-only `resultRef`/capture metadata. The trusted parent consumes those fields for Studio result actions and does not expose them to the iframe.
- Updated `docs/developer-platform.md` to make this current progress discoverable while retaining the broad 154-tool integration goal.

## Evidence and validation

- Cross-checked route fields and responses against `plugin_services/http_get.rs`, the gateway methods in `plugin-capability-gateway.js`, the View confirmation bridge in `plugin-view-host.js`, and `plugin-http-consent.js`.
- The referenced implementation already has loopback HTTP tests for confirmation gating, 200/503, redirect rejection, cancellation, JSON size/complexity limits, and audit persistence/rotation. This docs-only change does not claim additional tests or HTTPS success evidence.
- The existing HTTP profile record still lists trusted-certificate HTTPS success, public DNS changes, audit recovery, a real provider package, complete Pi/View acceptance and other operating systems as pending.
- No build, dependency download or cache cleanup was run. No version change or release artifact was created.

## Remaining work

- DevTools must implement and deliver its independent plugin/View against this exact profile, with positive/negative vectors for health, info and metrics.
- Studio still needs real Pi → Host → provider View acceptance; trusted HTTPS, DNS changes, audit failure recovery, runtime shutdown/cancel races and non-Windows conformance remain open.
- DevTools full catalog acceptance remains 0/154; this contract unlocks only one controlled HTTP read profile.

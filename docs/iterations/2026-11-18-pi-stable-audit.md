# 2026-11-18: Pi stable-version audit and README

Tracked by [#37](https://github.com/ax2/zicode-studio-desktop/issues/37), milestone v0.6.5. Isolated branch `codex/pi-readme-065` starts at integration commit `46492da67c04bd073c98268d5432f2414c8ec21c`.

## Decision

The official [Pi stable Release](https://github.com/earendil-works/pi/releases/tag/v1.5.2) remains **1.5.2** (2026-11-10, not a draft or prerelease). The registry `latest` versions of [pi-coding-agent](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest), [pi-tui](https://registry.npmjs.org/@earendil-works/pi-tui/latest) and [pi-ai](https://registry.npmjs.org/@earendil-works/pi-ai/latest) are also **1.5.2**. Both declared SDK pins, the transitive AI package version/integrity and all six release asset digests match the existing locks. The existing Windows x64 runtime marker also matches its locked target/archive SHA-256.

There is no stable upgrade to perform. `scripts/pi-version.json`, `package.json`, `bun.lock`, the versioned RPC fixture and application version remain byte-for-byte unchanged. No binary downloads, dependency installations, application/extension rebuilds or repeated model/runtime calls were made for this documentation-only batch. Non-Windows assets were inspected as metadata only; no other-platform build or download was started.

## Compatibility evidence reused

- Existing [Pi 1.5.2 RPC contract](../../tests/fixtures/pi-rpc/1.5.2/contract.json): command discovery, state fields, extension UI events, prompt acceptance and abort. It is retained, not regenerated to hide differences.
- Integrated [actual Pi 1.5.2 receipt](evidence/2026-11-18-module-model-routing.json), from source `052225b9490f6b199a056acdbb2bdfa3a725bac3`: actual locked binary/extension JSONL, local Chat Completions and reasoning Responses requests, supported `low` effort, cancellation, unchanged Chat model/history and module selection across process restart. Synthetic credentials/local services only.
- [Module verification](2026-11-18-module-model-routing.md): source typechecks, 50 related JS tests, 21 visual Rust tests, all-target static checks, strict Clippy, 92 command permissions and Windows subprocess policy. The reuse is limited to the unchanged runtime and integrated sources; it is not a claim that every historical session format was migrated, or that native desktop/provider/account acceptance is complete.

## README corrections

README now describes Windows as the default delivery/build target; links the dynamic published Release instead of stale v0.5.9 claims; separates current-source capabilities from draft/public versions; and explains browser/visual entrances, multi-model selection, explicit send/generation confirmation, tool/tray/Explorer access, fixed data and named isolated credential scopes. It states that Pi remains the core and DSH requires a separate evidence-based decision. The latest public Studio Release at this check was v0.6.2; the documentation does not present frozen v0.6.4 draft artifacts or next-version code as published.

The [machine-readable audit receipt](evidence/2026-11-18-pi-stable-audit.json) records source URLs, registry integrity checks and scope. A targeted SDK alignment check and local README/document link/unchanged-lock checks validate this batch. No GUI, personal data, real credentials, local user models, paid interfaces or scheduling were used. Project priority/stage were preserved; only task status/responsibility and scoped progress were updated. Ready PR goes to `integration/v0.6.5`; main session owns integration and Issue closure.

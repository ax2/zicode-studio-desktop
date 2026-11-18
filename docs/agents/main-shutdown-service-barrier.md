# Main HTTP connection shutdown barrier

This change resolves the Windows failure tracked in [#71](https://github.com/ax2/zicode-studio-desktop/issues/71), scheduled for v0.6.4.

The developer-platform job in run [44050565360](https://github.com/ax2/zicode-studio-desktop/actions/runs/44050565360) failed at the same strict Host-release assertion as the exact main baseline in run [43370545964](https://github.com/ax2/zicode-studio-desktop/actions/runs/43370545964). Both runs reported 675 passing main Rust tests, one failure and 54 ignored tests. The failed test completed the staged export, waited for workspace close, and rejected later writes before observing an outstanding Host state owner.

Axum 0.8.9 can release its connection-close counter before destroying a connection service. The Host listener task can consequently finish before the service releases its state. Every accepted service now holds a lifecycle lease. Service state is destroyed before its lease, and request futures retain their own tracked lifetime. The same adapter covers local HTTP, automation workers, LAN TLS, public TLS and enrollment.

The product patch is transferred from `18b58a980bef836430ec0edfd8c896c031a049e0`, already present in the Windows release branch. Its three product files apply to `origin/main` at `3ae6ae890ae74b4728d1d99059d26cb1be7bbe53` without dependency or behavioral adaptation.

| File | Change |
| --- | --- |
| `src-tauri/src/host_server.rs` | Track each accepted connection service at all five server entry points. |
| `src-tauri/src/host_server/lifecycle.rs` | Construct a tracked service from an existing Host lifetime lease. |
| `src-tauri/src/host_server/lifecycle_service.rs` | Preserve state-before-lease destruction and track request futures, with two deterministic tests. |

The original workspace-close test is unchanged. Its Git blob is `1805188e604799616916c3ad0f647b45103c9c41` in main, the rules PR and the Windows release branch. The new service module is identical to the original fix, Git blob `32d2133730ce6b21d3542547f45444a8de0173ac`. No timeout or cleanup retry was added.

Earlier Windows evidence is retained in the coordinating workspace. The original fix passed the strict regression twenty consecutive times and passed both deterministic service tests. Full historical Rust testing retained three separate notification, private-registry and visual-draft failures. Those earlier logs are evidence for their recorded source revision.

Current main-port validation passed on Windows on 2026-11-18. All commands used the existing toolchain and shared project target, with `--locked --offline`.

- Cargo check and strict Clippy with `--all-targets` passed.
- Both deterministic service lifetime tests passed.
- The original `workspace_close_waits_for_staged_export_and_blocks_later_writes` HTTP regression passed in 0.36 seconds, retaining its exact assertions and timeouts.
- The added module passed its targeted rustfmt check.

The coordinating session retains `outputs/main-shutdown-service-barrier-windows.log` and both archived remote CI reports. The complete Windows CI rerun on the new main-port commit remains part of #71's acceptance. Native UI and application packaging are outside this targeted repair.

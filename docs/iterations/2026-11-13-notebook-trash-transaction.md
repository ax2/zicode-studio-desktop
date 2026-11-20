# Windows notebook trash transaction

Issues #31 and #22. The original full-suite failure left the active notebook directory in place after moving 26 notes into its internal trash and publishing deletion events. The underlying Windows rename error was lost in the old error mapping. Preserve that failure fixture.

The transaction moves the entire notebook subtree under the workspace Notes lock. A failed rename before commit restores moved directories before any note or change-log mutation. Committed recovery completes internal trash entries, then publishes a staged change log. It checks the original, staged and published log hashes so an external modification preserves the journal and is reported as a recovery conflict.

## Windows verification

- Final test executable SHA-256: CC99A7CA3356863002BCF8C79232F5FECF0847C7D0674FBDBE87447DE28EF835.
- Two test threads with TEMP and TMP pointing to the task-owned scratch directory. Notes: 69 passed, 2 ignored. Original novel watcher: 1 passed. All-target compile and strict Clippy passed.
- Fault coverage includes a second-directory rename failure, interruption of an owned child immediately after its first directory rename, committed reopen without duplicate deletion events, and preserving an externally changed log. The process interruption checks original note, attachment, history and change log.
- Earlier run: 63 passed, 4 failed, 2 ignored. Two added tests cleaned up the wrong root, plus Windows junction setup and loopback failures. After correcting test ownership, a run using the default temporary directory recorded 43 passed, 26 failed, 2 ignored. The watcher failed before exercising its behavior because its fixture could not be created. Those logs were retained. No ACL or integrity labels were changed.
- Shared development EXE SHA-256 75A3D472E6D7D82F089ABD9905092642D606CDF73405D52C471511008BC5A6C8 and visual bundle SHA-256 0D718A5F728B71F33C79797610343813F94563D0FFD12A8750F8B3DB3C031FF1 matched before and after. No native Studio instance was launched. Final packaged-candidate checks are separate.

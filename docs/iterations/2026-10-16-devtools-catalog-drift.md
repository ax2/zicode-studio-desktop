# ZiDevTools Catalog Drift Audit

Date: 2026-10-16

Scope: read-only comparison of the active `E:\zi-devtools` checkout with its HEAD catalog; Studio only. No DevTools files were modified.

## Findings

- Provider HEAD: `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`.
- `docs/tools.json` and `docs/studio-plugin-migration.json` are modified and uncommitted. Catalog header still says `0.82.0-dev.105`, updated `2026-10-16`.
- The catalog still has 154 IDs with no additions or removals. Comparing HEAD to the live file found 37 entries with both tool version and scope changes; 5 status changes from planned to in-progress: `sql-format`, `plugin-updates`, `plugin-market`, `command-collections`, and `artifact-hub`. Other changed entries retain their status.
- Live `docs/tools.json` SHA-256: `30caf81e1b1b9821f2ba72c5c8c09deb9b7a7f29e4c27a01e66be71b64f686ab`.
- Live `docs/studio-plugin-migration.json` SHA-256: `23a3c8ef1a7241b291d9b869c2005778e05d12e99caf4aaa0457c8585cb712c7`.
- These hashes identify only this dirty working-tree observation. They are not signed or stable provider receipts and must not replace the frozen Studio matrix baseline.

Changed tool IDs: `files`, `http`, `sql-format`, `encoding-detect`, `image-tools`, `image-batch`, `image-metadata`, `plugins`, `mcp-inspector`, `agent-runner`, `agent-replay`, `browser-clipper`, `plugin-updates`, `plugin-market`, `global-launcher`, `command-collections`, `java-thread-dump`, `java-dependencies`, `java-environment`, `java-gc-log`, `java-jfr`, `spring-config`, `spring-actuator`, `django-environment`, `django-migrations`, `django-sql`, `django-urls`, `django-drf`, `django-checks`, `celery-diagnostics`, `task-center`, `artifact-hub`, `advanced-calculator`, `screenshot-workbench`, `super-clipboard`, `text-flow`, and `image-workflow`.

The live migration entry for `spring-actuator` is version 1.1.1 and adds asynchronous task-center status, a generic summary with detailed report retained in the workbench, and JSON report export with tool version and a portable environment fingerprint. Studio's current `service.http.get.v1` covers only the fixed HTTP request. Asked the provider to map the added behavior to versioned task and result/resource Host APIs, with cancellation/revocation fixtures and explicit consent for report saving. An HTTP-only subset must remain partial and cannot mark the entire tool accepted.

## Handoff and next gate

Sent the exact drift counts, hashes, and Spring Actuator scope gap to the original DevTools session. The provider session acknowledged the initial package handoff and said it will first finish current SQL formatter validation and catalog sync, then move to the Spring Actuator Studio plugin delivery. A follow-up clarified the task/result-resource Host schema need from the expanded 1.1.1 scope; that clarification has not received a separate response. Requested a stable source revision, explicit dirty/clean state, catalog and migration hashes, and per-tool scope/version diff. The app version does not need to change for local development. No package or receipt has been delivered yet.

Studio keeps the prior 154-tool matrix unchanged until the provider snapshot is stable and receipted. Current full-tool acceptance remains 0/154. No build, tests, cache deletion, package import, or provider checkout modification was performed.

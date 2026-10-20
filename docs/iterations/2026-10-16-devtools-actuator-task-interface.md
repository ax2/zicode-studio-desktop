# Spring Actuator Task and Report Interface Requirements

Date: 2026-10-16

Scope: Studio-side interface request derived from the active provider catalog; no DevTools source or packages modified.

## Evidence and gap

The active `E:\zi-devtools` migration entry declares `spring-actuator` 1.1.1 with fixed health/info/metrics GET, asynchronous status in a task center, generic task summaries, detailed reports in the workbench, and JSON report export containing tool version and a portable environment fingerprint. Studio's current `service.http.get.v1` only covers a fixed, user-confirmed HTTP GET. It does not provide task lifecycle or report file output.

The current Studio task center store reads and writes `read_super_agent_tasks` / `write_super_agent_tasks` and is centered on Super Agent workflows. Current plugin Host service routes are `model-generation` and `http-get`; model generation uses in-memory, owner-bound operation grants and a foreground commit result, not a restart-recoverable generic plugin task store. Reusing the task-center UI is possible, but the plugin task record store must remain separate from `super_agent_tasks`.

## Work

- Added `docs/plugins/devtools-actuator-task-interface-request.md` with Host-owned task identity, explicit user initiation, ordered/recoverable events, cancellation/revocation, isolation, reuse of the bounded HTTP profile, result/preview/confirmed save, privacy limits for environment fingerprints, and cross-platform gates.
- The provider session acknowledged the initial Spring Actuator package request and said it would proceed after SQL formatter validation and catalog synchronization. After discovering the additional 1.1.1 task/report scope, Studio sent follow-up requirements for task and result-resource mapping. A further clarification stated that the current task center stores Super Agent workflows and must not receive plugin tasks; no reply to these detailed boundaries or provider package/schema receipt has arrived yet.
- Refined the interface request to reuse the current task-center presentation while adding a namespaced, Host-managed plugin-task store, ordered events, restart recovery and bounded retention; no current database or API satisfies this by being relabeled.
- Preserved the frozen matrix at 154 tools and 0 full acceptances because the observed provider catalog and migration files remain dirty.

## Validation and limits

- Read-only consistency check confirmed the Studio JSON matrix still parses with `totalTools=154`, `fullToolsAccepted=0`, and Spring Actuator still pending.
- `git diff --check` passed for the edited Studio Markdown. No build or tests were run; no cache or files were deleted.
- This is an interface request, not an implemented Host task API. Provider schema agreement, Studio profile implementation, package conformance, true Pi/View operation and per-OS acceptance remain open.

## Provider candidate review (read-only, in-flight tree)

During the provider session's package work, Studio observed an uncommitted `plugins/spring-actuator/` directory with a manifest, catalog, HTTP schemas, View, and a task lifecycle proposal (14 files / 29,275 bytes at observation). The manifest declares `service.http.get.v1 = 1.0.0-preview.1` with optional `service.http.read`; the catalog explicitly says `scopeComplete=false` and `fullSourceToolDelivered=false`. No installable `.zicode-plugin` or stable package receipt was present.

Returned these contract findings to the provider without modifying its tree: the proposal exposes `resultRef` to the View; request schemas do not separate View parameters from trusted Host identity; event recovery lacks a defined snapshot/page/cursor contract; `terminal` event payload binding is ambiguous; the monotonic sequence fixture repeats the JSON `sequence` key; and `catalog.json` points to a result-resource proposal README absent from the observed plugin directory. No proposal profile is accepted or published by Studio. The provider session has not yet answered this review.

## Provider candidate re-review (2026-10-16, later live snapshot)

The active DevTools task continued changing its uncommitted candidate after the first observation. A later read-only inventory found 31 files / 56,119 logical bytes under `E:\zi-devtools\plugins\spring-actuator`; `git status` still reports the directory as untracked, and no `.zicode-plugin` is present. Do not treat these bytes as a stable package or copy them into Studio fixtures.

Several first-review gaps are now addressed in the draft: `task-api-proposal/README.md` says owner identity is injected by the trusted View gateway and checked by Host; View-facing events expose only `resultAvailable`, not `resultRef`; snapshot and replay schemas plus cursor recovery rules are present; terminal data is an immutable envelope; the result-resource README now exists; and both vectors reference the duplicate-JSON-key fixture, which is present. `plugin.json` still advertises only `service.http.get.v1@=1.0.0-preview.1`; the catalog correctly labels source scope incomplete and background task/report export undelivered.

Sent a second read-only review to the provider session: Host must derive verified provenance and canonical runtime fingerprint rather than trust duplicated plugin-provided report provenance; report endpoint/count/status fields need cross-field consistency and duplicate-endpoint rules; replay cursor errors and sequence/terminal ordering need machine-checkable semantics; submit origin needs origin-only validation and explicit DNS/private/link-local/rebinding enforcement through the HTTP Host; proposed profiles must stay out of the manifest until Studio publishes and conforms them. No Studio API has been implemented or approved for these proposals. Full DevTools acceptance remains 0/154, with the Spring Actuator HTTP-only candidate still pending real package and Pi/Host/View conformance.

## Validation for the re-review

- Read-only inspection only; no DevTools files modified, imported, or packaged.
- Candidate file count/size and source-tree status observed as above; no stable receipt or signed package available.
- Parsed all 25 candidate `.json` files successfully; this checks JSON syntax only, not schema semantics or runtime conformance. The duplicate-key negative fixture is intentionally plain text and is present.
- `git diff --check` passed for the Studio task-interface request and this iteration log.
- No build or tests run. Existing Studio build caches and project files were untouched.

## Re-review after provider follow-up (2026-10-16, 32-file snapshot)

The provider continued editing its untracked tree after Studio's second feedback. The latest read-only inventory is 32 files / 61,416 logical bytes; the DevTools thread is still active and there is still no `.zicode-plugin` or stable receipt. The draft now adds origin-only filtering and explicit DNS policy prose, cursor error fields/conditions, and terminal-binding and origin negative vectors. These are improvements to the proposal, not runnable Studio conformance.

Remaining gaps sent to the provider: the result prepare/report still accepts caller-supplied `generatedAt`, application version and runtime fingerprint, with provenance repeated in two places; endpoint count is not tied to checks, duplicate endpoint rows are allowed, and the HTTP status range does not cover the profile's full response domain; replay conditions do not require the relevant fields or machine-check sequence/terminal relationships; origin parsing is represented by a regex/prose rather than runnable canonicalization cases. The provider should add contradictory vectors and an executable verifier. Studio still has no task/result Host profile implementation, and full DevTools acceptance remains 0/154.

At the 32-file snapshot, all 26 candidate `.json` files parsed; that result was superseded by later edits. Strict duplicate-aware parsing first found one syntax error in `report.schema.json`, then two failures in the 64,989-byte intermediate snapshot (`report.schema.json` syntax and duplicate `items` in `report-facts.schema.json`). After the provider fixed the duplicate and item nesting, the newest 33-file / 65,113-byte snapshot has one remaining parse failure in `report.schema.json`. The manifest still declares only the already implemented HTTP GET profile, the catalog marks source scope incomplete, and package count remains zero. No build, runtime test, import, cache cleanup or file deletion occurred.

## Current schema follow-up (2026-10-16)

The candidate then grew to 33 files / 64,999 logical bytes and changed again to 64,989 bytes. In that intermediate snapshot, `report.schema.json` had invalid JSON and `report-facts.schema.json` repeated `items` under `properties.checks`; a duplicate-aware scan found two failures among 26 JSON files. The provider then fixed the duplicate `items` key and correctly nested the per-endpoint rules under the single item schema. The newest inventory is 33 files / 65,113 logical bytes; strict parsing now finds only the still-invalid `report.schema.json` (missing closing brace in its `allOf` block). The report vectors still lack duplicate endpoint, endpointCount mismatch, health summary mismatch and disallowed info/metrics status cases, despite README claims. These findings were sent to the provider. No Studio acceptance or Host API implementation follows from proposal edits.

The provider also tightened the event replay response after the previous scan by requiring the requested cursor and snapshot flag. The latest observed source tree is 33 files / 65,329 logical bytes; a fresh duplicate-aware scan still has one failure, `report.schema.json` line 21. The report resource vectors remain unchanged and do not yet contain the requested contradictory cases. The DevTools task is still active; no package or stable receipt exists.

## New conformance vectors (2026-10-16)

The candidate has since grown to 35 files / 73,797 logical bytes and 28 JSON documents. It now includes `result-resource-proposal/conformance-vectors.json` with duplicate endpoint, summary mismatch and invalid status cases, plus `task-api-proposal/cursor-vectors.json` with replay relationship cases. This addresses the requested negative-case coverage at the data level. The script inventory still contains only the View harness, not an executable schema/vector verifier; the result README points to `vectors.json` rather than the new conformance file. A fresh duplicate-aware parse still finds one syntax error in `report.schema.json`, and there is no `.zicode-plugin` or stable receipt. Feedback was sent to the provider. Studio acceptance remains 0/154.

## Provider verifier review (2026-10-16)

The active candidate subsequently grew to 36 files / 89,451 logical bytes. All 28 JSON files pass duplicate-aware syntax parsing, and the provider added `scripts/verify-contract.py`. Running it succeeded and reported 21 schemas, 5 local references, 10 report vectors, 10 cursor vectors and duplicate-key rejection. This is provider-owned candidate evidence only; there is still no package or receipt, and the manifest advertises only the existing HTTP GET profile while catalog scope remains incomplete.

Code review of the verifier found that `validate_json()` is defined but never called by `main()`. The passing run parses schemas, traverses local refs and checks a few schema locations, while vectors are evaluated by separate custom functions; it does not validate those vectors against their schemas. `validate_facts()` also accepts boolean values for byte/field counts because Python treats `bool` as an `int`. These limits were sent to the provider; Studio has not accepted the proposed task or result profiles. No Studio build, test, package import or cache cleanup was done.

## Studio-owned task lifecycle contract draft (2026-10-16)

To keep the integration moving independently of the unstable provider snapshot, added `docs/plugins/plugin-task-lifecycle-profile.md` and linked it from the interoperability matrix and Spring Actuator request. It defines Host-owned opaque task identity, separate persistence from `super_agent_tasks`, idempotent submission, ordered snapshot/replay, cancellation finality, restart recovery, revocation, result-resource boundaries, retention limits, and cross-platform package acceptance. It explicitly does not grant network or file access and is not advertised as a supported runtime profile.

This is a Studio contract draft, not a Host implementation or an accepted provider ABI. The remaining implementation work includes versioned route/request/response schemas, transactional task persistence and lifecycle executor integration, redaction enforcement, conformance tests, and real plugin execution. Current candidate verification remains provider-local and does not replace Studio acceptance. Documentation-only review: `git diff --check` required; no build/test or cache work for this change.

Latest read of the authorized DevTools session shows it is actively revising the candidate verifier to run schema-backed vectors and cover type boundaries, then synchronize plugin mapping documentation. This is an in-flight provider action, not a completed response or acceptance receipt; Studio will re-review the resulting tree.

## Existing project task storage boundary (2026-10-16)

Inspected `src-tauri/src/project_tasks/history.rs`, `history_api.rs`, `mod.rs` and the Host routing. The existing `TaskRunner` is explicitly a local project-process runner. Its `project-run-history.sqlite3` stores only run summaries, prunes to 40 per workspace and 500 globally, and restores summaries without stdout/stderr or event history; active process/output/cancel state remains in the current host. Its protocol exposes catalog, run listing, start/stop and history clear, not plugin-owned resumable task APIs.

Updated the Studio task-profile draft to document this distinction: future plugin task storage must be separate from both `super_agent_tasks` and `project-run-history.sqlite3`; sharing the existing SQLite dependency/data-root convention is acceptable, but requires an independently versioned namespace, ownership, quotas, transactions, migrations and retention. This avoids conflating existing useful project-run functionality with the new plugin lifecycle requirement. Documentation-only change; no build, tests, or cache cleanup.

## Host lifecycle route and executor contract (2026-10-16)

Inspected the existing controlled HTTP service pattern: loopback routes require the desktop token; the trusted parent bridges View requests and validates active runtime/session/plugin state; the sandboxed View receives neither token nor direct Host/network access. Extended the task-profile draft with five explicit routes (`submit`, `snapshot`, `events`, `confirm`, `cancel`), bounded strict JSON, a stable error envelope and distinction between transport request IDs and durable idempotency keys.

The contract now constrains task dispatch to Studio-registered handlers that compose separately declared capability profiles. A plugin task cannot use the lifecycle profile to run arbitrary plugin code, a process, network access or file writes. This gives the generic task center a concrete Host integration boundary for long-running DevTools operations while preserving per-operation authorization. Added draft JSON Schemas and a route map; handler implementation, persistence migrations, schema-backed conformance vectors and Pi→Host→View acceptance remain open. Documentation checks only; no build, tests or cache work.

## Draft machine-readable lifecycle schemas (2026-10-16)

Added `docs/plugins/schemas/plugin-task-lifecycle-v1/` with request/response schemas for submit, snapshot, event replay, confirmation and cancellation, plus common task/event/terminal/error shapes. They deliberately exclude Host-injected owner identity and state that operation-specific input must be validated before task creation. Schema-only checks do not enforce owner isolation, idempotency, event order, cursor consistency, cancellation finality or recovery; those require Host runtime conformance. The preview remains unimplemented and unavailable to provider manifests.

Strict JSON parsing passed for all 10 schema files, and all 27 local `$ref` targets resolved. Neither Python `jsonschema` nor Ajv is installed in the existing environment; no dependency was added. This proves syntax/reference integrity only, not Draft 2020-12 meta-schema or instance conformance.

### Verifier recheck after provider revision

The latest candidate snapshot grew to 38 files / 129,809 logical bytes. A duplicate-aware parse found 29 JSON files and no syntax or duplicate-key failures. Provider `verify-contract.py` now calls its custom schema evaluator for prepare/report vectors and includes nine schema vectors for numeric booleans, date-time, unknown fields and duplicate checks. Its first run failed because the full prepare payload was checked against the `report-facts` fragment schema; the provider corrected the target to `prepare.schema.json`. The next run passed: 21 parsed schemas, 5 local refs, 10 resource vectors, 9 custom schema vectors, 10 cursor vectors and duplicate-key rejection.

The provider labels this evaluator custom; the local Python environment has no `jsonschema` package, so no external Draft 2020-12 implementation was used or installed. This passing provider verifier is evidence for its covered subset and vectors only. The package is still absent and Studio's runtime profile is still not implemented or advertised; full acceptance remains 0/154. Studio did not run an app build/test or change caches.

## Provider mapping and confirm binding recheck (2026-10-16 11:20 CST)

The authorized DevTools session updated the candidate proposal README to map all five routes to schemas and retained `scopeComplete=false`, `fullSourceToolDelivered=false`, and HTTP GET as its only required profile. Latest read-only candidate snapshot: 40 files / 154,945 bytes, no `.zicode-plugin`. Its confirm request still lacks Studio's Host-generated single-use `confirmationId`, so the Studio contract and provider schema are not yet aligned. Sent the mismatch plus replay/expiry vector requirements back to that session. No provider files were changed or imported; Studio full acceptance stays 0/154.

After that feedback, the provider candidate added `confirmationId` to its confirm request schema, documented Host issuance/binding and added expiry, step/target/permission-generation mismatch and replay rejection vectors. Current observed candidate is 41 files / 171,668 bytes, untracked, with no package or receipt; manifest still advertises only HTTP GET and catalog scope remains incomplete. This resolves the specific schema mismatch in the mutable proposal, not its conformance or delivery status. Studio has not imported or run it; 0/154.

## Provider 0.1.1 review receipt audit (2026-10-16)

The active DevTools session produced the unsigned review directory `release/plugin-candidates/spring-actuator-0.1.1-candidate-01` and package-out receipt `spring-actuator-0.1.1-candidate-01-verification.json`. Receipt identifies 42 files / 172,765 bytes, dirty source baseline `65f9aa63c831a4540bdd5731aa4da3de76dbd4b8`, `taskProfileDeclared=false`, no signing key and `packageSha256=null`; it explicitly marks the directory non-installable and not Studio-accepted. The source plugin manifest continues to declare only `service.http.get.v1`, while catalog scope remains incomplete.

Studio independently resolved every listed path within the candidate, compared all 42 file lengths and SHA-256 values, and checked exact file-set membership; all matched. The receipt's contract verification is provider-owned finite custom validation, not Studio runtime or full Draft 2020-12 acceptance. The directory includes a 37,273-byte Python `__pycache__` bytecode file; this was reported to the DevTools session for exclusion and receipt regeneration. No files were copied, imported or executed, and Studio full-tool acceptance remains 0/154.
## Clean candidate-02 receipt and schema validation (2026-10-16)

The provider replaced candidate-01 (which included a generated `.pyc`) with `release/plugin-candidates/spring-actuator-0.1.1-candidate-02`. Receipt reports 42 files / 130,016 bytes, no package digest, unsigned review directory, dirty source tree and `taskProfileDeclared=false`. Its standard schema check reports Draft 2020-12 validation of 22 schemas and 21 schema vectors using `jsonschema 4.26.0`, plus semantic cursor/event/confirmation/resource checks and View guards.

Studio independently checked receipt file-set membership, path containment, byte length and SHA-256 for all 42 files; every entry matched, and the receipt contains no `__pycache__`/`.pyc`. This verifies candidate immutability against its receipt only. It remains non-installable, HTTP-only, and incomplete in catalog scope; no Studio runtime acceptance occurred, 0/154.
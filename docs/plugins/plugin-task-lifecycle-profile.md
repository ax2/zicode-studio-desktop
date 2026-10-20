# Plugin Task Lifecycle Host Profile

Status: Studio-owned contract draft `plugin.task.lifecycle.v1@1.0.0-preview.1`. Studio has an internal persistence module and a desktop-only, read-only task overview route. The Host records `revoked` for active tasks after supported plugin state changes and `interrupted` on normal Host shutdown or database reopen; these updates are best effort. It has no View-facing lifecycle routes, operation handlers, or advertised profile. A provider proposal is an input to review, not authority to add a Host API or claim compatibility.

This extension provides durable, resumable task state for plugins whose work spans multiple Host calls or outlives a View. It is separate from the Super Agent task store and does not itself grant network, process, model, file, or resource permissions. Each task operation must also declare the versioned capability profile that performs its work.

## Ownership and submission

- A task starts only after an explicit user action in a verified plugin View.
- The trusted Studio gateway injects plugin ID/version, workspace, profile version, runtime/session context and a transport request ID. These fields are not accepted from View JSON. The Host verifies the caller again for every read, confirm, cancel and result operation.
- View submission contains only `schemaVersion`, an idempotency `idempotencyKey`, a fixed `operationId`, and the operation's bounded input. It cannot include a local path, host task ID, Host token, permission grant, result reference, arbitrary URL components, or filesystem destination.
- Host creates the opaque `taskRef`, stores the owner and operation binding, and returns only that reference plus safe state. An `idempotencyKey` replay with the same canonical input returns the same task; reuse with different input fails with `task_idempotency_conflict`.
- Idempotency is durable for the retained task lifetime. After a terminal record expires at 30 days and is pruned, the same key may create a new task; clients must not treat the key as an indefinite deduplication guarantee.
- Records are isolated by verified plugin ID, workspace, profile and operation. Knowing a `taskRef` does not bypass owner checks.

## Host transport and execution boundary

All operations use the loopback-only desktop Host under `/v2/plugin-tasks/`. The trusted parent bridge is the only caller: it keeps the desktop token, injects the current plugin/runtime/session identity, and sends bounded JSON requests. A sandboxed View does not receive the token, call these routes directly, or gain network access; its CSP continues to use `connect-src 'none'`. Host checks the token, current runtime/session, enabled plugin, profile compatibility and current permission state on every operation. Identity, workspace, plugin version and profile version are derived or verified by Host and cannot be overridden by View data.

The implemented `POST /v2/plugin-task-center/workspace` route is separate from the proposed lifecycle routes below. It accepts a desktop token and registered workspace, then returns a bounded metadata page for Task Center. It cannot submit, resume, confirm, cancel, or execute a plugin task, and its existence does not authorize a provider to declare this profile. The current Task Center has only an empty-state native UI acceptance; no real provider task has reached it.

Task Center also has `POST /v2/plugin-task-center/detail`, restricted to the same desktop token and registered workspace. It returns a task snapshot and up to 64 state events for a task in that workspace, without input, result content or grants. Optional `beforeSequence` loads an older page; `earlierEventsAvailable` indicates whether another page exists. It is not View-facing, does not advertise this profile, and has no submit/execute/cancel effect. Windows pagination was checked using a synthetic 70-event record in an isolated profile; no provider-created task has yet been displayed.

| Route | Request fields after trusted identity injection | Purpose |
| --- | --- | --- |
| `POST /v2/plugin-tasks/submit` | `schemaVersion`, `operationId`, `idempotencyKey`, bounded `input` | Create or return the same idempotent task, then dispatch only a Host-registered operation handler |
| `POST /v2/plugin-tasks/snapshot` | `schemaVersion`, `taskRef` | Return an owner-checked current snapshot |
| `POST /v2/plugin-tasks/events` | `schemaVersion`, `taskRef`, `afterSequence`, `limit` | Return a bounded owner-checked event page |
| `POST /v2/plugin-tasks/confirm` | `schemaVersion`, `taskRef`, `operationStepId`, `confirmationId`, `decision` (`approve` or `decline`) | Continue a paused step only after a trusted parent UI confirmation bound to that exact task and step |
| `POST /v2/plugin-tasks/cancel` | `schemaVersion`, `taskRef` | Request cancellation and return `requested` or `finished` |

All bodies reject unknown fields and are limited to 16 KiB before parsing. `limit` is an integer from 1 through 64. `operationId` is a Host-registered stable identifier, not a code, URL, command, module path or callback supplied by the View. The registered handler composes only other declared versioned capability profiles. This lifecycle profile cannot run arbitrary plugin code in the background, start processes, access the network, or write files. An operation handler that cannot continue safely without a View or a separately authorized capability must fail closed or become `interrupted`.

Each response uses `{schemaVersion, operation, task, error}`. `task` is either a bounded task snapshot/page or `null`; `error` is either `null` or `{code, message}` with a stable `task_*` code and a user-safe message no longer than 240 characters. Missing and foreign `taskRef` values produce the same `task_not_found` response. Authentication, caller identity, owner mismatch and revoked profile/permission are rejected before returning task data. Transport request IDs are for retrying a single HTTP exchange only; `idempotencyKey` is the durable task-creation key and is never substituted by a gateway request ID. Draft JSON Schemas for these View-facing request/response bodies live under [`schemas/plugin-task-lifecycle-v1/`](schemas/plugin-task-lifecycle-v1/); Host-injected owner fields are deliberately excluded from provider/View schemas.

## Lifecycle

Nonterminal states are `queued`, `running`, and `awaiting_confirmation`. A task may return to `running` after the user confirms a specific step. Terminal states are `succeeded`, `partial`, `declined`, `failed`, `cancelled`, `revoked`, and `interrupted`.

Every state transition appends one Host-authored event with a strictly increasing per-task sequence. Events contain bounded state, operation step ID, stable error code, timestamps, and redacted summary only. They never contain request/response bodies, credentials, arbitrary user strings, absolute paths, raw network exceptions, `resultRef`, or resource contents. Terminal state and its event are immutable.

Cancellation has two phases. The initial response reports `requested` while execution may still be stopping. The Host emits terminal `cancelled` only after the active operation has stopped and can produce no further side effect. It reports `finished` when the task is already terminal. A View must keep the task pending while cancellation is requested.

The Host persists queue and task metadata outside both `super_agent_tasks` and `project-run-history.sqlite3`. The latter is the existing local project-process runner history: it stores bounded run summaries (40 per workspace and 500 globally), keeps stdout/stderr in the live host only, and has no plugin owner, event replay, or resumable task semantics. Its process execution and history APIs must not be used to implement or impersonate plugin tasks. A future implementation may reuse the app's SQLite dependency and data-root conventions, but must use a separately versioned plugin-task schema/namespace with its own owner checks, transactions, quotas, migrations, and retention. On restart, queued tasks may resume only after revalidating owner and operation with an implemented recovery handler. The current Store has no operation or confirmation recovery handler, so opening its database marks `queued`, `running`, and `awaiting_confirmation` tasks `interrupted` with a new event. An in-progress operation may recover in a future profile only if its Host handler explicitly supports idempotent recovery with the original operation key and fresh authorization. A process restart never silently replays a write or consumes an old permission grant. Previous confirmation requests remain visible as terminal history, never as actionable pending decisions.

## Snapshot and event replay

The Host exposes an owner-checked snapshot and paged event replay. A snapshot includes `taskRef`, current state, latest sequence, bounded per-step states, and the immutable terminal record if present. Replay takes `afterSequence` and a bounded page size, and returns `requestedAfterSequence`, `events`, `nextSequence`, `hasMore`, `earliestRetainedSequence`, `latestSequence`, `snapshotRequired`, optional `cursorError`, and terminal state.

- Sequences start at 1 and increase without gaps in persisted task history. Replayed events at or below the View's last applied sequence are ignored; a gap requires a fresh snapshot.
- `afterSequence > latestSequence` returns `cursor_invalid`, no events, and `snapshotRequired=true`.
- `afterSequence < earliestRetainedSequence - 1` returns `cursor_expired`, no events, and `snapshotRequired=true`.
- Otherwise, `nextSequence` is the last returned event sequence, or the requested cursor when the page is empty. `hasMore` is true exactly when retained events follow `nextSequence`.
- A terminal envelope must have the same `taskRef` owner scope as its event and a sequence no greater than `latestSequence`. No later event can mutate or revive it.

All values above are checked by Host runtime logic; JSON Schema alone cannot enforce equality, monotonic ordering, cursor retention, ownership, or terminal immutability. Contract vectors must include accepted and rejected cases for each invariant.

## Confirmation, revocation and results

- Each external side effect uses its own permission profile and one-use Host grant. Submitting a task does not authorize the work. A confirmation is bound to the exact task, operation step, target and grant generation.
- Denial creates a safe terminal or per-step `declined` state and performs zero side effects. Permission revocation, plugin disable/uninstall, workspace close and Host shutdown stop only the affected task and invalidate outstanding grants. A new task needs fresh authorization.

Current Studio workspace close now interrupts matching Store records and invalidates known runtime-scoped grants and cursors; see [workspace-close evidence](../iterations/2026-10-17-plugin-workspace-close.md). This does not declare the lifecycle profile implemented: already-started detached resource writes still need a workspace completion barrier and real provider verification.
- Until operation-to-permission bindings exist, the internal Store conservatively revokes every active task for the plugin in the changed scene when any of that plugin's permissions is withdrawn. Plugin disable has the same scene scope; uninstall, successful developer reinstall, signed upgrade and signed rollback span all scenes for that plugin. Successful publisher revocation revokes active tasks for the installed signed plugins returned by the registry as affected; unrelated plugins' records and existing terminal records are untouched. A failed signed install leaves task state unchanged. Normal Host shutdown interrupts all active task records once; an abnormal exit is reconciled when the database reopens. Explicit registry reload now compares process-local plugin execution revisions before and after the scan, invalidating grants/cursors and revoking tasks only for removed or changed identities; unchanged plugin work remains active. Workspace close and stronger detection of in-place developer bytes changed under an unchanged manifest still need task-specific reconciliation before this profile can be advertised. If registry changes or task persistence fail partway through, the task record may remain stale even though capability access has been invalidated; this gap also blocks publication.
- A plugin result first enters the versioned Host result/resource pipeline. The View sees only `resultAvailable`; the trusted parent/Host owns result preview, saving and opaque resource references. User confirmation is required before persistence or a filesystem write.
- Task Center may present the task and its safe summary, but its Super Agent workflow store is not a plugin task database. The Task Center reads task records through Host-owned APIs.

## Resource bounds and retention

The initial implementation target is at most 256 events per task, 1 KiB UTF-8 per event payload, 1,000 retained task records per workspace, and 30 days for terminal records. Terminal records are pruned oldest-first within the owner scope; live records are not evicted to make room. A storage error fails task creation before side effects and returns a stable error. These limits are contract defaults for the preview; changes require a profile revision and measured storage evidence.

## Minimum conformance set

| Case | Required result |
| --- | --- |
| View supplies plugin/workspace/runtime identity, taskRef, resultRef, path or grant | Reject before creating a task or performing work |
| Same requestId and same input is retried | Return one task; do not duplicate work |
| Same requestId with different input | Reject with idempotency conflict |
| Another plugin or workspace reads/cancels a taskRef | Reject without disclosing whether the task exists |
| User declines a step confirmation | Zero side effects for that step |
| Cancel races an active HTTP/resource operation | `requested` until the operation stops; terminal event is final |
| Permission revoked while running | Stop only owned task; no next step or result write |
| View reconnects, repeats an event, or skips a sequence | Deduplicate repeats; require snapshot on a gap |
| Cursor is expired or ahead of latest | Empty replay, stable cursor error, snapshot required |
| Host restarts with a write in progress | Mark interrupted unless explicit idempotent recovery is implemented; never replay stale grants |
| Malicious result or event includes a path, credential, body, or oversized string | Reject/redact before persistence and View delivery |
| Two terminal events or any event after terminal | Reject; persisted terminal state remains unchanged |

The provider must deliver portable request/response schemas, positive and negative vectors, an executable strict JSON/schema/vector verifier, and a package receipt. Studio must implement the generic Host store and routes, then validate the signed/unsigned package through actual Pi → Host → View discovery, load, execution and result display. Platform support is tested independently on Windows, macOS and Linux. Until then this draft is not a supported profile and does not move the 154-tool acceptance matrix.

## Spring Actuator mapping

The current Spring Actuator candidate can map its background lifecycle to this profile only after provider and Studio agree on the operation payloads and vectors. Its HTTP calls must separately use `service.http.get.v1`; report generation/saving must separately use the Host result/resource profile. Neither task lifecycle nor report export may be declared in the provider manifest before Studio implements and publishes those profiles. See [the current Actuator interface request](devtools-actuator-task-interface-request.md) and [the live review log](../iterations/2026-10-16-devtools-actuator-task-interface.md).

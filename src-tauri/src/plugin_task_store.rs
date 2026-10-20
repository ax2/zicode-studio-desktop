//! Durable Host-owned task metadata. This module does not run plugin code or
//! advertise `plugin.task.lifecycle.v1`; routes and operation handlers remain gated.
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MAX_TASKS_PER_WORKSPACE: i64 = 1_000;
const MAX_ACTIVE_TASKS_PER_PLUGIN: i64 = 128;
const MAX_EVENTS_PER_TASK: i64 = 256;
const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Owner {
    pub workspace_id: String,
    pub scene_id: String,
    pub plugin_id: String,
    pub package_version: String,
    pub profile_version: String,
    pub operation_id: String,
}

impl Owner {
    fn valid(&self) -> bool {
        [
            &self.workspace_id,
            &self.scene_id,
            &self.plugin_id,
            &self.package_version,
            &self.profile_version,
            &self.operation_id,
        ]
        .iter()
        .all(|value| !value.is_empty() && value.len() <= 256)
            && self
                .operation_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum State {
    Queued,
    Running,
    AwaitingConfirmation,
    Succeeded,
    Partial,
    Declined,
    Failed,
    Cancelled,
    Revoked,
    Interrupted,
}

impl State {
    fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::AwaitingConfirmation => "awaiting_confirmation",
            Self::Succeeded => "succeeded",
            Self::Partial => "partial",
            Self::Declined => "declined",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
            Self::Revoked => "revoked",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "queued" => Self::Queued,
            "running" => Self::Running,
            "awaiting_confirmation" => Self::AwaitingConfirmation,
            "succeeded" => Self::Succeeded,
            "partial" => Self::Partial,
            "declined" => Self::Declined,
            "failed" => Self::Failed,
            "cancelled" => Self::Cancelled,
            "revoked" => Self::Revoked,
            "interrupted" => Self::Interrupted,
            _ => return None,
        })
    }

    fn terminal(self) -> bool {
        matches!(
            self,
            Self::Succeeded
                | Self::Partial
                | Self::Declined
                | Self::Failed
                | Self::Cancelled
                | Self::Revoked
                | Self::Interrupted
        )
    }

    fn can_transition_to(self, next: Self) -> bool {
        if self.terminal() || self == next {
            return false;
        }
        match self {
            Self::Queued => next != Self::Partial && next != Self::Succeeded,
            Self::Running => next != Self::Queued && next != Self::Declined,
            Self::AwaitingConfirmation => matches!(
                next,
                Self::Running
                    | Self::Declined
                    | Self::Cancelled
                    | Self::Revoked
                    | Self::Interrupted
            ),
            _ => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub task_ref: String,
    pub state: String,
    pub latest_sequence: u64,
    pub cancel_requested: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Event {
    pub sequence: u64,
    pub state: String,
    pub at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventPage {
    pub requested_after_sequence: u64,
    pub events: Vec<Event>,
    pub next_sequence: u64,
    pub has_more: bool,
    pub earliest_retained_sequence: u64,
    pub latest_sequence: u64,
    pub snapshot_required: bool,
    pub cursor_error: Option<&'static str>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceTask {
    pub task_ref: String,
    pub scene_id: String,
    pub plugin_id: String,
    pub package_version: String,
    pub profile_version: String,
    pub operation_id: String,
    pub state: String,
    pub latest_sequence: u64,
    pub cancel_requested: bool,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TaskCursor {
    pub updated_at_ms: i64,
    pub task_ref: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePage {
    pub tasks: Vec<WorkspaceTask>,
    pub next_cursor: Option<TaskCursor>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceDetail {
    pub snapshot: Snapshot,
    pub events: Vec<Event>,
    pub earlier_events_available: bool,
}

pub(crate) struct Store(Mutex<Connection>);

impl Store {
    pub fn open(path: &Path) -> Result<Self, &'static str> {
        let connection = Connection::open(path).map_err(|_| "task_store_unavailable")?;
        Self::from_connection(connection)
    }

    fn from_connection(mut connection: Connection) -> Result<Self, &'static str> {
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(|_| "task_store_unavailable")?;
        connection
            .execute_batch("PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;")
            .map_err(|_| "task_store_unavailable")?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(|_| "task_store_unavailable")?;
        if version > 1 {
            return Err("task_store_version_unsupported");
        }
        if version == 0 {
            connection
                .execute_batch(
                    "BEGIN IMMEDIATE;
                    CREATE TABLE plugin_tasks (
                        task_ref TEXT PRIMARY KEY,
                        workspace_id TEXT NOT NULL, scene_id TEXT NOT NULL,
                        plugin_id TEXT NOT NULL, package_version TEXT NOT NULL,
                        profile_version TEXT NOT NULL, operation_id TEXT NOT NULL,
                        idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL,
                        state TEXT NOT NULL, latest_sequence INTEGER NOT NULL,
                        cancel_requested INTEGER NOT NULL, created_at_ms INTEGER NOT NULL,
                        updated_at_ms INTEGER NOT NULL,
                        UNIQUE(workspace_id, scene_id, plugin_id, package_version,
                               profile_version, operation_id, idempotency_key)
                    );
                    CREATE INDEX plugin_tasks_workspace_time
                        ON plugin_tasks(workspace_id, updated_at_ms);
                    CREATE TABLE plugin_task_events (
                        task_ref TEXT NOT NULL REFERENCES plugin_tasks(task_ref) ON DELETE CASCADE,
                        sequence INTEGER NOT NULL, state TEXT NOT NULL, at_ms INTEGER NOT NULL,
                        PRIMARY KEY(task_ref, sequence)
                    );
                    PRAGMA user_version=1;
                    COMMIT;",
                )
                .map_err(|_| "task_store_unavailable")?;
        }
        // No operation or confirmation recovery handler exists yet. A process
        // restart cannot resume these tasks or reuse a previous confirmation.
        // Keep recent records, but never revive them.
        let now = now_ms()?;
        let transaction = connection
            .transaction()
            .map_err(|_| "task_store_unavailable")?;
        let stranded: Vec<(String, i64)> = {
            let mut statement = transaction
                .prepare(
                    "SELECT task_ref,latest_sequence FROM plugin_tasks
                     WHERE state IN ('queued','running','awaiting_confirmation')",
                )
                .map_err(|_| "task_store_unavailable")?;
            let rows = statement
                .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|_| "task_store_unavailable")?;
            rows.collect::<Result<_, _>>()
                .map_err(|_| "task_store_unavailable")?
        };
        if !stranded.is_empty() {
            for (task_ref, previous_sequence) in stranded {
                let sequence = previous_sequence + 1;
                transaction
                    .execute(
                        "UPDATE plugin_tasks SET state='interrupted',latest_sequence=?2,
                         updated_at_ms=?3 WHERE task_ref=?1",
                        params![task_ref, sequence, now],
                    )
                    .map_err(|_| "task_store_unavailable")?;
                transaction
                    .execute(
                        "INSERT INTO plugin_task_events (task_ref,sequence,state,at_ms)
                         VALUES (?1,?2,'interrupted',?3)",
                        params![task_ref, sequence, now],
                    )
                    .map_err(|_| "task_store_unavailable")?;
                transaction
                    .execute(
                        "DELETE FROM plugin_task_events WHERE task_ref=?1 AND sequence<=?2",
                        params![task_ref, sequence - MAX_EVENTS_PER_TASK],
                    )
                    .map_err(|_| "task_store_unavailable")?;
            }
        }
        // Expiration must also run when a workspace stops submitting tasks.
        // Formerly active records remain available for review as terminal
        // interruptions until their retention period expires.
        transaction
            .execute(
                "DELETE FROM plugin_tasks WHERE updated_at_ms<?1
                 AND state IN ('succeeded','partial','declined','failed','cancelled','revoked','interrupted')",
                [now - RETENTION_MS],
            )
            .map_err(|_| "task_store_unavailable")?;
        transaction.commit().map_err(|_| "task_store_unavailable")?;
        Ok(Self(Mutex::new(connection)))
    }

    pub fn submit(
        &self,
        owner: &Owner,
        idempotency_key: &str,
        input: &Value,
    ) -> Result<Snapshot, &'static str> {
        if !owner.valid()
            || !(8..=128).contains(&idempotency_key.len())
            || !idempotency_key
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err("task_request_invalid");
        }
        let input = serde_json::to_vec(input).map_err(|_| "task_request_invalid")?;
        if input.len() > 16 * 1024 {
            return Err("task_request_too_large");
        }
        let input_hash = format!("{:x}", Sha256::digest(input));
        let now = now_ms()?;
        let mut connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "task_store_unavailable")?;
        // Expiration precedes idempotency lookup so an old terminal key does
        // not keep its record alive indefinitely through repeated retries.
        transaction
            .execute(
                "DELETE FROM plugin_tasks WHERE workspace_id=?1 AND updated_at_ms<?2
                 AND state IN ('succeeded','partial','declined','failed','cancelled','revoked','interrupted')",
                params![owner.workspace_id, now - RETENTION_MS],
            )
            .map_err(|_| "task_store_unavailable")?;
        let existing = transaction
            .query_row(
                "SELECT task_ref, input_hash FROM plugin_tasks WHERE workspace_id=?1 AND scene_id=?2
                 AND plugin_id=?3 AND package_version=?4 AND profile_version=?5
                 AND operation_id=?6 AND idempotency_key=?7",
                params![owner.workspace_id, owner.scene_id, owner.plugin_id, owner.package_version,
                    owner.profile_version, owner.operation_id, idempotency_key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|_| "task_store_unavailable")?;
        if let Some((task_ref, previous_hash)) = existing {
            if previous_hash != input_hash {
                return Err("task_idempotency_conflict");
            }
            let snapshot =
                snapshot_in(&transaction, &task_ref, owner)?.ok_or("task_store_unavailable")?;
            transaction.commit().map_err(|_| "task_store_unavailable")?;
            return Ok(snapshot);
        }
        let count: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM plugin_tasks WHERE workspace_id=?1",
                [&owner.workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| "task_store_unavailable")?;
        if count >= MAX_TASKS_PER_WORKSPACE {
            transaction
                .execute(
                    "DELETE FROM plugin_tasks WHERE task_ref IN (
                        SELECT task_ref FROM plugin_tasks WHERE workspace_id=?1
                        AND state IN ('succeeded','partial','declined','failed','cancelled','revoked','interrupted')
                        ORDER BY updated_at_ms, task_ref LIMIT ?2)",
                    params![owner.workspace_id, count - MAX_TASKS_PER_WORKSPACE + 1],
                )
                .map_err(|_| "task_store_unavailable")?;
            let remaining: i64 = transaction
                .query_row(
                    "SELECT COUNT(*) FROM plugin_tasks WHERE workspace_id=?1",
                    [&owner.workspace_id],
                    |row| row.get(0),
                )
                .map_err(|_| "task_store_unavailable")?;
            if remaining >= MAX_TASKS_PER_WORKSPACE {
                return Err("task_capacity_reached");
            }
        }
        let active_for_plugin: i64 = transaction
            .query_row(
                "SELECT COUNT(*) FROM plugin_tasks WHERE workspace_id=?1 AND plugin_id=?2
                 AND state IN ('queued','running','awaiting_confirmation')",
                params![owner.workspace_id, owner.plugin_id],
                |row| row.get(0),
            )
            .map_err(|_| "task_store_unavailable")?;
        if active_for_plugin >= MAX_ACTIVE_TASKS_PER_PLUGIN {
            return Err("task_plugin_capacity_reached");
        }
        let task_ref = uuid::Uuid::new_v4().simple().to_string();
        transaction
            .execute(
                "INSERT INTO plugin_tasks (task_ref,workspace_id,scene_id,plugin_id,package_version,
                 profile_version,operation_id,idempotency_key,input_hash,state,latest_sequence,
                 cancel_requested,created_at_ms,updated_at_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'queued',1,0,?10,?10)",
                params![task_ref, owner.workspace_id, owner.scene_id, owner.plugin_id,
                    owner.package_version, owner.profile_version, owner.operation_id,
                    idempotency_key, input_hash, now],
            )
            .map_err(|_| "task_store_unavailable")?;
        transaction
            .execute(
                "INSERT INTO plugin_task_events (task_ref,sequence,state,at_ms)
                 VALUES (?1,1,'queued',?2)",
                params![task_ref, now],
            )
            .map_err(|_| "task_store_unavailable")?;
        transaction.commit().map_err(|_| "task_store_unavailable")?;
        Ok(Snapshot {
            task_ref,
            state: "queued".into(),
            latest_sequence: 1,
            cancel_requested: false,
            created_at_ms: now,
            updated_at_ms: now,
        })
    }

    pub fn snapshot(&self, owner: &Owner, task_ref: &str) -> Result<Snapshot, &'static str> {
        if !owner.valid() || !valid_task_ref(task_ref) {
            return Err("task_not_found");
        }
        let connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        snapshot_in(&connection, task_ref, owner)?.ok_or("task_not_found")
    }

    /// Trusted Task Center overview. A plugin View must never choose a workspace
    /// for this query; the Host validates the workspace before calling it.
    pub fn list_workspace(
        &self,
        workspace_id: &str,
        before: Option<&TaskCursor>,
        limit: u16,
    ) -> Result<WorkspacePage, &'static str> {
        if workspace_id.is_empty()
            || workspace_id.len() > 256
            || !(1..=100).contains(&limit)
            || before
                .is_some_and(|cursor| cursor.updated_at_ms < 0 || !valid_task_ref(&cursor.task_ref))
        {
            return Err("task_request_invalid");
        }
        let connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let mut statement = connection
            .prepare(
                "SELECT task_ref,scene_id,plugin_id,package_version,profile_version,
                        operation_id,state,latest_sequence,cancel_requested,
                        created_at_ms,updated_at_ms
                 FROM plugin_tasks WHERE workspace_id=?1
                 AND (?2 IS NULL OR updated_at_ms<?2
                      OR (updated_at_ms=?2 AND task_ref<?3))
                 ORDER BY updated_at_ms DESC,task_ref DESC LIMIT ?4",
            )
            .map_err(|_| "task_store_unavailable")?;
        let rows = statement
            .query_map(
                params![
                    workspace_id,
                    before.map(|cursor| cursor.updated_at_ms),
                    before.map(|cursor| cursor.task_ref.as_str()),
                    i64::from(limit) + 1
                ],
                |row| {
                    Ok(WorkspaceTask {
                        task_ref: row.get(0)?,
                        scene_id: row.get(1)?,
                        plugin_id: row.get(2)?,
                        package_version: row.get(3)?,
                        profile_version: row.get(4)?,
                        operation_id: row.get(5)?,
                        state: row.get(6)?,
                        latest_sequence: row.get(7)?,
                        cancel_requested: row.get::<_, i64>(8)? != 0,
                        created_at_ms: row.get(9)?,
                        updated_at_ms: row.get(10)?,
                    })
                },
            )
            .map_err(|_| "task_store_unavailable")?;
        let mut tasks = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "task_store_unavailable")?;
        let has_more = tasks.len() > usize::from(limit);
        tasks.truncate(usize::from(limit));
        let next_cursor = if has_more {
            tasks.last().map(|task| TaskCursor {
                updated_at_ms: task.updated_at_ms,
                task_ref: task.task_ref.clone(),
            })
        } else {
            None
        };
        Ok(WorkspacePage { tasks, next_cursor })
    }

    /// Read-only desktop detail. The workspace is verified by the Host first;
    /// input hashes and idempotency keys are never returned.
    pub fn workspace_detail(
        &self,
        workspace_id: &str,
        task_ref: &str,
        before_sequence: Option<u64>,
    ) -> Result<WorkspaceDetail, &'static str> {
        if workspace_id.is_empty() || workspace_id.len() > 256 || !valid_task_ref(task_ref) {
            return Err("task_not_found");
        }
        if before_sequence.is_some_and(|sequence| sequence == 0 || sequence > i64::MAX as u64) {
            return Err("task_request_invalid");
        }
        let connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let snapshot = connection
            .query_row(
                "SELECT state,latest_sequence,cancel_requested,created_at_ms,updated_at_ms
                 FROM plugin_tasks WHERE workspace_id=?1 AND task_ref=?2",
                params![workspace_id, task_ref],
                |row| {
                    Ok(Snapshot {
                        task_ref: task_ref.into(),
                        state: row.get(0)?,
                        latest_sequence: row.get(1)?,
                        cancel_requested: row.get::<_, i64>(2)? != 0,
                        created_at_ms: row.get(3)?,
                        updated_at_ms: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|_| "task_store_unavailable")?
            .ok_or("task_not_found")?;
        let mut statement = connection
            .prepare(
                "SELECT sequence,state,at_ms FROM plugin_task_events
                 WHERE task_ref=?1 AND (?2 IS NULL OR sequence<?2)
                 ORDER BY sequence DESC LIMIT 65",
            )
            .map_err(|_| "task_store_unavailable")?;
        let rows = statement
            .query_map(params![task_ref, before_sequence], |row| {
                Ok(Event {
                    sequence: row.get(0)?,
                    state: row.get(1)?,
                    at_ms: row.get(2)?,
                })
            })
            .map_err(|_| "task_store_unavailable")?;
        let mut events = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "task_store_unavailable")?;
        let earlier_events_available = events.len() > 64;
        events.truncate(64);
        events.reverse();
        Ok(WorkspaceDetail {
            snapshot,
            events,
            earlier_events_available,
        })
    }

    pub fn transition(
        &self,
        owner: &Owner,
        task_ref: &str,
        next: State,
    ) -> Result<Snapshot, &'static str> {
        if !owner.valid() || !valid_task_ref(task_ref) {
            return Err("task_not_found");
        }
        let now = now_ms()?;
        let mut connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "task_store_unavailable")?;
        let previous = snapshot_in(&transaction, task_ref, owner)?.ok_or("task_not_found")?;
        let state = State::parse(&previous.state).ok_or("task_store_unavailable")?;
        if !state.can_transition_to(next)
            || (previous.cancel_requested
                && matches!(
                    next,
                    State::Running
                        | State::AwaitingConfirmation
                        | State::Succeeded
                        | State::Partial
                        | State::Declined
                ))
        {
            return Err("task_transition_invalid");
        }
        let sequence = previous.latest_sequence + 1;
        transaction
            .execute(
                "UPDATE plugin_tasks SET state=?2, latest_sequence=?3, updated_at_ms=?4
                 WHERE task_ref=?1",
                params![task_ref, next.as_str(), sequence, now],
            )
            .map_err(|_| "task_store_unavailable")?;
        transaction
            .execute(
                "INSERT INTO plugin_task_events (task_ref,sequence,state,at_ms) VALUES (?1,?2,?3,?4)",
                params![task_ref, sequence, next.as_str(), now],
            )
            .map_err(|_| "task_store_unavailable")?;
        transaction
            .execute(
                "DELETE FROM plugin_task_events WHERE task_ref=?1 AND sequence<=?2",
                params![task_ref, sequence as i64 - MAX_EVENTS_PER_TASK],
            )
            .map_err(|_| "task_store_unavailable")?;
        transaction.commit().map_err(|_| "task_store_unavailable")?;
        Ok(Snapshot {
            state: next.as_str().into(),
            latest_sequence: sequence,
            updated_at_ms: now,
            ..previous
        })
    }

    pub fn request_cancel(
        &self,
        owner: &Owner,
        task_ref: &str,
    ) -> Result<&'static str, &'static str> {
        if !owner.valid() || !valid_task_ref(task_ref) {
            return Err("task_not_found");
        }
        let connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let snapshot = snapshot_in(&connection, task_ref, owner)?.ok_or("task_not_found")?;
        if State::parse(&snapshot.state)
            .ok_or("task_store_unavailable")?
            .terminal()
        {
            return Ok("finished");
        }
        connection
            .execute(
                "UPDATE plugin_tasks SET cancel_requested=1 WHERE task_ref=?1",
                [task_ref],
            )
            .map_err(|_| "task_store_unavailable")?;
        Ok("requested")
    }

    /// Persist revocation for active tasks after a trusted Host plugin-state
    /// change. `None` revokes the plugin across scenes (uninstall/reload).
    pub fn revoke_plugin(
        &self,
        plugin_id: &str,
        scene_id: Option<&str>,
    ) -> Result<usize, &'static str> {
        if plugin_id.is_empty()
            || plugin_id.len() > 256
            || scene_id.is_some_and(|scene| scene.is_empty() || scene.len() > 256)
        {
            return Err("task_request_invalid");
        }
        let now = now_ms()?;
        let mut connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "task_store_unavailable")?;
        let active: Vec<(String, i64)> = {
            let mut statement = transaction
                .prepare(
                    "SELECT task_ref,latest_sequence FROM plugin_tasks
                     WHERE plugin_id=?1 AND (?2 IS NULL OR scene_id=?2)
                     AND state IN ('queued','running','awaiting_confirmation')",
                )
                .map_err(|_| "task_store_unavailable")?;
            let rows = statement
                .query_map(params![plugin_id, scene_id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|_| "task_store_unavailable")?
                .collect::<Result<_, _>>()
                .map_err(|_| "task_store_unavailable")?;
            rows
        };
        for (task_ref, previous_sequence) in &active {
            let sequence = previous_sequence + 1;
            transaction
                .execute(
                    "UPDATE plugin_tasks SET state='revoked',latest_sequence=?2,
                     updated_at_ms=?3 WHERE task_ref=?1",
                    params![task_ref, sequence, now],
                )
                .map_err(|_| "task_store_unavailable")?;
            transaction
                .execute(
                    "INSERT INTO plugin_task_events (task_ref,sequence,state,at_ms)
                     VALUES (?1,?2,'revoked',?3)",
                    params![task_ref, sequence, now],
                )
                .map_err(|_| "task_store_unavailable")?;
            transaction
                .execute(
                    "DELETE FROM plugin_task_events WHERE task_ref=?1 AND sequence<=?2",
                    params![task_ref, sequence - MAX_EVENTS_PER_TASK],
                )
                .map_err(|_| "task_store_unavailable")?;
        }
        transaction.commit().map_err(|_| "task_store_unavailable")?;
        Ok(active.len())
    }

    /// A normal Host shutdown cannot resume an unfinished plugin operation or
    /// confirmation. Keep its record as a terminal interruption for review.
    pub fn interrupt_active(&self) -> Result<usize, &'static str> {
        self.interrupt_active_matching(None)
    }

    /// A closed workspace cannot continue plugin work. Keep only its task
    /// records as terminal history; other workspaces continue running.
    pub fn interrupt_workspace(&self, workspace_id: &str) -> Result<usize, &'static str> {
        if workspace_id.is_empty() || workspace_id.len() > 256 {
            return Err("task_request_invalid");
        }
        self.interrupt_active_matching(Some(workspace_id))
    }

    fn interrupt_active_matching(&self, workspace_id: Option<&str>) -> Result<usize, &'static str> {
        let now = now_ms()?;
        let mut connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let transaction = connection
            .transaction()
            .map_err(|_| "task_store_unavailable")?;
        let active: Vec<(String, i64)> = {
            let mut statement = transaction
                .prepare(
                    "SELECT task_ref,latest_sequence FROM plugin_tasks
                     WHERE (?1 IS NULL OR workspace_id=?1)
                     AND state IN ('queued','running','awaiting_confirmation')",
                )
                .map_err(|_| "task_store_unavailable")?;
            let rows = statement
                .query_map(params![workspace_id], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|_| "task_store_unavailable")?
                .collect::<Result<_, _>>()
                .map_err(|_| "task_store_unavailable")?;
            rows
        };
        for (task_ref, previous_sequence) in &active {
            let sequence = previous_sequence + 1;
            transaction
                .execute(
                    "UPDATE plugin_tasks SET state='interrupted',latest_sequence=?2,
                     updated_at_ms=?3 WHERE task_ref=?1",
                    params![task_ref, sequence, now],
                )
                .map_err(|_| "task_store_unavailable")?;
            transaction
                .execute(
                    "INSERT INTO plugin_task_events (task_ref,sequence,state,at_ms)
                     VALUES (?1,?2,'interrupted',?3)",
                    params![task_ref, sequence, now],
                )
                .map_err(|_| "task_store_unavailable")?;
            transaction
                .execute(
                    "DELETE FROM plugin_task_events WHERE task_ref=?1 AND sequence<=?2",
                    params![task_ref, sequence - MAX_EVENTS_PER_TASK],
                )
                .map_err(|_| "task_store_unavailable")?;
        }
        transaction.commit().map_err(|_| "task_store_unavailable")?;
        Ok(active.len())
    }

    pub fn events(
        &self,
        owner: &Owner,
        task_ref: &str,
        after_sequence: u64,
        limit: u16,
    ) -> Result<EventPage, &'static str> {
        if !(1..=64).contains(&limit) {
            return Err("task_request_invalid");
        }
        let connection = self.0.lock().map_err(|_| "task_store_unavailable")?;
        let snapshot = snapshot_in(&connection, task_ref, owner)?.ok_or("task_not_found")?;
        let earliest: u64 = connection
            .query_row(
                "SELECT MIN(sequence) FROM plugin_task_events WHERE task_ref=?1",
                [task_ref],
                |row| row.get::<_, Option<u64>>(0),
            )
            .map_err(|_| "task_store_unavailable")?
            .ok_or("task_store_unavailable")?;
        let cursor_error = if after_sequence > snapshot.latest_sequence {
            Some("cursor_invalid")
        } else if after_sequence < earliest.saturating_sub(1) {
            Some("cursor_expired")
        } else {
            None
        };
        let mut events = Vec::new();
        if cursor_error.is_none() {
            let mut statement = connection
                .prepare(
                    "SELECT sequence,state,at_ms FROM plugin_task_events
                     WHERE task_ref=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3",
                )
                .map_err(|_| "task_store_unavailable")?;
            let rows = statement
                .query_map(params![task_ref, after_sequence, limit], |row| {
                    Ok(Event {
                        sequence: row.get(0)?,
                        state: row.get(1)?,
                        at_ms: row.get(2)?,
                    })
                })
                .map_err(|_| "task_store_unavailable")?;
            for row in rows {
                events.push(row.map_err(|_| "task_store_unavailable")?);
            }
        }
        let next_sequence = events.last().map_or(after_sequence, |event| event.sequence);
        Ok(EventPage {
            requested_after_sequence: after_sequence,
            has_more: cursor_error.is_none() && next_sequence < snapshot.latest_sequence,
            events,
            next_sequence,
            earliest_retained_sequence: earliest,
            latest_sequence: snapshot.latest_sequence,
            snapshot_required: cursor_error.is_some(),
            cursor_error,
        })
    }
}

fn snapshot_in(
    connection: &Connection,
    task_ref: &str,
    owner: &Owner,
) -> Result<Option<Snapshot>, &'static str> {
    connection
        .query_row(
            "SELECT state,latest_sequence,cancel_requested,created_at_ms,updated_at_ms
             FROM plugin_tasks WHERE task_ref=?1 AND workspace_id=?2 AND scene_id=?3
             AND plugin_id=?4 AND package_version=?5 AND profile_version=?6 AND operation_id=?7",
            params![
                task_ref,
                owner.workspace_id,
                owner.scene_id,
                owner.plugin_id,
                owner.package_version,
                owner.profile_version,
                owner.operation_id
            ],
            |row| {
                Ok(Snapshot {
                    task_ref: task_ref.into(),
                    state: row.get(0)?,
                    latest_sequence: row.get(1)?,
                    cancel_requested: row.get::<_, i64>(2)? != 0,
                    created_at_ms: row.get(3)?,
                    updated_at_ms: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|_| "task_store_unavailable")
}

fn valid_task_ref(task_ref: &str) -> bool {
    task_ref.len() == 32 && task_ref.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn now_ms() -> Result<i64, &'static str> {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "task_clock_unavailable")?
        .as_millis();
    i64::try_from(ms).map_err(|_| "task_clock_unavailable")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn store() -> Store {
        Store::from_connection(Connection::open_in_memory().unwrap()).unwrap()
    }

    fn owner() -> Owner {
        Owner {
            workspace_id: "workspace-a".into(),
            scene_id: "programming".into(),
            plugin_id: "com.example.tools".into(),
            package_version: "1.0.0".into(),
            profile_version: "1.0.0-preview.1".into(),
            operation_id: "service.inspect".into(),
        }
    }

    #[test]
    fn idempotency_and_owner_checks_are_enforced_without_storing_input() {
        let store = store();
        let first = store
            .submit(
                &owner(),
                "request_12345678",
                &json!({"token":"sensitive","a":1}),
            )
            .unwrap();
        let replay = store
            .submit(
                &owner(),
                "request_12345678",
                &json!({"a":1,"token":"sensitive"}),
            )
            .unwrap();
        assert_eq!(first, replay);
        assert_eq!(
            store.submit(&owner(), "request_12345678", &json!({"a":2})),
            Err("task_idempotency_conflict")
        );
        let mut foreign = owner();
        foreign.workspace_id = "workspace-b".into();
        assert_eq!(
            store.snapshot(&foreign, &first.task_ref),
            Err("task_not_found")
        );
        foreign = owner();
        foreign.plugin_id = "com.example.other".into();
        assert_eq!(
            store.snapshot(&foreign, &first.task_ref),
            Err("task_not_found")
        );
        let connection = store.0.lock().unwrap();
        let raw: String = connection
            .query_row("SELECT input_hash FROM plugin_tasks", [], |row| row.get(0))
            .unwrap();
        assert!(!raw.contains("sensitive"));
        assert_eq!(raw.len(), 64);
    }

    #[test]
    fn expired_terminal_key_is_released_before_idempotency_lookup() {
        let store = store();
        let first = store
            .submit(&owner(), "request_12345678", &json!({"step":1}))
            .unwrap();
        store
            .transition(&owner(), &first.task_ref, State::Failed)
            .unwrap();
        {
            let connection = store.0.lock().unwrap();
            connection
                .execute(
                    "UPDATE plugin_tasks SET updated_at_ms=?2 WHERE task_ref=?1",
                    params![first.task_ref, now_ms().unwrap() - RETENTION_MS - 1],
                )
                .unwrap();
        }
        let replacement = store
            .submit(&owner(), "request_12345678", &json!({"step":2}))
            .unwrap();
        assert_ne!(first.task_ref, replacement.task_ref);
        assert_eq!(
            store.snapshot(&owner(), &first.task_ref),
            Err("task_not_found")
        );
        assert_eq!(
            store
                .events(&owner(), &replacement.task_ref, 0, 64)
                .unwrap()
                .events
                .len(),
            1
        );
    }

    #[test]
    fn replay_and_terminal_state_are_bounded_and_immutable() {
        let store = store();
        let task = store
            .submit(&owner(), "request_12345678", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &task.task_ref, State::Running)
            .unwrap();
        store
            .transition(&owner(), &task.task_ref, State::AwaitingConfirmation)
            .unwrap();
        let page = store.events(&owner(), &task.task_ref, 0, 2).unwrap();
        assert_eq!(page.events.len(), 2);
        assert_eq!(page.next_sequence, 2);
        assert!(page.has_more);
        assert_eq!(
            store
                .events(&owner(), &task.task_ref, 99, 2)
                .unwrap()
                .cursor_error,
            Some("cursor_invalid")
        );
        store
            .transition(&owner(), &task.task_ref, State::Declined)
            .unwrap();
        assert_eq!(
            store.request_cancel(&owner(), &task.task_ref),
            Ok("finished")
        );
        assert_eq!(
            store.transition(&owner(), &task.task_ref, State::Running),
            Err("task_transition_invalid")
        );
    }

    #[test]
    fn cancellation_request_does_not_fake_terminal_cleanup() {
        let store = store();
        let task = store
            .submit(&owner(), "request_12345678", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &task.task_ref, State::Running)
            .unwrap();
        assert_eq!(
            store.request_cancel(&owner(), &task.task_ref),
            Ok("requested")
        );
        let pending = store.snapshot(&owner(), &task.task_ref).unwrap();
        assert_eq!(pending.state, "running");
        assert!(pending.cancel_requested);
        assert_eq!(
            store.transition(&owner(), &task.task_ref, State::Succeeded),
            Err("task_transition_invalid")
        );
        store
            .transition(&owner(), &task.task_ref, State::Cancelled)
            .unwrap();
        assert_eq!(
            store.request_cancel(&owner(), &task.task_ref),
            Ok("finished")
        );
    }

    #[test]
    fn plugin_revocation_is_scoped_and_never_rewrites_terminal_events() {
        let store = store();
        let queued = store
            .submit(&owner(), "request_queued", &json!({}))
            .unwrap();
        let running = store
            .submit(&owner(), "request_running", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &running.task_ref, State::Running)
            .unwrap();
        let mut other_scene = owner();
        other_scene.scene_id = "research".into();
        let preserved = store
            .submit(&other_scene, "request_other_scene", &json!({}))
            .unwrap();
        let terminal = store
            .submit(&owner(), "request_terminal", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &terminal.task_ref, State::Failed)
            .unwrap();

        assert_eq!(
            store.revoke_plugin(&owner().plugin_id, Some("programming")),
            Ok(2)
        );
        assert_eq!(
            store.revoke_plugin(&owner().plugin_id, Some("programming")),
            Ok(0)
        );
        for (task_ref, sequence) in [(&queued.task_ref, 2), (&running.task_ref, 3)] {
            let snapshot = store.snapshot(&owner(), task_ref).unwrap();
            assert_eq!(snapshot.state, "revoked");
            assert_eq!(snapshot.latest_sequence, sequence);
            assert_eq!(
                store
                    .events(&owner(), task_ref, sequence - 1, 64)
                    .unwrap()
                    .events[0]
                    .state,
                "revoked"
            );
        }
        assert_eq!(
            store.snapshot(&owner(), &terminal.task_ref).unwrap().state,
            "failed"
        );
        assert_eq!(
            store
                .snapshot(&other_scene, &preserved.task_ref)
                .unwrap()
                .state,
            "queued"
        );
        assert_eq!(store.revoke_plugin(&owner().plugin_id, None), Ok(1));
        assert_eq!(
            store
                .snapshot(&other_scene, &preserved.task_ref)
                .unwrap()
                .state,
            "revoked"
        );
    }

    #[test]
    fn shutdown_interrupts_active_tasks_once_and_preserves_terminal_history() {
        let store = store();
        let queued = store.submit(&owner(), "shutdown_queued", &json!({})).unwrap();
        let running = store.submit(&owner(), "shutdown_running", &json!({})).unwrap();
        store
            .transition(&owner(), &running.task_ref, State::Running)
            .unwrap();
        let awaiting = store.submit(&owner(), "shutdown_awaiting", &json!({})).unwrap();
        store
            .transition(&owner(), &awaiting.task_ref, State::Running)
            .unwrap();
        store
            .transition(&owner(), &awaiting.task_ref, State::AwaitingConfirmation)
            .unwrap();
        let terminal = store.submit(&owner(), "shutdown_terminal", &json!({})).unwrap();
        store
            .transition(&owner(), &terminal.task_ref, State::Failed)
            .unwrap();

        assert_eq!(store.interrupt_active(), Ok(3));
        assert_eq!(store.interrupt_active(), Ok(0));
        for (task_ref, sequence) in [
            (&queued.task_ref, 2),
            (&running.task_ref, 3),
            (&awaiting.task_ref, 4),
        ] {
            let snapshot = store.snapshot(&owner(), task_ref).unwrap();
            assert_eq!(snapshot.state, "interrupted");
            assert_eq!(snapshot.latest_sequence, sequence);
            assert_eq!(
                store.events(&owner(), task_ref, sequence - 1, 64).unwrap().events[0].state,
                "interrupted"
            );
        }
        assert_eq!(store.snapshot(&owner(), &terminal.task_ref).unwrap().state, "failed");
    }

    #[test]
    fn workspace_close_interrupts_only_its_active_tasks() {
        let store = store();
        let current = owner();
        let mut other = current.clone();
        other.workspace_id = "workspace-b".into();
        let running = store.submit(&current, "close_running", &json!({})).unwrap();
        store.transition(&current, &running.task_ref, State::Running).unwrap();
        let awaiting = store.submit(&current, "close_awaiting", &json!({})).unwrap();
        store.transition(&current, &awaiting.task_ref, State::Running).unwrap();
        store.transition(&current, &awaiting.task_ref, State::AwaitingConfirmation).unwrap();
        let preserved = store.submit(&other, "other_running", &json!({})).unwrap();
        store.transition(&other, &preserved.task_ref, State::Running).unwrap();

        assert_eq!(store.interrupt_workspace(&current.workspace_id), Ok(2));
        assert_eq!(store.interrupt_workspace(&current.workspace_id), Ok(0));
        assert_eq!(store.snapshot(&current, &running.task_ref).unwrap().state, "interrupted");
        assert_eq!(store.snapshot(&current, &awaiting.task_ref).unwrap().state, "interrupted");
        assert_eq!(store.snapshot(&other, &preserved.task_ref).unwrap().state, "running");
        assert_eq!(
            store.events(&current, &awaiting.task_ref, 3, 64).unwrap().events[0].state,
            "interrupted"
        );
    }

    #[test]
    fn one_plugin_cannot_fill_the_workspace_with_live_tasks() {
        let store = store();
        for index in 0..MAX_ACTIVE_TASKS_PER_PLUGIN {
            store
                .submit(&owner(), &format!("request_{index:08}"), &json!({}))
                .unwrap();
        }
        assert_eq!(
            store.submit(&owner(), "request_overflow", &json!({})),
            Err("task_plugin_capacity_reached")
        );
        let mut other = owner();
        other.plugin_id = "com.example.other".into();
        assert!(store.submit(&other, "request_other", &json!({})).is_ok());
    }

    #[test]
    fn event_replay_expires_old_cursor_after_retention_limit() {
        let store = store();
        let task = store
            .submit(&owner(), "request_12345678", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &task.task_ref, State::Running)
            .unwrap();
        for _ in 0..130 {
            store
                .transition(&owner(), &task.task_ref, State::AwaitingConfirmation)
                .unwrap();
            store
                .transition(&owner(), &task.task_ref, State::Running)
                .unwrap();
        }
        let page = store.events(&owner(), &task.task_ref, 0, 64).unwrap();
        assert_eq!(page.cursor_error, Some("cursor_expired"));
        assert!(page.snapshot_required);
        assert!(page.events.is_empty());
        let page = store
            .events(
                &owner(),
                &task.task_ref,
                page.earliest_retained_sequence - 1,
                64,
            )
            .unwrap();
        assert_eq!(page.events.len(), 64);
        assert!(page.has_more);
    }

    #[test]
    fn workspace_overview_pages_safe_metadata_without_cross_workspace_rows() {
        let store = store();
        let first = store
            .submit(&owner(), "request_first", &json!({"secret":"hidden"}))
            .unwrap();
        let second = store
            .submit(&owner(), "request_second", &json!({}))
            .unwrap();
        let mut other_plugin = owner();
        other_plugin.plugin_id = "com.example.other".into();
        let third = store
            .submit(&other_plugin, "request_third", &json!({}))
            .unwrap();
        let mut other_workspace = owner();
        other_workspace.workspace_id = "workspace-b".into();
        let foreign = store
            .submit(&other_workspace, "request_foreign", &json!({}))
            .unwrap();
        {
            let connection = store.0.lock().unwrap();
            for (task_ref, timestamp) in [
                (&first.task_ref, 300),
                (&second.task_ref, 200),
                (&third.task_ref, 100),
                (&foreign.task_ref, 400),
            ] {
                connection
                    .execute(
                        "UPDATE plugin_tasks SET updated_at_ms=?2 WHERE task_ref=?1",
                        params![task_ref, timestamp],
                    )
                    .unwrap();
            }
        }
        let page = store.list_workspace("workspace-a", None, 2).unwrap();
        assert_eq!(page.tasks.len(), 2);
        assert_eq!(page.tasks[0].task_ref, first.task_ref);
        assert_eq!(page.tasks[1].task_ref, second.task_ref);
        assert!(page.next_cursor.is_some());
        let next = store
            .list_workspace("workspace-a", page.next_cursor.as_ref(), 2)
            .unwrap();
        assert_eq!(next.tasks.len(), 1);
        assert_eq!(next.tasks[0].task_ref, third.task_ref);
        assert_eq!(next.tasks[0].plugin_id, other_plugin.plugin_id);
        assert!(next.next_cursor.is_none());
        let shown = serde_json::to_string(&(page, next)).unwrap();
        assert!(!shown.contains("hidden"));
        assert!(!shown.contains(&foreign.task_ref));
        assert_eq!(
            store.list_workspace("workspace-a", None, 0),
            Err("task_request_invalid")
        );
    }

    #[test]
    fn task_state_survives_reopening_its_project_owned_database() {
        let scratch = Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("plugin-task-store-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("owner.json"),
            br#"{"purpose":"plugin task store persistence test","lifetime":"remove on success"}"#,
        )
        .unwrap();
        let database = root.join("plugin-tasks.sqlite3");
        let store = Store::open(&database).unwrap();
        let task = store
            .submit(&owner(), "request_12345678", &json!({"url":"hidden"}))
            .unwrap();
        store
            .transition(&owner(), &task.task_ref, State::Running)
            .unwrap();
        let expired = store
            .submit(&owner(), "request_expired", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &expired.task_ref, State::Failed)
            .unwrap();
        let queued = store
            .submit(&owner(), "request_queued", &json!({}))
            .unwrap();
        let awaiting = store
            .submit(&owner(), "request_awaiting", &json!({}))
            .unwrap();
        store
            .transition(&owner(), &awaiting.task_ref, State::Running)
            .unwrap();
        store
            .transition(&owner(), &awaiting.task_ref, State::AwaitingConfirmation)
            .unwrap();
        let old_queued = store
            .submit(&owner(), "request_old_queued", &json!({}))
            .unwrap();
        {
            let connection = store.0.lock().unwrap();
            for task_ref in [&expired.task_ref, &old_queued.task_ref] {
                connection
                    .execute(
                        "UPDATE plugin_tasks SET updated_at_ms=?2 WHERE task_ref=?1",
                        params![task_ref, now_ms().unwrap() - RETENTION_MS - 1],
                    )
                    .unwrap();
            }
        }
        drop(store);
        let reopened = Store::open(&database).unwrap();
        let snapshot = reopened.snapshot(&owner(), &task.task_ref).unwrap();
        assert_eq!(snapshot.state, "interrupted");
        assert_eq!(snapshot.latest_sequence, 3);
        assert_eq!(
            reopened
                .events(&owner(), &task.task_ref, 0, 64)
                .unwrap()
                .events
                .len(),
            3
        );
        assert_eq!(
            reopened.snapshot(&owner(), &expired.task_ref),
            Err("task_not_found")
        );
        let queued_snapshot = reopened.snapshot(&owner(), &queued.task_ref).unwrap();
        assert_eq!(queued_snapshot.state, "interrupted");
        assert_eq!(queued_snapshot.latest_sequence, 2);
        assert_eq!(
            reopened
                .events(&owner(), &queued.task_ref, 0, 64)
                .unwrap()
                .events
                .len(),
            2
        );
        let awaiting_snapshot = reopened.snapshot(&owner(), &awaiting.task_ref).unwrap();
        assert_eq!(awaiting_snapshot.state, "interrupted");
        assert_eq!(awaiting_snapshot.latest_sequence, 4);
        assert_eq!(
            reopened
                .events(&owner(), &awaiting.task_ref, 0, 64)
                .unwrap()
                .events
                .len(),
            4
        );
        // Retention starts when this old live task becomes terminal on reopen.
        // It is kept for review rather than silently dropped as stale input.
        assert_eq!(
            reopened
                .snapshot(&owner(), &old_queued.task_ref)
                .unwrap()
                .state,
            "interrupted"
        );
        drop(reopened);
        std::fs::remove_dir_all(root).unwrap();
    }
}

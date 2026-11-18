use crate::notes_sync::{SyncError, SyncOutcome};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    pub run_id: Option<String>,
    pub running: bool,
    pub state: String,
    pub retry_after_seconds: Option<u64>,
    pub conflict_count: usize,
}
struct Record {
    status: Status,
    cancel: CancellationToken,
}
#[derive(Default)]
pub(crate) struct Runs(Mutex<HashMap<String, Arc<Mutex<Record>>>>);
pub(crate) struct Run(Arc<Mutex<Record>>);
impl Runs {
    pub(crate) fn status(&self, workspace: &str) -> Result<Status, String> {
        let records = self.0.lock().map_err(|_| "notes_sync_task_unavailable")?;
        match records.get(workspace) {
            Some(record) => Ok(record
                .lock()
                .map_err(|_| "notes_sync_task_unavailable")?
                .status
                .clone()),
            None => Ok(Status {
                state: "idle".into(),
                ..Status::default()
            }),
        }
    }
    pub(crate) fn begin(&self, workspace: &str) -> Result<Run, String> {
        let mut records = self.0.lock().map_err(|_| "notes_sync_task_unavailable")?;
        if records
            .get(workspace)
            .is_some_and(|record| record.lock().map_or(true, |r| r.status.running))
        {
            return Err("notes_sync_task_busy".into());
        }
        if records.len() >= 64 && !records.contains_key(workspace) {
            let finished = records.iter().find_map(|(key, value)| {
                value
                    .lock()
                    .ok()
                    .filter(|r| !r.status.running)
                    .map(|_| key.clone())
            });
            match finished {
                Some(key) => {
                    records.remove(&key);
                }
                None => return Err("notes_sync_task_busy".into()),
            }
        }
        let record = Arc::new(Mutex::new(Record {
            status: Status {
                run_id: Some(uuid::Uuid::new_v4().to_string()),
                running: true,
                state: "running".into(),
                ..Status::default()
            },
            cancel: CancellationToken::new(),
        }));
        records.insert(workspace.to_owned(), record.clone());
        Ok(Run(record))
    }
    pub(crate) fn cancel(&self, workspace: &str, run_id: &str) -> Result<Status, String> {
        let records = self.0.lock().map_err(|_| "notes_sync_task_unavailable")?;
        let record = records.get(workspace).ok_or("notes_sync_task_changed")?;
        let record = record.lock().map_err(|_| "notes_sync_task_unavailable")?;
        if record.status.run_id.as_deref() != Some(run_id) {
            return Err("notes_sync_task_changed".into());
        }
        record.cancel.cancel();
        Ok(record.status.clone())
    }
}
impl Run {
    pub(crate) fn status(&self) -> Result<Status, String> {
        Ok(self
            .0
            .lock()
            .map_err(|_| "notes_sync_task_unavailable")?
            .status
            .clone())
    }
    pub(crate) fn token(&self) -> CancellationToken {
        self.0.lock().expect("owned sync run").cancel.clone()
    }
    pub(crate) fn finish(self, outcome: Result<SyncOutcome, SyncError>) {
        if let Ok(mut record) = self.0.lock() {
            let (state, retry, conflicts) = match outcome {
                Ok(SyncOutcome::Synced { .. }) => ("synced", None, 0),
                Ok(SyncOutcome::Conflicts(pending)) => ("conflicts", None, pending.conflicts.len()),
                Err(SyncError::RateLimited {
                    retry_after_seconds,
                }) => ("rateLimited", Some(retry_after_seconds), 0),
                Err(error) => (
                    match error {
                        SyncError::Cancelled => "cancelled",
                        SyncError::ConfigurationChanged => "settingsChanged",
                        SyncError::LocalChanged => "localChanged",
                        SyncError::Authentication => "authentication",
                        SyncError::Network => "network",
                        SyncError::Busy => "busy",
                        SyncError::RemoteChanged => "remoteChanged",
                        SyncError::RemoteReset => "remoteReset",
                        SyncError::UnsupportedServer => "unsupportedServer",
                        SyncError::Decryption | SyncError::InvalidKey => "invalidKey",
                        SyncError::TooLarge => "tooLarge",
                        _ => "failed",
                    },
                    None,
                    0,
                ),
            };
            record.status.running = false;
            record.status.state = state.into();
            record.status.retry_after_seconds = retry;
            record.status.conflict_count = conflicts;
        }
    }
}
impl Drop for Run {
    fn drop(&mut self) {
        if let Ok(mut record) = self.0.lock() {
            if record.status.running {
                record.status.running = false;
                record.status.state = "interrupted".into();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn run_identity_prevents_duplicate_start_and_stale_cancel() {
        let runs = Runs::default();
        let run = runs.begin("a").unwrap();
        assert!(runs.begin("a").is_err());
        let status = runs.status("a").unwrap();
        assert!(status.running);
        assert!(runs.cancel("a", "other-run").is_err());
        assert!(!run.token().is_cancelled());
        runs.cancel("a", status.run_id.as_deref().unwrap()).unwrap();
        assert!(run.token().is_cancelled());
        run.finish(Err(SyncError::Cancelled));
        assert_eq!(runs.status("a").unwrap().state, "cancelled");
        assert!(!runs.status("b").unwrap().running);
    }
    #[test]
    fn dropped_run_is_interrupted_and_can_be_retried_without_erasing_other_scope() {
        let runs = Runs::default();
        drop(runs.begin("a").unwrap());
        assert_eq!(runs.status("a").unwrap().state, "interrupted");
        let b = runs.begin("b").unwrap();
        let a = runs.begin("a").unwrap();
        a.finish(Err(SyncError::ConfigurationChanged));
        assert_eq!(runs.status("a").unwrap().state, "settingsChanged");
        assert!(runs.status("b").unwrap().running);
        drop(b);
    }
    #[test]
    fn start_receipt_keeps_its_own_identity_after_a_fast_run_is_replaced() {
        let runs = Runs::default();
        let first = runs.begin("workspace").unwrap();
        let receipt = first.status().unwrap();
        first.finish(Err(SyncError::Cancelled));
        let replacement = runs.begin("workspace").unwrap();
        assert_ne!(receipt.run_id, replacement.status().unwrap().run_id);
        assert_eq!(receipt.state, "running");
        assert!(runs
            .cancel("workspace", receipt.run_id.as_deref().unwrap())
            .is_err());
        assert!(
            !replacement.token().is_cancelled(),
            "an old Start receipt cannot cancel a replacement task"
        );
    }

    #[test]
    fn result_summary_is_bounded_and_contains_no_remote_error_body_or_note_content() {
        let runs = Runs::default();
        runs.begin("a").unwrap().finish(Err(SyncError::RateLimited {
            retry_after_seconds: 42,
        }));
        let value = serde_json::to_value(runs.status("a").unwrap()).unwrap();
        assert_eq!(value["state"], "rateLimited");
        assert_eq!(value["retryAfterSeconds"], 42);
        assert!(!value["running"].as_bool().unwrap());
        runs.begin("a").unwrap().finish(Err(SyncError::Http(503)));
        assert_eq!(runs.status("a").unwrap().state, "failed");
    }
}

#[cfg(test)]
mod contract_tests {
    use super::*;
    use crate::notes_sync::{Manifest, Snapshot};
    #[test]
    fn actual_run_summaries_match_the_frontend_shared_response_contract() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/notes-sync-task/contract.json"
        ))
        .unwrap();
        let assert_response = |name: &str, status: Status| {
            let mut actual = serde_json::to_value(status).unwrap();
            if let Some(run_id) = actual["runId"].as_str() {
                assert!(uuid::Uuid::parse_str(run_id).is_ok());
                actual["runId"] = serde_json::json!("run-owned");
            }
            assert_eq!(actual, fixture["responses"][name]);
        };
        let runs = Runs::default();
        assert_response("idle", runs.status("workspace-a").unwrap());
        let first = runs.begin("workspace-a").unwrap();
        assert_response("running", runs.status("workspace-a").unwrap());
        first.finish(Ok(SyncOutcome::Synced {
            manifest: Manifest::empty(&uuid::Uuid::new_v4().to_string()).unwrap(),
            snapshot: Snapshot::new(),
        }));
        assert_response("synced", runs.status("workspace-a").unwrap());
        runs.begin("workspace-a")
            .unwrap()
            .finish(Err(SyncError::Cancelled));
        assert_response("cancelled", runs.status("workspace-a").unwrap());
    }
}

//! Surface Host-managed tasks whose child runtime disappeared after a crash
//! or application restart. An unknown result requires review, not replay.

use crate::automation_persistence::{read_document, write_document, DocumentKind};
use crate::native_pi_manager::NativePiManager;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use super::lifecycle::HostLifecycle;

const START_GRACE: i64 = 120;
const MAX_PER_SCAN: usize = 32;
const MAX_PER_WORKSPACE: usize = 4;

struct Candidate {
    file: PathBuf,
    task_id: String,
    instance_id: String,
}

pub(super) async fn run(
    roots: Arc<RwLock<HashMap<String, PathBuf>>>,
    runtimes: NativePiManager,
    lifecycle: HostLifecycle,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(60));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut cursor = 0usize;
    loop {
        ticker.tick().await;
        let roots = roots.clone();
        let runtimes = runtimes.clone();
        let stop = lifecycle.clone();
        if let Err(error) = lifecycle
            .blocking(move || scan(&roots, &runtimes, &stop, cursor))
            .await
        {
            log::warn!("[automation] orphan task scan stopped: {error}");
        }
        cursor = cursor.wrapping_add(1);
    }
}

fn scan(
    roots: &Arc<RwLock<HashMap<String, PathBuf>>>,
    runtimes: &NativePiManager,
    lifecycle: &HostLifecycle,
    cursor: usize,
) {
    let Ok(roots) = roots.read() else { return };
    let mut files: Vec<PathBuf> = roots
        .values()
        .map(|root| root.join(".zicode").join("tasks").join("tasks.json"))
        .collect();
    drop(roots);
    files.sort();
    files.dedup();
    if !files.is_empty() {
        let offset = cursor % files.len();
        files.rotate_left(offset);
    }
    let mut candidates = Vec::new();
    for file in files {
        if lifecycle.stopping() {
            return;
        }
        let snapshot = match read_document(&file, DocumentKind::Tasks) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => continue,
            Err(code) => {
                log::warn!(
                    "[automation] cannot scan running tasks {}: {code}",
                    file.display()
                );
                continue;
            }
        };
        let mut eligible_tasks: Vec<&Value> = snapshot
            .value
            .get("tasks")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|task| eligible(task, Utc::now()))
            .collect();
        if !eligible_tasks.is_empty() {
            let offset = cursor % eligible_tasks.len();
            eligible_tasks.rotate_left(offset);
        }
        for task in eligible_tasks.into_iter().take(MAX_PER_WORKSPACE) {
            let Some(task_id) = task.get("id").and_then(Value::as_str) else {
                continue;
            };
            let Some(instance_id) = task
                .pointer("/dispatch/childInstanceId")
                .and_then(Value::as_str)
            else {
                continue;
            };
            candidates.push(Candidate {
                file: file.clone(),
                task_id: task_id.to_owned(),
                instance_id: instance_id.to_owned(),
            });
            if candidates.len() >= MAX_PER_SCAN {
                break;
            }
        }
        if candidates.len() >= MAX_PER_SCAN {
            break;
        }
    }
    for candidate in candidates {
        if lifecycle.stopping() {
            return;
        }
        match runtimes.is_instance_live(&candidate.instance_id) {
            Ok(true) => continue,
            Ok(false) => {}
            Err(error) => {
                log::warn!("[automation] cannot inspect child runtime: {error}");
                continue;
            }
        }
        if let Err(code) = mark_missing(&candidate, runtimes) {
            if !matches!(code, "task_conflict" | "task_store_busy") {
                log::warn!("[automation] cannot mark missing child runtime: {code}");
            }
        }
    }
}

fn eligible(task: &Value, now: DateTime<Utc>) -> bool {
    if task.get("status").and_then(Value::as_str) != Some("running")
        || task
            .pointer("/dispatch/hostManaged")
            .and_then(Value::as_bool)
            != Some(true)
        || task
            .pointer("/dispatch/childInstanceId")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
    {
        return false;
    }
    task.pointer("/dispatch/startedAt")
        .and_then(Value::as_str)
        .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
        .is_some_and(|started| {
            now.signed_duration_since(started.with_timezone(&Utc))
                .num_seconds()
                >= START_GRACE
        })
}

fn mark_missing(candidate: &Candidate, runtimes: &NativePiManager) -> Result<(), &'static str> {
    for attempt in 0..3 {
        if runtimes
            .is_instance_live(&candidate.instance_id)
            .map_err(|_| "runtime_registry_unavailable")?
        {
            return Ok(());
        }
        let Some(mut snapshot) = read_document(&candidate.file, DocumentKind::Tasks)? else {
            return Ok(());
        };
        let Some(task) = snapshot
            .value
            .get_mut("tasks")
            .and_then(Value::as_array_mut)
            .and_then(|tasks| {
                tasks
                    .iter_mut()
                    .find(|task| task.get("id").and_then(Value::as_str) == Some(&candidate.task_id))
            })
        else {
            return Ok(());
        };
        if !eligible(task, Utc::now())
            || task
                .pointer("/dispatch/childInstanceId")
                .and_then(Value::as_str)
                != Some(&candidate.instance_id)
        {
            return Ok(());
        }
        let title = task
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
            .unwrap_or("Automation task")
            .to_owned();
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let reason = "The project agent runtime is no longer available. Review the child session before resuming this task.";
        task["status"] = json!("blocked");
        task["failReason"] = json!(reason);
        task["result"] =
            json!({"status":"blocked", "summary":null, "completedAt":null, "failReason":reason});
        task["dispatch"]["orphanedAt"] = json!(now);
        if !task.get("events").is_some_and(Value::is_array) {
            task["events"] = json!([]);
        }
        if let Some(events) = task.get_mut("events").and_then(Value::as_array_mut) {
            events.push(
                json!({"at":now,"type":"runtime_missing","status":"blocked","message":reason}),
            );
        }
        match write_document(
            &candidate.file,
            DocumentKind::Tasks,
            &snapshot.revision,
            &snapshot.value,
        ) {
            Ok(_) => {
                crate::send_desktop_notification("Task needs review".to_owned(), title);
                return Ok(());
            }
            Err("task_conflict" | "task_store_busy") if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(40 * (attempt + 1)))
            }
            Err(code) => return Err(code),
        }
    }
    Ok(())
}

//! Reconcile task outcomes with automation history across all workspaces.
//! The task event time is the stable run key shared with the page scheduler.

use crate::automation_persistence::{read_document, write_document, DocumentKind};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use super::lifecycle::HostLifecycle;

const MAX_PER_SCAN: usize = 32;
const MAX_PER_WORKSPACE: usize = 4;

pub(super) async fn run(roots: Arc<RwLock<HashMap<String, PathBuf>>>, lifecycle: HostLifecycle) {
    let mut ticker = tokio::time::interval(Duration::from_secs(20));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut cursor = 0usize;
    loop {
        ticker.tick().await;
        let roots = roots.clone();
        let stop = lifecycle.clone();
        if let Err(error) = lifecycle
            .blocking(move || scan(&roots, cursor, &stop))
            .await
        {
            log::warn!("[automation] run reconciliation stopped: {error}");
        }
        cursor = cursor.wrapping_add(1);
    }
}

fn scan(roots: &Arc<RwLock<HashMap<String, PathBuf>>>, cursor: usize, lifecycle: &HostLifecycle) {
    let Ok(roots) = roots.read() else { return };
    let mut paths: Vec<PathBuf> = roots.values().cloned().collect();
    drop(roots);
    paths.sort();
    paths.dedup();
    if !paths.is_empty() {
        let offset = cursor % paths.len();
        paths.rotate_left(offset);
    }
    let mut processed = 0;
    for root in paths {
        if lifecycle.stopping() {
            return;
        }
        if processed >= MAX_PER_SCAN {
            break;
        }
        if !root.is_dir() {
            continue;
        }
        let file = root
            .join(".zicode")
            .join("automation")
            .join("workflows.json");
        let snapshot = match read_document(&file, DocumentKind::Workflows) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => continue,
            Err(code) => {
                log::warn!(
                    "[automation] cannot read run history {}: {code}",
                    root.display()
                );
                continue;
            }
        };
        let mut ids: Vec<String> = snapshot
            .value
            .get("workflows")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|rule| {
                matches!(
                    rule.pointer("/history/0/status").and_then(Value::as_str),
                    Some("queued" | "retry_queued")
                )
            })
            .filter_map(|rule| rule.get("id").and_then(Value::as_str).map(str::to_owned))
            .collect();
        if !ids.is_empty() {
            let offset = cursor % ids.len();
            ids.rotate_left(offset);
        }
        for id in ids.into_iter().take(MAX_PER_WORKSPACE) {
            if lifecycle.stopping() {
                return;
            }
            if processed >= MAX_PER_SCAN {
                break;
            }
            processed += 1;
            if let Err(code) = reconcile_one(&root, &id) {
                if !matches!(
                    code,
                    "task_conflict"
                        | "task_store_busy"
                        | "automation_workspace_conflict"
                        | "automation_workspace_busy"
                ) {
                    log::warn!(
                        "[automation] cannot reconcile task in {}: {code}",
                        root.display()
                    );
                }
            }
        }
    }
}

fn reconcile_one(root: &Path, workflow_id: &str) -> Result<(), &'static str> {
    let rules_file = root
        .join(".zicode")
        .join("automation")
        .join("workflows.json");
    let tasks_file = root.join(".zicode").join("tasks").join("tasks.json");
    let Some(rules) = read_document(&rules_file, DocumentKind::Workflows)? else {
        return Ok(());
    };
    let Some(rule) = rules
        .value
        .get("workflows")
        .and_then(Value::as_array)
        .and_then(|rules| {
            rules
                .iter()
                .find(|rule| rule.get("id").and_then(Value::as_str) == Some(workflow_id))
        })
    else {
        return Ok(());
    };
    let Some(last) = rule
        .get("history")
        .and_then(Value::as_array)
        .and_then(|history| history.first())
    else {
        return Ok(());
    };
    if !matches!(
        last.get("status").and_then(Value::as_str),
        Some("queued" | "retry_queued")
    ) {
        return Ok(());
    }
    let Some(task_id) = last.get("taskId").and_then(Value::as_str) else {
        return Ok(());
    };
    let Some(tasks) = read_document(&tasks_file, DocumentKind::Tasks)? else {
        return Ok(());
    };
    let Some(task) = tasks
        .value
        .get("tasks")
        .and_then(Value::as_array)
        .and_then(|tasks| {
            tasks
                .iter()
                .find(|task| task.get("id").and_then(Value::as_str) == Some(task_id))
        })
    else {
        return Ok(());
    };
    if task
        .pointer("/automation/workflowId")
        .and_then(Value::as_str)
        != Some(workflow_id)
    {
        return Err("automation_task_owner_mismatch");
    }
    if let Some(retry_at) = latest_retry_at(task) {
        let retry_time = DateTime::parse_from_rfc3339(retry_at).ok();
        let latest_time = last
            .get("startedAt")
            .and_then(Value::as_str)
            .and_then(|at| DateTime::parse_from_rfc3339(at).ok());
        if retry_time.is_some() && retry_time > latest_time {
            // Dispatch or completion may already have changed the task status
            // before the retry history write. Repair that history first.
            return record_run(
                &rules_file,
                workflow_id,
                task_id,
                "retry_queued",
                retry_at,
                "Automatically queued for retry.",
            );
        }
    }
    match task.get("status").and_then(Value::as_str) {
        Some("done") => {
            let at = terminal_at(task, "done").ok_or("automation_task_terminal_time_missing")?;
            let message = task
                .pointer("/result/summary")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .unwrap_or("Task completed.");
            record_run(&rules_file, workflow_id, task_id, "completed", &at, message)
        }
        Some("failed") => {
            let retry_count = task.get("retryCount").and_then(Value::as_u64).unwrap_or(0);
            let max_retries = rule.get("maxRetries").and_then(Value::as_u64).unwrap_or(0);
            let budget_reached = task
                .get("budget")
                .and_then(Value::as_f64)
                .filter(|budget| *budget > 0.0)
                .is_some_and(|budget| {
                    task.get("totalCost").and_then(Value::as_f64).unwrap_or(0.0) >= budget
                });
            if retry_count < max_retries && !budget_reached {
                let at = retry_task(&tasks_file, task_id)?;
                if let Some(at) = at {
                    record_run(
                        &rules_file,
                        workflow_id,
                        task_id,
                        "retry_queued",
                        &at,
                        "Automatically queued for retry.",
                    )?;
                }
                Ok(())
            } else {
                let at =
                    terminal_at(task, "failed").ok_or("automation_task_terminal_time_missing")?;
                let message = task
                    .pointer("/result/failReason")
                    .and_then(Value::as_str)
                    .or_else(|| task.get("failReason").and_then(Value::as_str))
                    .filter(|text| !text.is_empty())
                    .unwrap_or("Retry limit reached.");
                record_run(&rules_file, workflow_id, task_id, "failed", &at, message)
            }
        }
        _ => Ok(()),
    }
}

fn retry_task(file: &Path, task_id: &str) -> Result<Option<String>, &'static str> {
    for attempt in 0..3 {
        let Some(mut snapshot) = read_document(file, DocumentKind::Tasks)? else {
            return Ok(None);
        };
        let Some(task) = snapshot
            .value
            .get_mut("tasks")
            .and_then(Value::as_array_mut)
            .and_then(|tasks| {
                tasks
                    .iter_mut()
                    .find(|task| task.get("id").and_then(Value::as_str) == Some(task_id))
            })
        else {
            return Ok(None);
        };
        if task.get("status").and_then(Value::as_str) != Some("failed") {
            return Ok(None);
        }
        let at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        let count = task.get("retryCount").and_then(Value::as_u64).unwrap_or(0);
        task["status"] = json!("pending");
        task["retryCount"] = json!(count.saturating_add(1));
        task["failReason"] = Value::Null;
        task["result"] = json!({"status":null,"summary":null,"completedAt":null,"failReason":null});
        if !task.get("dispatch").is_some_and(Value::is_object) {
            task["dispatch"] = json!({});
        }
        for field in [
            "childWorkspaceId",
            "childInstanceId",
            "childSessionId",
            "startedAt",
            "finishedAt",
            "hostUsageSequence",
        ] {
            task["dispatch"][field] = Value::Null;
        }
        task["dispatch"]["hostManaged"] = json!(false);
        if !task.get("events").is_some_and(Value::is_array) {
            task["events"] = json!([]);
        }
        if let Some(events) = task.get_mut("events").and_then(Value::as_array_mut) {
            events.push(json!({"at":at,"type":"automation_retry","status":"pending","message":"Automatically queued for retry."}));
        }
        match write_document(
            file,
            DocumentKind::Tasks,
            &snapshot.revision,
            &snapshot.value,
        ) {
            Ok(_) => return Ok(Some(at)),
            Err("task_conflict" | "task_store_busy") if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(40 * (attempt + 1)))
            }
            Err(code) => return Err(code),
        }
    }
    Ok(None)
}

fn record_run(
    file: &Path,
    workflow_id: &str,
    task_id: &str,
    status: &str,
    at: &str,
    message: &str,
) -> Result<(), &'static str> {
    let run_id = format!("{workflow_id}:{task_id}:{status}:{at}");
    let message: String = message.chars().take(2_000).collect();
    for attempt in 0..3 {
        let Some(mut snapshot) = read_document(file, DocumentKind::Workflows)? else {
            return Ok(());
        };
        let Some(rule) = snapshot
            .value
            .get_mut("workflows")
            .and_then(Value::as_array_mut)
            .and_then(|rules| {
                rules
                    .iter_mut()
                    .find(|rule| rule.get("id").and_then(Value::as_str) == Some(workflow_id))
            })
        else {
            return Ok(());
        };
        let Some(history) = rule.get_mut("history").and_then(Value::as_array_mut) else {
            return Err("automation_workspace_invalid");
        };
        if history
            .iter()
            .any(|run| run.get("id").and_then(Value::as_str) == Some(&run_id))
        {
            return Ok(());
        }
        // Do not append an old outcome after a newer run took over the rule.
        if !history.first().is_some_and(|run| {
            run.get("taskId").and_then(Value::as_str) == Some(task_id)
                && matches!(
                    run.get("status").and_then(Value::as_str),
                    Some("queued" | "retry_queued")
                )
        }) {
            return Ok(());
        }
        history.insert(
            0,
            json!({"id":run_id,"status":status,"startedAt":at,"taskId":task_id,"message":message}),
        );
        history.truncate(100);
        rule["lastRunAt"] = json!(at);
        rule["approvalPending"] = json!(false);
        rule["updatedAt"] = json!(Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true));
        match write_document(
            file,
            DocumentKind::Workflows,
            &snapshot.revision,
            &snapshot.value,
        ) {
            Ok(_) => return Ok(()),
            Err("automation_workspace_conflict" | "automation_workspace_busy") if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(40 * (attempt + 1)))
            }
            Err(code) => return Err(code),
        }
    }
    Ok(())
}

fn terminal_at(task: &Value, status: &str) -> Option<String> {
    task.pointer("/result/completedAt")
        .and_then(Value::as_str)
        .filter(|at| DateTime::parse_from_rfc3339(at).is_ok())
        .or_else(|| {
            task.get("events")
                .and_then(Value::as_array)
                .and_then(|events| {
                    events
                        .iter()
                        .rev()
                        .find(|event| event.get("status").and_then(Value::as_str) == Some(status))
                        .and_then(|event| event.get("at").and_then(Value::as_str))
                        .filter(|at| DateTime::parse_from_rfc3339(at).is_ok())
                })
        })
        .map(str::to_owned)
}

fn latest_retry_at(task: &Value) -> Option<&str> {
    task.get("events")
        .and_then(Value::as_array)?
        .iter()
        .rev()
        .find(|event| event.get("type").and_then(Value::as_str) == Some("automation_retry"))?
        .get("at")
        .and_then(Value::as_str)
}

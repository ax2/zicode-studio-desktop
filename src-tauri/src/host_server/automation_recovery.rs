//! Complete dispatched tasks from native runtime events even when the owning
//! WebView has navigated away from their workspace.

use crate::automation_persistence::{read_document, write_document, DocumentKind};
use crate::native_pi_manager::NativePiManager;
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock, Weak};
use std::time::Duration;

use super::{lifecycle::HostLifecycle, HostState};

const MAX_SUMMARY_CHARS: usize = 10_000;

pub(super) async fn run(
    state: Weak<HostState>,
    runtimes: NativePiManager,
    workspace_roots: Arc<RwLock<HashMap<String, PathBuf>>>,
    lifecycle: HostLifecycle,
) {
    let mut events = runtimes.subscribe();
    let mut summaries = HashMap::<String, String>::new();
    let mut errors = HashMap::<String, bool>::new();
    let mut pending = HashSet::<String>::new();
    let generations = Arc::new(Mutex::new(HashMap::<String, u64>::new()));
    let (completed_tx, mut completed_rx) = tokio::sync::mpsc::unbounded_channel::<(String, u64)>();
    loop {
        let event = tokio::select! {
            event = events.recv() => event,
            Some((instance_id, generation)) = completed_rx.recv() => {
                if let Ok(mut current) = generations.lock() {
                    if current.get(&instance_id) == Some(&generation) {
                        current.remove(&instance_id);
                        pending.remove(&instance_id);
                    }
                }
                continue;
            }
        };
        let frame = match event {
            Ok(frame) => frame,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                log::warn!("[automation] skipped {count} runtime event(s) during recovery");
                continue;
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
        };
        let instance_id = frame.target.instance_id.clone();
        let event_type = frame.event.get("type").and_then(Value::as_str);
        match event_type {
            Some("agent_start") => {
                summaries.remove(&instance_id);
                errors.remove(&instance_id);
                pending.remove(&instance_id);
                if let Ok(mut current) = generations.lock() {
                    let next = current
                        .get(&instance_id)
                        .copied()
                        .unwrap_or(0)
                        .wrapping_add(1);
                    current.insert(instance_id, next);
                }
            }
            Some("message_end")
                if frame.event.pointer("/message/role").and_then(Value::as_str)
                    == Some("assistant") =>
            {
                let cost = frame
                    .event
                    .pointer("/message/usage/cost/total")
                    .and_then(|value| value.as_f64().or_else(|| value.as_str()?.parse().ok()))
                    .filter(|cost| cost.is_finite() && *cost > 0.0);
                let content = frame
                    .event
                    .pointer("/message/content")
                    .and_then(Value::as_array)
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|block| {
                                block.get("type").and_then(Value::as_str) == Some("text")
                            })
                            .filter_map(|block| block.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default();
                let content = content.trim();
                if !content.is_empty() {
                    summaries.insert(
                        instance_id.clone(),
                        content.chars().take(MAX_SUMMARY_CHARS).collect(),
                    );
                }
                if frame
                    .event
                    .pointer("/message/errorMessage")
                    .and_then(Value::as_str)
                    .is_some_and(|message| !message.is_empty())
                {
                    errors.insert(instance_id.clone(), true);
                }
                if let Some(cost) = cost {
                    let roots = workspace_roots.clone();
                    let target = frame.target.clone();
                    let sequence = frame.sequence;
                    let outcome = lifecycle
                        .blocking(move || {
                            update_owner(
                                &roots,
                                &target.instance_id,
                                Update::Usage { cost, sequence },
                            )
                        })
                        .await;
                    match outcome {
                        Ok(Ok(result)) if result.budget_exceeded => {
                            if let Some((status, title)) = result.notification {
                                crate::send_desktop_notification(
                                    notification_title(status).to_owned(),
                                    title,
                                );
                            }
                            let runtimes = runtimes.clone();
                            lifecycle.background(async move {
                                let _ = runtimes
                                    .request(
                                        &frame.target,
                                        json!({ "type": "abort" }),
                                        None,
                                        Duration::from_secs(10),
                                    )
                                    .await;
                            });
                        }
                        Ok(Err(code)) => {
                            log::warn!("[automation] task usage write failed: {code}")
                        }
                        Err(error) => {
                            log::warn!("[automation] task usage update stopped: {error}")
                        }
                        _ => {}
                    }
                }
            }
            Some("session_bound") => {
                let Some(session_id) = frame.event.get("sessionId").and_then(Value::as_str) else {
                    continue;
                };
                if session_id.is_empty() {
                    continue;
                }
                let roots = workspace_roots.clone();
                let session_id = session_id.to_owned();
                let outcome = lifecycle
                    .blocking(move || update_owner(&roots, &instance_id, Update::Bind(session_id)))
                    .await;
                match outcome {
                    Ok(Err(code)) => {
                        log::warn!("[automation] session binding recovery failed: {code}")
                    }
                    Err(error) => {
                        log::warn!("[automation] session binding recovery stopped: {error}")
                    }
                    _ => {}
                }
            }
            Some("agent_end")
                if frame.event.get("willRetry").and_then(Value::as_bool) == Some(true) => {}
            Some("agent_end" | "agent_settled") => {
                if !pending.insert(instance_id.clone()) {
                    continue;
                }
                let roots = workspace_roots.clone();
                let summary = summaries.remove(&instance_id);
                let had_error = errors.remove(&instance_id).unwrap_or(false);
                let formal_session = (!frame.target.session_id.starts_with("temporary-"))
                    .then_some(frame.target.session_id);
                let ended_at = Utc::now();
                let has_window_owner = state.upgrade().is_some_and(|host| {
                    host.session_owners.lock().is_ok_and(|owners| {
                        owners
                            .keys()
                            .any(|target| target.instance_id == instance_id)
                    })
                });
                let generation = generations
                    .lock()
                    .ok()
                    .and_then(|current| current.get(&instance_id).copied())
                    .unwrap_or(0);
                let current_generations = generations.clone();
                let completed_tx = completed_tx.clone();
                let background_lifecycle = lifecycle.clone();
                lifecycle.background(async move {
                    // The owning WebView writes first when it is still connected,
                    // preserving its in-app notification. Host completes the task
                    // if that write never arrives or the window has gone away.
                    if has_window_owner {
                        tokio::time::sleep(Duration::from_secs(2)).await;
                    }
                    let still_same_run = current_generations.lock().is_ok_and(|current| {
                        current.get(&instance_id).copied().unwrap_or(0) == generation
                    });
                    if still_same_run {
                        let id = instance_id.clone();
                        let outcome = background_lifecycle
                            .blocking(move || {
                                update_owner(
                                    &roots,
                                    &id,
                                    Update::Finish {
                                        summary,
                                        had_error,
                                        formal_session,
                                        ended_at,
                                    },
                                )
                            })
                            .await;
                        match outcome {
                            Ok(Ok(result)) if result.changed => {
                                if let Some((status, title)) = result.notification {
                                    crate::send_desktop_notification(
                                        notification_title(status).to_owned(),
                                        title,
                                    );
                                }
                            }
                            Ok(Err(code)) => {
                                log::warn!("[automation] task completion recovery failed: {code}")
                            }
                            Err(error) => {
                                log::warn!("[automation] task completion recovery stopped: {error}")
                            }
                            _ => {}
                        }
                    }
                    let _ = completed_tx.send((instance_id, generation));
                });
            }
            _ => {}
        }
    }
}

enum Update {
    Bind(String),
    Usage {
        cost: f64,
        sequence: u64,
    },
    Finish {
        summary: Option<String>,
        had_error: bool,
        formal_session: Option<String>,
        ended_at: DateTime<Utc>,
    },
}

#[derive(Default)]
struct UpdateOutcome {
    changed: bool,
    budget_exceeded: bool,
    notification: Option<(&'static str, String)>,
}

fn notification_title(status: &str) -> &'static str {
    match status {
        "needs_input" => "Task needs input",
        "failed" => "Task failed",
        _ => "Task completed",
    }
}

fn update_owner(
    roots: &Arc<RwLock<HashMap<String, PathBuf>>>,
    instance_id: &str,
    update: Update,
) -> Result<UpdateOutcome, &'static str> {
    let mut paths: Vec<PathBuf> = roots
        .read()
        .map_err(|_| "workspace_registry_unavailable")?
        .values()
        .map(|root| root.join(".zicode").join("tasks").join("tasks.json"))
        .collect();
    paths.sort();
    paths.dedup();
    for attempt in 0..3 {
        let mut owners = Vec::new();
        for path in &paths {
            let snapshot = match read_document(path, DocumentKind::Tasks) {
                Ok(Some(snapshot)) => snapshot,
                Ok(None) => continue,
                Err(code) => {
                    log::warn!(
                        "[automation] cannot scan task file {}: {code}",
                        path.display()
                    );
                    continue;
                }
            };
            let Some(tasks) = snapshot.value.get("tasks").and_then(Value::as_array) else {
                continue;
            };
            let matches = tasks
                .iter()
                .filter(|task| {
                    task.pointer("/dispatch/childInstanceId")
                        .and_then(Value::as_str)
                        == Some(instance_id)
                        && matches!(
                            task.get("status").and_then(Value::as_str),
                            Some("running" | "pending" | "needs_input")
                        )
                })
                .count();
            if matches > 1 {
                return Err("automation_task_owner_ambiguous");
            }
            if matches == 1 {
                owners.push((path.clone(), snapshot));
            }
        }
        if owners.len() > 1 {
            return Err("automation_task_owner_ambiguous");
        }
        let Some((path, mut snapshot)) = owners.pop() else {
            return Ok(UpdateOutcome::default());
        };
        let Some(tasks) = snapshot
            .value
            .get_mut("tasks")
            .and_then(Value::as_array_mut)
        else {
            return Err("task_store_invalid");
        };
        let Some(task) = tasks.iter_mut().find(|task| {
            task.pointer("/dispatch/childInstanceId")
                .and_then(Value::as_str)
                == Some(instance_id)
        }) else {
            return Ok(UpdateOutcome::default());
        };
        let outcome = match &update {
            Update::Bind(session_id) => UpdateOutcome {
                changed: bind_session(task, session_id),
                ..Default::default()
            },
            Update::Usage { cost, sequence } => apply_usage(task, *cost, *sequence),
            Update::Finish {
                summary,
                had_error,
                formal_session,
                ended_at,
            } => UpdateOutcome {
                changed: finish_task(
                    task,
                    summary.as_deref(),
                    *had_error,
                    formal_session.as_deref(),
                    ended_at,
                ),
                ..Default::default()
            },
        };
        if !outcome.changed {
            return Ok(outcome);
        }
        let mut outcome = outcome;
        if matches!(&update, Update::Finish { .. }) || outcome.budget_exceeded {
            let status = task.get("status").and_then(Value::as_str).unwrap_or("done");
            let status = match status {
                "failed" => "failed",
                "needs_input" => "needs_input",
                _ => "done",
            };
            let title = task
                .get("title")
                .and_then(Value::as_str)
                .filter(|title| !title.is_empty())
                .unwrap_or("Automation task");
            outcome.notification = Some((status, title.to_owned()));
        }
        match write_document(
            &path,
            DocumentKind::Tasks,
            &snapshot.revision,
            &snapshot.value,
        ) {
            Ok(_) => return Ok(outcome),
            Err("task_conflict" | "task_store_busy") if attempt < 2 => {
                std::thread::sleep(std::time::Duration::from_millis(40 * (attempt + 1)));
                continue;
            }
            Err(error) => return Err(error),
        }
    }
    Ok(UpdateOutcome::default())
}

fn apply_usage(task: &mut Value, cost: f64, sequence: u64) -> UpdateOutcome {
    if task.get("status").and_then(Value::as_str) != Some("running")
        || task
            .pointer("/dispatch/hostManaged")
            .and_then(Value::as_bool)
            != Some(true)
        || task
            .pointer("/dispatch/hostUsageSequence")
            .and_then(Value::as_u64)
            .is_some_and(|last| last >= sequence)
    {
        return UpdateOutcome::default();
    }
    let total = task
        .get("totalCost")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .max(0.0)
        + cost;
    if !total.is_finite() {
        return UpdateOutcome::default();
    }
    task["totalCost"] = json!(total);
    task["dispatch"]["hostUsageSequence"] = json!(sequence);
    let budget = task
        .get("budget")
        .and_then(Value::as_f64)
        .filter(|value| *value > 0.0);
    if !budget.is_some_and(|budget| total >= budget) {
        return UpdateOutcome {
            changed: true,
            budget_exceeded: false,
            ..Default::default()
        };
    }
    let reason = "Task budget reached; the child run was stopped.";
    let now = now_iso();
    task["status"] = json!("failed");
    task["failReason"] = json!(reason);
    task["result"] =
        json!({ "status": "failed", "summary": null, "completedAt": now, "failReason": reason });
    task["dispatch"]["finishedAt"] = json!(now);
    push_event(task, "failed", "failed", reason);
    UpdateOutcome {
        changed: true,
        budget_exceeded: true,
        ..Default::default()
    }
}

fn bind_session(task: &mut Value, session_id: &str) -> bool {
    let Some(dispatch) = task.get_mut("dispatch").and_then(Value::as_object_mut) else {
        return false;
    };
    if dispatch.get("childSessionId").and_then(Value::as_str) == Some(session_id) {
        return false;
    }
    dispatch.insert("childSessionId".into(), json!(session_id));
    let status = task
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("running")
        .to_owned();
    push_event(task, "session_bound", &status, "Child session bound.");
    true
}

fn finish_task(
    task: &mut Value,
    summary: Option<&str>,
    had_error: bool,
    formal_session: Option<&str>,
    ended_at: &DateTime<Utc>,
) -> bool {
    if !matches!(
        task.get("status").and_then(Value::as_str),
        Some("running" | "pending")
    ) {
        return false;
    }
    if task
        .get("events")
        .and_then(Value::as_array)
        .is_some_and(|events| {
            events.iter().any(|event| {
                event.get("type").and_then(Value::as_str) == Some("answered")
                    && event
                        .get("at")
                        .and_then(Value::as_str)
                        .and_then(|at| DateTime::parse_from_rfc3339(at).ok())
                        .is_some_and(|at| at.with_timezone(&Utc) >= *ended_at)
            })
        })
    {
        return false;
    }
    let had_output = summary.is_some();
    let summary = summary.unwrap_or("Project agent ended. Review the child session for details.");
    let trimmed = summary.trim_end();
    let question =
        summary.chars().count() <= 240 && (trimmed.ends_with('?') || trimmed.ends_with('？'));
    let failed = had_error && !had_output;
    let status = if question {
        "needs_input"
    } else if failed {
        "failed"
    } else {
        "done"
    };
    let now = now_iso();
    if let Some(session_id) = formal_session {
        if let Some(dispatch) = task.get_mut("dispatch").and_then(Value::as_object_mut) {
            dispatch.insert("childSessionId".into(), json!(session_id));
        }
    }
    task["status"] = json!(status);
    if question {
        task["failReason"] = json!(summary);
        task["result"] = json!({ "status": status, "summary": null, "completedAt": null, "failReason": summary });
        push_event(task, "needs_input", status, summary);
    } else {
        let reason = failed.then_some(
            "The project agent ended after an error. Review the child session and retry.",
        );
        task["failReason"] = json!(reason);
        task["result"] = json!({ "status": status, "summary": if failed { None } else { Some(summary) }, "completedAt": now, "failReason": reason });
        if let Some(dispatch) = task.get_mut("dispatch").and_then(Value::as_object_mut) {
            dispatch.insert("finishedAt".into(), json!(now));
        }
        push_event(
            task,
            if failed { "failed" } else { "completed" },
            status,
            if failed {
                reason.unwrap_or_default()
            } else {
                summary
            },
        );
    }
    true
}

fn push_event(task: &mut Value, event_type: &str, status: &str, message: &str) {
    if !task.get("events").is_some_and(Value::is_array) {
        task["events"] = json!([]);
    }
    if let Some(events) = task.get_mut("events").and_then(Value::as_array_mut) {
        events.push(
            json!({ "at": now_iso(), "type": event_type, "status": status, "message": message }),
        );
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

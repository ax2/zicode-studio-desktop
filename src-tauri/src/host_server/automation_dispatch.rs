//! Dispatch already-queued, pre-approved automation tasks without relying on
//! an open Agent Inbox view. Rule scheduling is a separate Host step.

use super::{configure_plugin_broker_for_state, lifecycle::HostLifecycle, HostState};
use crate::automation_persistence::{read_document, write_document, DocumentKind};
use crate::runtime_coordinator::RuntimeTarget;
use chrono::{SecondsFormat, Utc};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock, Weak};
use std::time::Duration;

const MAX_PER_SCAN: usize = 8;
const MAX_PER_WORKSPACE: usize = 2;

struct Candidate {
    file: PathBuf,
    task_id: String,
    project: String,
}

pub(super) async fn run(
    state: Weak<HostState>,
    workspace_roots: Arc<RwLock<HashMap<String, PathBuf>>>,
    lifecycle: HostLifecycle,
) {
    let mut ticker = tokio::time::interval(Duration::from_secs(3));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut cursor = 0usize;
    loop {
        ticker.tick().await;
        let roots = workspace_roots.clone();
        let candidates = match lifecycle
            .blocking(move || collect_candidates(&roots, cursor))
            .await
        {
            Ok(candidates) => candidates,
            Err(error) => {
                log::warn!("[automation] task scan stopped: {error}");
                continue;
            }
        };
        cursor = cursor.wrapping_add(1);
        for candidate in candidates {
            let Some(host) = state.upgrade() else {
                return;
            };
            if host.lifecycle.stopping() {
                return;
            }
            dispatch_one(&host, &workspace_roots, candidate).await;
        }
    }
}

fn collect_candidates(
    roots: &Arc<RwLock<HashMap<String, PathBuf>>>,
    cursor: usize,
) -> Vec<Candidate> {
    let Ok(roots) = roots.read() else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = roots
        .values()
        .map(|root| root.join(".zicode").join("tasks").join("tasks.json"))
        .collect();
    files.sort();
    files.dedup();
    if !files.is_empty() {
        let offset = cursor % files.len();
        files.rotate_left(offset);
    }
    let mut candidates = Vec::new();
    for file in files {
        let snapshot = match read_document(&file, DocumentKind::Tasks) {
            Ok(Some(snapshot)) => snapshot,
            Ok(None) => continue,
            Err(code) => {
                log::warn!(
                    "[automation] cannot scan queued tasks {}: {code}",
                    file.display()
                );
                continue;
            }
        };
        let Some(tasks) = snapshot.value.get("tasks").and_then(Value::as_array) else {
            continue;
        };
        let mut eligible: Vec<&Value> = tasks
            .iter()
            .filter(|task| {
                task.get("status").and_then(Value::as_str) == Some("pending")
                    && !matches!(
                        task.get("schedule").and_then(Value::as_str),
                        Some("interval" | "daily")
                    )
                    && task
                        .pointer("/automation/autoDispatch")
                        .and_then(Value::as_bool)
                        == Some(true)
                    && task
                        .pointer("/dispatch/childInstanceId")
                        .and_then(Value::as_str)
                        .is_none_or(|id| id.is_empty())
            })
            .collect();
        if !eligible.is_empty() {
            let offset = cursor % eligible.len();
            eligible.rotate_left(offset);
        }
        for task in eligible.into_iter().take(MAX_PER_WORKSPACE) {
            let Some(task_id) = task.get("id").and_then(Value::as_str) else {
                continue;
            };
            let project = task
                .get("targetProject")
                .and_then(Value::as_str)
                .or_else(|| {
                    task.pointer("/dispatch/targetProject")
                        .and_then(Value::as_str)
                })
                .unwrap_or_default();
            candidates.push(Candidate {
                file: file.clone(),
                task_id: task_id.to_owned(),
                project: project.to_owned(),
            });
            if candidates.len() >= MAX_PER_SCAN {
                return candidates;
            }
        }
    }
    candidates
}

async fn dispatch_one(
    host: &HostState,
    roots: &Arc<RwLock<HashMap<String, PathBuf>>>,
    candidate: Candidate,
) {
    let Some((workspace_id, project)) = resolve_registered_project(roots, &candidate.project)
    else {
        let file = candidate.file;
        let task_id = candidate.task_id;
        let project = candidate.project;
        let _ = host
            .lifecycle
            .blocking(move || block_pending_task(&file, &task_id, &project))
            .await;
        return;
    };
    let target = RuntimeTarget::new(
        workspace_id,
        format!("temporary-{}", uuid::Uuid::new_v4().simple()),
        format!("instance-{}", uuid::Uuid::new_v4().simple()),
    )
    .with_scene("programming");
    let project_text = project.to_string_lossy().into_owned();
    let mut launch = match host
        .pi_launch
        .native_launch_spec(&project_text, None, &target)
    {
        Ok(launch) => launch,
        Err(error) => {
            log::warn!("[automation] cannot prepare child runtime: {error}");
            let file = candidate.file;
            let task_id = candidate.task_id;
            let project = candidate.project;
            let _ = host
                .lifecycle
                .blocking(move || block_pending_task(&file, &task_id, &project))
                .await;
            return;
        }
    };
    if let Err(error) = configure_plugin_broker_for_state(host, &target, &mut launch) {
        log::warn!("[automation] cannot prepare child plugin broker: {error}");
        return;
    }
    let file = candidate.file.clone();
    let task_id = candidate.task_id.clone();
    let expected_project = candidate.project.clone();
    let claimed_target = target.clone();
    let claimed = host
        .lifecycle
        .blocking(move || claim_task(&file, &task_id, &expected_project, &claimed_target))
        .await;
    let task = match claimed {
        Ok(Ok(Some(task))) => task,
        Ok(Ok(None)) => return,
        Ok(Err(code)) => {
            log::warn!("[automation] cannot claim queued task: {code}");
            return;
        }
        Err(error) => {
            log::warn!("[automation] task claim stopped: {error}");
            return;
        }
    };
    if let Err(error) = host.runtimes.spawn(target.clone(), launch) {
        log::warn!("[automation] cannot start child runtime: {error}");
        let file = candidate.file;
        let task_id = candidate.task_id;
        let instance_id = target.instance_id;
        let _ = host
            .lifecycle
            .blocking(move || fail_claimed_task(&file, &task_id, &instance_id))
            .await;
        return;
    }
    let prompt = build_prompt(&task);
    let idempotency = format!("automation-{}-{}", candidate.task_id, target.instance_id);
    if let Err(error) = host
        .runtimes
        .request(
            &target,
            json!({ "type": "prompt", "message": prompt }),
            Some(&idempotency),
            Duration::from_secs(30),
        )
        .await
    {
        // The RPC response may have been lost after Pi accepted the prompt.
        // Keep the child claim visible for inspection instead of requeueing it.
        log::warn!("[automation] child prompt acceptance is unknown: {error}");
        return;
    }
    // Ask Pi for its persisted session id; the binding event updates the task.
    for _ in 0..5 {
        if let Ok(response) = host
            .runtimes
            .request(
                &target,
                json!({ "type": "get_state" }),
                None,
                Duration::from_secs(10),
            )
            .await
        {
            if let Some(session_id) = response
                .pointer("/data/sessionId")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty() && !id.starts_with("temporary-"))
            {
                let _ = host.runtimes.bind_session_id(&target, session_id);
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}

fn resolve_registered_project(
    roots: &Arc<RwLock<HashMap<String, PathBuf>>>,
    requested: &str,
) -> Option<(String, PathBuf)> {
    if requested.trim().is_empty() {
        return None;
    }
    let project = PathBuf::from(requested).canonicalize().ok()?;
    if !project.is_dir() {
        return None;
    }
    let known = roots.read().ok()?;
    known
        .iter()
        .find_map(|(id, root)| same_path(root, &project).then(|| (id.clone(), project.clone())))
}

fn same_path(left: &Path, right: &Path) -> bool {
    let Ok(left) = left.canonicalize() else {
        return false;
    };
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn claim_task(
    file: &Path,
    task_id: &str,
    project: &str,
    target: &RuntimeTarget,
) -> Result<Option<Value>, &'static str> {
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
        if task.get("status").and_then(Value::as_str) != Some("pending")
            || task
                .pointer("/automation/autoDispatch")
                .and_then(Value::as_bool)
                != Some(true)
            || task
                .get("targetProject")
                .and_then(Value::as_str)
                .or_else(|| {
                    task.pointer("/dispatch/targetProject")
                        .and_then(Value::as_str)
                })
                != Some(project)
            || task
                .pointer("/dispatch/childInstanceId")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty())
        {
            return Ok(None);
        }
        let now = now_iso();
        task["status"] = json!("running");
        task["failReason"] = Value::Null;
        task["result"] =
            json!({ "status": null, "summary": null, "completedAt": null, "failReason": null });
        if !task.get("dispatch").is_some_and(Value::is_object) {
            task["dispatch"] = json!({});
        }
        task["dispatch"]["targetProject"] = json!(project);
        task["dispatch"]["childWorkspaceId"] = json!(target.workspace_id);
        task["dispatch"]["childInstanceId"] = json!(target.instance_id);
        task["dispatch"]["childSessionId"] = json!(target.session_id);
        task["dispatch"]["hostManaged"] = json!(true);
        task["dispatch"]["hostUsageSequence"] = Value::Null;
        task["dispatch"]["startedAt"] = json!(now);
        task["dispatch"]["finishedAt"] = Value::Null;
        push_event(
            task,
            "dispatched",
            "running",
            "Dispatched to project agent.",
        );
        let claimed = task.clone();
        match write_document(
            file,
            DocumentKind::Tasks,
            &snapshot.revision,
            &snapshot.value,
        ) {
            Ok(_) => return Ok(Some(claimed)),
            Err("task_conflict" | "task_store_busy") if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(40 * (attempt + 1)));
            }
            Err(code) => return Err(code),
        }
    }
    Ok(None)
}

fn block_pending_task(file: &Path, task_id: &str, project: &str) -> Result<(), &'static str> {
    let title = mutate_task(file, task_id, |task| {
        if task.get("status").and_then(Value::as_str) != Some("pending")
            || task
                .pointer("/automation/autoDispatch")
                .and_then(Value::as_bool)
                != Some(true)
            || task
                .get("targetProject")
                .and_then(Value::as_str)
                .or_else(|| {
                    task.pointer("/dispatch/targetProject")
                        .and_then(Value::as_str)
                })
                != Some(project)
        {
            return false;
        }
        let reason = "Target project is unavailable or not registered. Open the project, then resume this task.";
        task["status"] = json!("blocked");
        task["failReason"] = json!(reason);
        task["result"] = json!({ "status": "blocked", "summary": null, "completedAt": null, "failReason": reason });
        push_event(task, "blocked", "blocked", reason);
        true
    })?;
    if let Some(title) = title {
        crate::send_desktop_notification("Task needs review".to_owned(), title);
    }
    Ok(())
}

fn fail_claimed_task(file: &Path, task_id: &str, instance_id: &str) -> Result<(), &'static str> {
    let title = mutate_task(file, task_id, |task| {
        if task.get("status").and_then(Value::as_str) != Some("running")
            || task
                .pointer("/dispatch/childInstanceId")
                .and_then(Value::as_str)
                != Some(instance_id)
        {
            return false;
        }
        let reason = "The project agent could not start. Review the target project and retry.";
        let now = now_iso();
        task["status"] = json!("failed");
        task["failReason"] = json!(reason);
        task["result"] = json!({ "status": "failed", "summary": null, "completedAt": now, "failReason": reason });
        task["dispatch"]["finishedAt"] = json!(now);
        push_event(task, "failed", "failed", reason);
        true
    })?;
    if let Some(title) = title {
        crate::send_desktop_notification("Task failed".to_owned(), title);
    }
    Ok(())
}

fn mutate_task(
    file: &Path,
    task_id: &str,
    mut update: impl FnMut(&mut Value) -> bool,
) -> Result<Option<String>, &'static str> {
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
        if !update(task) {
            return Ok(None);
        }
        let title = task
            .get("title")
            .and_then(Value::as_str)
            .filter(|title| !title.is_empty())
            .unwrap_or("Automation task")
            .to_owned();
        match write_document(
            file,
            DocumentKind::Tasks,
            &snapshot.revision,
            &snapshot.value,
        ) {
            Ok(_) => return Ok(Some(title)),
            Err("task_conflict" | "task_store_busy") if attempt < 2 => {
                std::thread::sleep(Duration::from_millis(40 * (attempt + 1)))
            }
            Err(code) => return Err(code),
        }
    }
    Ok(None)
}

fn build_prompt(task: &Value) -> String {
    let id = task.get("id").and_then(Value::as_str).unwrap_or_default();
    let title = task
        .get("title")
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .unwrap_or("(untitled)");
    let mut lines = vec![format!("Task ID: {id}"), format!("Title: {title}")];
    if let Some(source) = task.get("source") {
        if let Some(channel) = source
            .get("channel")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            let mut parts = vec![channel.to_owned()];
            for (field, label) in [
                ("conversationId", "conversation"),
                ("userId", "user"),
                ("messageId", "message"),
            ] {
                if let Some(value) = source
                    .get(field)
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    parts.push(format!("{label} {value}"));
                }
            }
            lines.push(format!("Source: {}", parts.join(" · ")));
        }
    }
    if let Some(description) = task
        .get("description")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    {
        lines.push(String::new());
        lines.push(description.to_owned());
    }
    lines.extend([
        String::new(),
        "If you need clarification, stop and report the question clearly so the Super Agent can ask the original user before continuing.".into(),
        "When finished, summarize the outcome, files changed, verification run, and any remaining risk.".into(),
    ]);
    lines.join("\n")
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

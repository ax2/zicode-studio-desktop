//! Queue due rules from every registered workspace while the desktop Host runs.
//! Task creation precedes rule history, so a repeated scan can repair a partial write.

use crate::automation_persistence::{
    create_or_write_document, read_document, write_document, DocumentKind,
};
use chrono::{
    DateTime, Duration as ChronoDuration, Local, LocalResult, NaiveDate, NaiveDateTime, NaiveTime,
    Offset, TimeZone, Utc,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use super::lifecycle::HostLifecycle;

const MAX_PER_SCAN: usize = 24;
const MAX_PER_WORKSPACE: usize = 4;

pub(super) async fn run(roots: Arc<RwLock<HashMap<String, PathBuf>>>, lifecycle: HostLifecycle) {
    let mut ticker = tokio::time::interval(Duration::from_secs(15));
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
            log::warn!("[automation] rule scheduler stopped: {error}");
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
    let legacy = match legacy_task_paths() {
        Ok(paths) => paths,
        Err(code) => {
            log::warn!("[automation] cannot inspect legacy task locations: {code}");
            return;
        }
    };
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
                log::warn!("[automation] cannot read rules {}: {code}", root.display());
                continue;
            }
        };
        let mut ids: Vec<String> = snapshot
            .value
            .get("workflows")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|rule| due(rule, Utc::now()))
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
            if let Err(code) = enqueue_one(&root, &id, &legacy) {
                if !matches!(
                    code,
                    "task_conflict"
                        | "task_store_busy"
                        | "automation_workspace_conflict"
                        | "automation_workspace_busy"
                ) {
                    log::warn!(
                        "[automation] cannot queue rule in {}: {code}",
                        root.display()
                    );
                }
            }
        }
    }
}

fn due(rule: &Value, now: DateTime<Utc>) -> bool {
    if rule.get("enabled").and_then(Value::as_bool) == Some(false)
        || !matches!(
            rule.get("schedule").and_then(Value::as_str),
            Some("interval" | "daily")
        )
        || rule.get("approvalPending").and_then(Value::as_bool) == Some(true)
    {
        return false;
    }
    match rule.get("nextRunAt") {
        None | Some(Value::Null) => true,
        Some(Value::String(date)) if date.is_empty() => true,
        Some(Value::String(date)) => {
            DateTime::parse_from_rfc3339(date).is_ok_and(|date| date.with_timezone(&Utc) <= now)
        }
        _ => false,
    }
}

fn enqueue_one(root: &Path, id: &str, legacy: &[PathBuf]) -> Result<(), &'static str> {
    let rules_file = root
        .join(".zicode")
        .join("automation")
        .join("workflows.json");
    let tasks_file = root.join(".zicode").join("tasks").join("tasks.json");
    let rules_snapshot = read_document(&rules_file, DocumentKind::Workflows)?
        .ok_or("automation_workspace_unreadable")?;
    let Some(rule) = rules_snapshot
        .value
        .get("workflows")
        .and_then(Value::as_array)
        .and_then(|rules| {
            rules
                .iter()
                .find(|rule| rule.get("id").and_then(Value::as_str) == Some(id))
        })
    else {
        return Ok(());
    };
    if !due(rule, Utc::now()) {
        return Ok(());
    }
    let task_id = format!(
        "automation-task-{id}-{}",
        rule.get("nextRunAt")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("first")
    );
    let snapshot = read_document(&tasks_file, DocumentKind::Tasks)?;
    let revision = snapshot
        .as_ref()
        .map(|s| s.revision.clone())
        .unwrap_or_else(|| format!("{:x}", Sha256::digest(b"missing")));
    let mut document = snapshot
        .map(|s| s.value)
        .unwrap_or_else(|| json!({"tasks": []}));
    let tasks = document
        .get_mut("tasks")
        .and_then(Value::as_array_mut)
        .ok_or("task_store_invalid")?;
    let started_at = if let Some(existing) = tasks
        .iter()
        .find(|task| task.get("id").and_then(Value::as_str) == Some(&task_id))
    {
        if existing
            .pointer("/automation/workflowId")
            .and_then(Value::as_str)
            != Some(id)
        {
            return Err("automation_task_id_collision");
        }
        existing
            .pointer("/events/0/at")
            .and_then(Value::as_str)
            .filter(|value| DateTime::parse_from_rfc3339(value).is_ok())
            .map(str::to_owned)
            .unwrap_or_else(|| Utc::now().to_rfc3339())
    } else {
        let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        // Reject an invalid schedule before publishing an executable task.
        next_run(rule, &now)?;
        let approval = rule.get("requireApproval").and_then(Value::as_bool) != Some(false);
        let target = rule
            .get("targetProject")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| root.to_string_lossy().into_owned());
        tasks.push(json!({
            "id": task_id, "title": rule.get("title").cloned().unwrap_or(Value::Null),
            "description": rule.get("prompt").cloned().unwrap_or(Value::Null),
            "targetProject": target, "status": "pending",
            "source": {"channel":"automation", "conversationId":id, "userId":null, "messageId":null},
            "automation": {"workflowId":id, "trigger":"schedule", "autoDispatch":!approval},
            "budget": rule.get("maxCost").cloned().unwrap_or(Value::Null),
            "maxRetries": rule.get("maxRetries").cloned().unwrap_or(json!(2)), "retryCount":0,
            "events": [{"at":now, "type":"queued", "status":"pending", "message":"Queued by automation (schedule)."}]
        }));
        if read_document(&tasks_file, DocumentKind::Tasks)?.is_some() {
            write_document(&tasks_file, DocumentKind::Tasks, &revision, &document)?;
        } else {
            create_or_write_document(
                &tasks_file,
                DocumentKind::Tasks,
                &revision,
                &document,
                legacy,
            )?;
        }
        if approval {
            let title = rule
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("Automation task");
            crate::send_desktop_notification(
                "Automation needs approval".to_owned(),
                title.to_owned(),
            );
        }
        now
    };
    let next = next_run(rule, &started_at)?;
    let run_id = format!("{id}:{task_id}:queued:{started_at}");
    for _ in 0..3 {
        let snapshot = read_document(&rules_file, DocumentKind::Workflows)?
            .ok_or("automation_workspace_unreadable")?;
        let mut document = snapshot.value;
        let workflows = document
            .get_mut("workflows")
            .and_then(Value::as_array_mut)
            .ok_or("automation_workspace_invalid")?;
        let Some(current) = workflows
            .iter_mut()
            .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
        else {
            return Ok(());
        };
        if current
            .get("history")
            .and_then(Value::as_array)
            .is_some_and(|history| {
                history
                    .iter()
                    .any(|run| run.get("id").and_then(Value::as_str) == Some(&run_id))
            })
        {
            return Ok(());
        }
        // If the user edited or disabled the rule after the task was queued,
        // retain their new scheduling intent and only repair the run history.
        let unchanged_schedule =
            current.get("nextRunAt") == rule.get("nextRunAt") && due(current, Utc::now());
        let Some(map) = current.as_object_mut() else {
            return Err("automation_workspace_invalid");
        };
        let history = map
            .entry("history")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or("automation_workspace_invalid")?;
        history.insert(0, json!({"id":run_id, "status":"queued", "startedAt":started_at, "taskId":task_id, "message":"Queued in Task center"}));
        history.truncate(100);
        if unchanged_schedule {
            map.insert("lastRunAt".into(), json!(started_at));
            map.insert(
                "nextRunAt".into(),
                next.clone().map_or(Value::Null, Value::String),
            );
            map.insert("approvalPending".into(), json!(false));
        }
        map.insert(
            "updatedAt".into(),
            json!(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        );
        match write_document(
            &rules_file,
            DocumentKind::Workflows,
            &snapshot.revision,
            &document,
        ) {
            Ok(_) => return Ok(()),
            Err("automation_workspace_conflict" | "automation_workspace_busy") => continue,
            Err(code) => return Err(code),
        }
    }
    Err("automation_workspace_conflict")
}

pub(super) fn next_run(rule: &Value, started: &str) -> Result<Option<String>, &'static str> {
    let from = DateTime::parse_from_rfc3339(started)
        .map_err(|_| "automation_schedule_invalid")?
        .with_timezone(&Utc);
    let next = match rule.get("schedule").and_then(Value::as_str) {
        Some("interval") => {
            let minutes = rule
                .get("intervalMinutes")
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n != 0.0)
                .unwrap_or(60.0)
                .max(5.0);
            let millis = minutes * 60_000.0;
            if !millis.is_finite() || millis >= i64::MAX as f64 {
                return Err("automation_schedule_invalid");
            }
            let duration = ChronoDuration::try_milliseconds(millis as i64)
                .ok_or("automation_schedule_invalid")?;
            from.checked_add_signed(duration)
                .ok_or("automation_schedule_invalid")?
        }
        Some("daily") => {
            let time = rule
                .get("dailyTime")
                .and_then(Value::as_str)
                .unwrap_or("09:00");
            let time = NaiveTime::parse_from_str(time, "%H:%M")
                .map_err(|_| "automation_schedule_invalid")?;
            let local = from.with_timezone(&Local);
            let today = local.date_naive();
            let first = local_on_date(today, time)?;
            if first <= from {
                local_on_date(today.succ_opt().ok_or("automation_schedule_invalid")?, time)?
            } else {
                first
            }
        }
        _ => return Ok(None),
    };
    Ok(Some(
        next.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    ))
}

fn local_on_date(date: NaiveDate, time: NaiveTime) -> Result<DateTime<Utc>, &'static str> {
    let local = date.and_time(time);
    if let Some(value) = first_local(local) {
        return Ok(value.with_timezone(&Utc));
    }
    // JavaScript Date uses compatible disambiguation: a nonexistent wall time
    // advances by the size of the clock jump, preserving its minute value.
    let before = (1..=1_440)
        .find_map(|minutes| first_local(local - ChronoDuration::minutes(minutes)))
        .ok_or("automation_schedule_invalid")?;
    let after = (1..=1_440)
        .find_map(|minutes| first_local(local + ChronoDuration::minutes(minutes)))
        .ok_or("automation_schedule_invalid")?;
    let jump = after.offset().fix().local_minus_utc() - before.offset().fix().local_minus_utc();
    if jump > 0 {
        if let Some(shifted) = first_local(local + ChronoDuration::seconds(i64::from(jump))) {
            return Ok(shifted.with_timezone(&Utc));
        }
    }
    Ok(after.with_timezone(&Utc))
}

fn first_local(local: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&local) {
        LocalResult::Single(date) => Some(date),
        LocalResult::Ambiguous(first, second) => Some(first.min(second)),
        LocalResult::None => None,
    }
}

fn legacy_task_paths() -> Result<Vec<PathBuf>, &'static str> {
    let mut paths = Vec::new();
    if let Ok(system) = crate::app_paths::system_root() {
        paths.push(system.join("agent").join("super-agent").join("tasks.json"));
        let scene_root = system.join("scenes");
        let scenes = match fs::read_dir(&scene_root) {
            Ok(scenes) => Some(scenes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err("task_migration_unreadable"),
        };
        if let Some(scenes) = scenes {
            for entry in scenes {
                let entry = entry.map_err(|_| "task_migration_unreadable")?;
                paths.push(
                    entry
                        .path()
                        .join("agent")
                        .join("super-agent")
                        .join("tasks.json"),
                );
            }
        }
    } else {
        return Err("task_migration_unreadable");
    }
    if let Ok(data) = crate::app_paths::data_root() {
        paths.push(data.join("agent").join("super-agent").join("tasks.json"));
    } else {
        return Err("task_migration_unreadable");
    }
    Ok(paths)
}

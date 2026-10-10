//! Publish due task-template instances and advance the template in one CAS write.

use crate::automation_persistence::{read_document, write_document, DocumentKind};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use super::{automation_schedule::next_run, lifecycle::HostLifecycle};

pub(super) async fn run(roots: Arc<RwLock<HashMap<String, PathBuf>>>, lifecycle: HostLifecycle) {
    let mut ticker = tokio::time::interval(Duration::from_secs(15));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut cursor = 0usize;
    loop {
        ticker.tick().await;
        let roots = roots.clone();
        let stop = lifecycle.clone();
        let _ = lifecycle
            .blocking(move || scan(&roots, cursor, &stop))
            .await;
        cursor = cursor.wrapping_add(1);
    }
}

fn scan(roots: &Arc<RwLock<HashMap<String, PathBuf>>>, cursor: usize, stop: &HostLifecycle) {
    let Ok(registered) = roots.read() else { return };
    let mut paths: Vec<_> = registered.values().cloned().collect();
    drop(registered);
    paths.sort();
    paths.dedup();
    if !paths.is_empty() {
        let offset = cursor % paths.len();
        paths.rotate_left(offset);
    }
    for root in paths.into_iter().take(24) {
        if stop.stopping() {
            return;
        }
        let file = root.join(".zicode/tasks/tasks.json");
        if let Err(code) = queue_due(&file, Utc::now()) {
            log::warn!(
                "[automation] task template scan failed {}: {code}",
                file.display()
            );
        }
    }
}

fn queue_due(file: &Path, now: DateTime<Utc>) -> Result<(), &'static str> {
    let Some(mut snapshot) = read_document(file, DocumentKind::Tasks)? else {
        return Ok(());
    };
    let tasks = snapshot
        .value
        .get_mut("tasks")
        .and_then(Value::as_array_mut)
        .ok_or("task_store_invalid")?;
    let timestamp = now.to_rfc3339_opts(SecondsFormat::Millis, true);
    let mut added = Vec::new();
    let mut changed = false;
    let mut processed = 0;
    for index in 0..tasks.len() {
        let template = &tasks[index];
        if processed >= 4 {
            break;
        }
        if template.get("status").and_then(Value::as_str) == Some("draft")
            || template.get("enabled").and_then(Value::as_bool) == Some(false)
            || !matches!(
                template.get("schedule").and_then(Value::as_str),
                Some("interval" | "daily")
            )
        {
            continue;
        }
        let Some(due) = template.get("nextRunAt").and_then(Value::as_str) else {
            continue;
        };
        let Ok(due_time) = DateTime::parse_from_rfc3339(due) else {
            continue;
        };
        if due_time > now {
            continue;
        }
        let Some(id) = template.get("id").and_then(Value::as_str) else {
            continue;
        };
        let instance_id = format!(
            "scheduled-task-{:x}",
            Sha256::digest(serde_json::to_vec(&(id, due)).map_err(|_| "task_store_invalid")?)
        );
        let next = match next_run(template, &timestamp) {
            Ok(next) => next,
            Err(code) => {
                log::warn!("[automation] invalid task template {id}: {code}");
                continue;
            }
        };
        let exists = tasks
            .iter()
            .chain(added.iter())
            .any(|task| task.get("id").and_then(Value::as_str) == Some(&instance_id));
        if !exists {
            let mut instance = template.clone();
            instance["id"] = json!(instance_id);
            instance["scheduledFrom"] = json!(id);
            for key in [
                "schedule",
                "intervalMinutes",
                "dailyTime",
                "nextRunAt",
                "failReason",
            ] {
                instance[key] = Value::Null;
            }
            instance["enabled"] = json!(true);
            instance["status"] = json!("pending");
            instance["retryCount"] = json!(0);
            instance["totalCost"] = json!(0);
            instance["result"] =
                json!({"status":null,"summary":null,"completedAt":null,"failReason":null});
            instance["dispatch"] = json!({});
            instance["automation"] = json!({"workflowId":null,"trigger":"schedule","autoDispatch":template.get("requireApproval").and_then(Value::as_bool) != Some(true)});
            instance["events"] = json!([{"at":timestamp,"type":"queued","status":"pending","message":"Created by the scheduled task."}]);
            added.push(instance);
        }
        tasks[index]["nextRunAt"] = json!(next);
        processed += 1;
        changed = true;
    }
    if changed {
        tasks.extend(added);
        write_document(
            file,
            DocumentKind::Tasks,
            &snapshot.revision,
            &snapshot.value,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn preserves_long_intervals_and_rejects_overflow() {
        let rule = json!({"schedule":"interval","intervalMinutes":20160});
        assert_eq!(
            next_run(&rule, "2026-10-02T01:00:00Z").unwrap().as_deref(),
            Some("2026-10-16T01:00:00.000Z")
        );
        assert!(next_run(
            &json!({"schedule":"interval","intervalMinutes":1e100}),
            "2026-10-02T01:00:00Z"
        )
        .is_err());
    }

    #[test]
    fn persists_instance_and_next_due_together_and_repairs_without_duplication() {
        let root = std::env::temp_dir().join(format!("zicode-template-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("tasks.json");
        let due = "2026-10-02T01:00:00Z";
        let now = DateTime::parse_from_rfc3339(due)
            .unwrap()
            .with_timezone(&Utc);
        fs::write(&file, json!({"tasks":[{"id":"tpl","status":"pending","enabled":true,"schedule":"interval","intervalMinutes":5,"nextRunAt":due,"requireApproval":false,"dispatch":{"childInstanceId":"old"},"totalCost":99}]}).to_string()).unwrap();
        queue_due(&file, now).unwrap();
        let first = read_document(&file, DocumentKind::Tasks).unwrap().unwrap();
        assert_eq!(first.value["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(first.value["tasks"][1]["scheduledFrom"], "tpl");
        assert_eq!(first.value["tasks"][1]["automation"]["autoDispatch"], true);
        assert_eq!(first.value["tasks"][1]["dispatch"], json!({}));
        assert_eq!(first.value["tasks"][1]["totalCost"], 0);
        assert_eq!(
            first.value["tasks"][0]["nextRunAt"],
            "2026-10-02T01:05:00.000Z"
        );
        queue_due(&file, now).unwrap();
        assert_eq!(
            read_document(&file, DocumentKind::Tasks)
                .unwrap()
                .unwrap()
                .revision,
            first.revision
        );
        let mut partial = first.value.clone();
        partial["tasks"][0]["nextRunAt"] = json!(due);
        write_document(&file, DocumentKind::Tasks, &first.revision, &partial).unwrap();
        queue_due(&file, now).unwrap();
        let repaired = read_document(&file, DocumentKind::Tasks).unwrap().unwrap();
        assert_eq!(repaired.value["tasks"].as_array().unwrap().len(), 2);
        assert_eq!(
            repaired.value["tasks"][1]["id"],
            first.value["tasks"][1]["id"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn skips_drafts_disabled_future_and_invalid_templates_but_queues_approval() {
        let root = std::env::temp_dir().join(format!("zicode-template-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let file = root.join("tasks.json");
        let mut tasks = vec![];
        for (id, status, enabled, schedule, time) in [
            ("draft", "draft", true, "interval", "2020-01-01T00:00:00Z"),
            ("off", "pending", false, "interval", "2020-01-01T00:00:00Z"),
            (
                "future",
                "pending",
                true,
                "interval",
                "2099-01-01T00:00:00Z",
            ),
            ("bad", "pending", true, "daily", "2020-01-01T00:00:00Z"),
            (
                "approval",
                "pending",
                true,
                "interval",
                "2020-01-01T00:00:00Z",
            ),
        ] {
            tasks.push(json!({"id":id,"status":status,"enabled":enabled,"schedule":schedule,"dailyTime":"invalid","nextRunAt":time,"requireApproval":true}));
        }
        fs::write(&file, json!({"tasks":tasks}).to_string()).unwrap();
        queue_due(&file, Utc::now()).unwrap();
        let saved = read_document(&file, DocumentKind::Tasks).unwrap().unwrap();
        assert_eq!(saved.value["tasks"].as_array().unwrap().len(), 6);
        assert_eq!(saved.value["tasks"][5]["scheduledFrom"], "approval");
        assert_eq!(saved.value["tasks"][5]["automation"]["autoDispatch"], false);
        fs::remove_dir_all(root).unwrap();
    }
}

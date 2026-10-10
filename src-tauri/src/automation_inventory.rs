use crate::automation_persistence::{read_document, DocumentKind};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWorkspaceStatus {
    workspace_id: String,
    path: String,
    scanned_at: String,
    status: &'static str,
    workflow_count: usize,
    due_count: usize,
    error_code: Option<&'static str>,
    task_status: &'static str,
    pending_count: usize,
    approval_count: usize,
    running_count: usize,
    blocked_count: usize,
    failed_count: usize,
    task_error_code: Option<&'static str>,
}

pub fn scan_registered_workspaces(
    mut workspaces: Vec<(String, String)>,
) -> Vec<AutomationWorkspaceStatus> {
    workspaces.sort_by(|left, right| left.1.cmp(&right.1));
    workspaces
        .into_iter()
        .map(|(workspace_id, path)| scan_workspace(workspace_id, path))
        .collect()
}

fn scan_workspace(workspace_id: String, path: String) -> AutomationWorkspaceStatus {
    let mut result = AutomationWorkspaceStatus {
        workspace_id,
        path,
        scanned_at: Utc::now().to_rfc3339(),
        status: "uninitialized",
        workflow_count: 0,
        due_count: 0,
        error_code: None,
        task_status: "uninitialized",
        pending_count: 0,
        approval_count: 0,
        running_count: 0,
        blocked_count: 0,
        failed_count: 0,
        task_error_code: None,
    };
    let root_path = result.path.clone();
    let root = Path::new(&root_path);
    if !root.is_dir() {
        result.task_status = "error";
        result.task_error_code = Some("workspace_unavailable");
        return result.fail("workspace_unavailable");
    }
    scan_tasks(root, &mut result);
    let file = root
        .join(".zicode")
        .join("automation")
        .join("workflows.json");
    let document = match read_document(&file, DocumentKind::Workflows) {
        Ok(Some(snapshot)) => snapshot.value,
        Ok(None) => return result,
        Err(code) => return result.fail(code),
    };
    let Some(workflows) = document.get("workflows").and_then(Value::as_array) else {
        return result.fail("automation_workspace_invalid");
    };
    let now = Utc::now();
    for workflow in workflows {
        let Some(schedule) = workflow.get("schedule").and_then(Value::as_str) else {
            return result.fail("automation_workspace_invalid");
        };
        if !matches!(schedule, "manual" | "interval" | "daily") {
            return result.fail("automation_workspace_invalid");
        }
        if workflow.get("enabled").and_then(Value::as_bool) != Some(false)
            && schedule != "manual"
            && workflow.get("approvalPending").and_then(Value::as_bool) != Some(true)
        {
            let due = match workflow.get("nextRunAt") {
                None | Some(Value::Null) => true,
                Some(Value::String(value)) => match DateTime::parse_from_rfc3339(value) {
                    Ok(time) => time.with_timezone(&Utc) <= now,
                    Err(_) => return result.fail("automation_workspace_invalid"),
                },
                _ => return result.fail("automation_workspace_invalid"),
            };
            if due {
                result.due_count += 1;
            }
        }
    }
    result.status = "ready";
    result.workflow_count = workflows.len();
    result
}

fn scan_tasks(root: &Path, result: &mut AutomationWorkspaceStatus) {
    let file = root.join(".zicode").join("tasks").join("tasks.json");
    let document = match read_document(&file, DocumentKind::Tasks) {
        Ok(Some(snapshot)) => snapshot.value,
        Ok(None) => return,
        Err(code) => return result.fail_tasks(code),
    };
    let Some(tasks) = document.get("tasks").and_then(Value::as_array) else {
        return result.fail_tasks("task_store_invalid");
    };
    let mut pending = 0;
    let mut approval = 0;
    let mut running = 0;
    let mut blocked = 0;
    let mut failed = 0;
    for task in tasks {
        let is_automation = task.pointer("/source/channel").and_then(Value::as_str)
            == Some("automation")
            || task
                .pointer("/automation/workflowId")
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty());
        if !is_automation {
            continue;
        }
        match task.get("status").and_then(Value::as_str) {
            Some("pending")
                if task
                    .pointer("/automation/autoDispatch")
                    .and_then(Value::as_bool)
                    != Some(true) =>
            {
                approval += 1;
            }
            Some("pending") => pending += 1,
            Some("running") => running += 1,
            Some("blocked") => blocked += 1,
            Some("failed") => failed += 1,
            _ => {}
        }
    }
    result.task_status = "ready";
    result.pending_count = pending;
    result.approval_count = approval;
    result.running_count = running;
    result.blocked_count = blocked;
    result.failed_count = failed;
}

impl AutomationWorkspaceStatus {
    fn fail(mut self, code: &'static str) -> Self {
        self.status = "error";
        self.workflow_count = 0;
        self.due_count = 0;
        self.error_code = Some(code);
        self
    }

    fn fail_tasks(&mut self, code: &'static str) {
        self.task_status = "error";
        self.task_error_code = Some(code);
        self.pending_count = 0;
        self.approval_count = 0;
        self.running_count = 0;
        self.blocked_count = 0;
        self.failed_count = 0;
    }
}

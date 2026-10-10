use super::TaskRunner;
use serde_json::{json, Value};
use std::path::Path;

#[cfg(test)]
pub fn dispatch(
    runner: &TaskRunner,
    root: &Path,
    workspace: &str,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, String> {
    dispatch_environment(
        runner,
        root,
        workspace,
        request_id,
        operation,
        frame,
        &Default::default(),
    )
}

pub fn dispatch_environment(
    runner: &TaskRunner,
    root: &Path,
    workspace: &str,
    request_id: &str,
    operation: &str,
    frame: &Value,
    environment: &crate::project_environment::Environment,
) -> Result<Value, String> {
    let mut response = json!({ "requestId": request_id, "operation": operation });
    match operation {
        "project_task_directories" => {
            response["discovery"] = json!(super::directories::discover(root)?);
        }
        "project_task_validate_directory" => {
            let directory = directory(frame)?;
            super::directories::resolve(root, directory)?;
            response["directory"] = json!(directory);
        }
        "project_task_catalog" => {
            let directory = directory(frame)?;
            let selected = super::directories::resolve(root, directory)?;
            response["catalog"] = json!(super::catalog::read_with_environment(
                &selected,
                root,
                environment
            )?);
            response["catalog"]["directory"] = json!(directory);
        }
        "project_task_runs" => {
            let history = runner.run_history(root, workspace);
            response["runs"] = json!(history.runs);
            response["historyStatus"] = json!(history.history_status);
        }
        "clear_project_task_history" => {
            runner.clear_history(root, workspace)?;
            response["cleared"] = json!(true);
        }
        "start_project_task" => {
            let name = frame
                .get("name")
                .and_then(Value::as_str)
                .ok_or("task_not_runnable")?;
            let fingerprint = frame
                .get("fingerprint")
                .and_then(Value::as_str)
                .ok_or("task_catalog_changed")?;
            response["run"] = json!(runner.start_with_environment(
                root,
                workspace,
                directory(frame)?,
                name,
                fingerprint,
                environment
            )?);
        }
        "stop_project_task" => {
            let id = frame
                .get("runId")
                .and_then(Value::as_str)
                .ok_or("task_run_not_found")?;
            response["run"] = json!(runner.stop(workspace, id)?);
        }
        _ => return Err("task_operation_unsupported".into()),
    }
    response["type"] = json!(if operation.starts_with("project_task_") {
        "data_response"
    } else {
        "host_response"
    });
    Ok(response)
}

fn directory(frame: &Value) -> Result<&str, String> {
    match frame.get("directory") {
        None => Ok(""),
        Some(Value::String(value)) => Ok(value),
        _ => Err("task_directory_invalid".into()),
    }
}

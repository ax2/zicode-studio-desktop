use super::{host_data_error, HostState};
use serde_json::{json, Value};

pub(super) async fn discover_conda(
    state: &HostState,
    request_id: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    let workspace = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
    state
        .data
        .workspace_root_path(workspace)
        .map_err(host_data_error)?;
    let discovery = tokio::task::spawn_blocking(crate::project_environment::discover_conda)
        .await
        .map_err(|_| {
            (
                "project_environment_failed",
                "project_conda_discovery_unavailable".into(),
            )
        })?
        .map_err(|message| ("project_environment_failed", message))?;
    Ok(
        json!({"type":"host_response", "operation":"project_environment_discover_conda", "requestId":request_id, "discovery":discovery}),
    )
}

pub(super) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    let workspace = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or(("invalid_workspace", "workspaceId is required".into()))?
        .to_owned();
    let root = state
        .data
        .workspace_root_path(&workspace)
        .map_err(host_data_error)?;
    let store = state.project_environment.clone();
    let frame = frame.clone();
    let save = operation == "project_environment_save";
    let settings = tokio::task::spawn_blocking(move || -> Result<_, String> {
        if save {
            let revision = frame
                .get("revision")
                .and_then(Value::as_u64)
                .ok_or("project_environment_invalid")?;
            let directories: Vec<String> = serde_json::from_value(
                frame
                    .get("directories")
                    .cloned()
                    .ok_or("project_environment_invalid")?,
            )
            .map_err(|_| "project_environment_invalid")?;
            let python_update = match frame.get("pythonEnvironment") {
                None => None,
                Some(Value::Null) => Some(None),
                Some(Value::String(path)) => Some(Some(path.clone())),
                _ => return Err("project_python_environment_invalid".into()),
            };
            store.save_selection(&root, &workspace, revision, directories, python_update)
        } else {
            store.read(&root, &workspace)
        }
    })
    .await
    .map_err(|_| {
        (
            "project_environment_failed",
            "project_environment_unavailable".into(),
        )
    })?
    .map_err(|message| ("project_environment_failed", message))?;
    Ok(
        json!({"type":"host_response", "operation": operation, "requestId":request_id, "settings":settings}),
    )
}

/// Resolve against the registered workspace on every read; never accept an absolute directory.
pub(super) async fn inspect(
    state: &HostState,
    request_id: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    let workspace = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
    let directory = match frame.get("directory") {
        None => "",
        Some(Value::String(value)) => value,
        _ => {
            return Err((
                "project_environment_failed",
                "task_directory_invalid".into(),
            ))
        }
    };
    let root = state
        .data
        .workspace_root_path(workspace)
        .map_err(host_data_error)?;
    let selected = crate::project_tasks::directories::resolve(&root, directory)
        .map_err(|message| ("project_environment_failed", message))?;
    let environment = state
        .project_environment
        .resolve(&root, workspace)
        .map_err(|message| ("project_environment_failed", message))?;
    let report =
        crate::host_data::environment::inspect_directory(&selected, &root, directory, &environment)
            .await;
    Ok(json!({"type": "data_response", "requestId": request_id,
        "operation": "workspace_environment", "report": report}))
}

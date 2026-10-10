//! Desktop-only Git index mutation for a registered workspace.
use super::{host_data_error, HostState};
use serde_json::{json, Value};

pub(super) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    let workspace = frame
        .get("workspaceId")
        .and_then(Value::as_str)
        .ok_or(("invalid_workspace", "workspaceId is required".into()))?;
    let path = frame
        .get("path")
        .and_then(Value::as_str)
        .ok_or(("git_stage_invalid", "git_stage_invalid".into()))?;
    let index = frame
        .get("indexStatus")
        .and_then(Value::as_str)
        .ok_or(("git_stage_invalid", "git_stage_invalid".into()))?;
    let worktree = frame
        .get("worktreeStatus")
        .and_then(Value::as_str)
        .ok_or(("git_stage_invalid", "git_stage_invalid".into()))?;
    let root = state
        .data
        .workspace_root_path(workspace)
        .map_err(host_data_error)?;
    let status = match operation {
        "workspace_git_stage" => {
            crate::host_data::git_stage::stage(&root, path, index, worktree).await
        }
        "workspace_git_unstage" => {
            crate::host_data::git_unstage::unstage(&root, path, index, worktree).await
        }
        _ => {
            return Err((
                "unknown_operation",
                "unsupported Git index operation".into(),
            ))
        }
    }
    .map_err(|message| ("git_index_failed", message))?;
    Ok(json!({
        "type": "host_response",
        "requestId": request_id,
        "operation": operation,
        "status": status,
    }))
}

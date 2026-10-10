use super::{host_data_error, HostState};
use serde_json::Value;

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
    let manager = state.terminals.clone();
    let environment = if matches!(operation, "terminal_open" | "terminal_open_directory") {
        state
            .project_environment
            .resolve(&root, &workspace)
            .map_err(|message| ("terminal_failed", message))?
    } else {
        Default::default()
    };
    let request_id = request_id.to_owned();
    let operation = operation.to_owned();
    let frame = frame.clone();
    tokio::task::spawn_blocking(move || {
        crate::project_terminal::protocol::dispatch_environment(
            &manager,
            &root,
            &workspace,
            &request_id,
            &operation,
            &frame,
            &environment,
        )
    })
    .await
    .map_err(|_| ("terminal_failed", "terminal_request_failed".into()))?
    .map_err(|message| ("terminal_failed", message))
}

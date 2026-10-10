use super::{host_data_error, HostState};
use crate::metadata_store::tool_access::Mutation;
use serde_json::{json, Value};
#[cfg(test)]
mod tests;

pub(super) async fn dispatch(
    state: &HostState,
    request_id: &str,
    operation: &str,
    frame: &Value,
) -> Result<Value, (&'static str, String)> {
    let scope = |name| {
        frame
            .get(name)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or((
                "tool_access_invalid_scope",
                "A scene and registered workspace are required".into(),
            ))
    };
    let scene = scope("sceneId")?;
    let workspace = scope("workspaceId")?;
    state
        .data
        .workspace_root_path(&workspace)
        .map_err(host_data_error)?;
    if frame.get("schemaVersion").and_then(Value::as_u64) != Some(1) {
        return Err((
            "tool_access_incompatible",
            "Unsupported tool-access schema".into(),
        ));
    }
    let mutation = if operation == "tool_access_mutate" {
        Some(
            serde_json::from_value::<Mutation>(frame.get("mutation").cloned().ok_or((
                "tool_access_invalid_mutation",
                "Mutation is required".into(),
            ))?)
            .map_err(|_| {
                (
                    "tool_access_invalid_mutation",
                    "Unsupported tool-access mutation".into(),
                )
            })?,
        )
    } else {
        None
    };
    let metadata = state.tool_access.clone();
    let access = tokio::task::spawn_blocking(move || {
        let mut store = metadata
            .lock()
            .map_err(|_| "tool_access_storage_unavailable")?;
        match mutation {
            Some(mutation) => store.mutate_tool_access(&scene, &workspace, mutation),
            None => store.read_tool_access(&scene, &workspace),
        }
    })
    .await
    .map_err(|_| {
        (
            "tool_access_failed",
            "tool_access_storage_unavailable".into(),
        )
    })?
    .map_err(|message| ("tool_access_failed", message))?;
    Ok(json!({"type":"host_response","operation":operation,"requestId":request_id,"access":access}))
}

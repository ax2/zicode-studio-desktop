//! Desktop library over user-approved raw snapshots; no second payload/index tree.
use super::*;
mod files;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct ListQuery {
    schema_version: u32, scene_id: String, workspace_id: String,
    #[serde(default)] query: String,
    #[serde(default)] offset: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct ReadQuery {
    schema_version: u32, scene_id: String, workspace_id: String,
    save_id: String, receipt_version: String,
}
fn scope(state: &HostState, schema: u32, scene: &str, workspace: &str) -> Result<(PathBuf, String), ApiError> {
    if schema != 1 || scene.is_empty() || scene.len() > 128 || workspace.is_empty() || workspace.len() > 256 {
        return Err(rejected("resource_schema_unsupported"));
    }
    let registry = state.plugins.lock().map_err(|_| rejected("registry_unavailable"))?;
    if !registry.list(scene).iter().any(|p| p.manifest.id == "com.zicode.artifacts" && p.enabled
        && p.permission_grants.get("storage.plugin") == Some(&true)) { return Err(rejected("permission_denied")); }
    let revision = registry.execution_revision(scene, "com.zicode.artifacts");
    drop(registry);
    let root = state.data.workspace_roots().read().map_err(|_| rejected("resource_save_workspace_unavailable"))?
        .get(workspace).cloned().ok_or_else(|| rejected("resource_save_workspace_unavailable"))?;
    let root = root.canonicalize().map_err(|_| rejected("resource_save_workspace_unavailable"))?;
    let proof = sha256_hex(&serde_json::to_vec(&json!([root, workspace, scene, revision])).unwrap());
    Ok((root, proof))
}
pub(in crate::host_server) async fn list(State(state): State<Arc<HostState>>, headers: HeaderMap, Query(request): Query<ListQuery>) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.query.chars().count() > 120 || request.offset > 128 { return Err(rejected("resource_metadata_invalid")); }
    blocking(state.clone(), move || {
        let (root, proof) = scope(&state, request.schema_version, &request.scene_id, &request.workspace_id)?;
        let result = files::list(&root, &request.workspace_id, &request.query, request.offset)?;
        if scope(&state, request.schema_version, &request.scene_id, &request.workspace_id)?.1 != proof { return Err(rejected("resource_authorization_changed")); }
        Ok(result)
    }).await
}
pub(in crate::host_server) async fn read(State(state): State<Arc<HostState>>, headers: HeaderMap, Query(request): Query<ReadQuery>) -> Result<axum::response::Response, ApiError> {
    desktop(&state, &headers)?;
    let operations_state = state.clone();
    let Json((bytes, filename)) = operations_state.plugin_resource_operations.run(move || {
        let (root, proof) = scope(&state, request.schema_version, &request.scene_id, &request.workspace_id)?;
        let result = files::read(&root, &request.workspace_id, &request.save_id, &request.receipt_version)?;
        if scope(&state, request.schema_version, &request.scene_id, &request.workspace_id)?.1 != proof { return Err(rejected("resource_authorization_changed")); }
        Ok(result)
    }).await?;
    use axum::response::IntoResponse;
    let mut response = bytes.into_response();
    for (name, value) in [("content-type", "application/octet-stream".to_string()), ("cache-control", "no-store".into()),
        ("x-content-type-options", "nosniff".into()), ("content-disposition", format!("attachment; filename=\"{filename}\""))] {
        response.headers_mut().insert(axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(), value.parse().unwrap());
    }
    Ok(response)
}

#[cfg(test)]
pub(in crate::host_server::plugin_resources) mod tests;

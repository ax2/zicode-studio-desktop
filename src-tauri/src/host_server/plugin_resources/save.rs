//! Desktop confirmation for managed raw exports, never a caller-selected filesystem path.
use super::*;
use std::path::PathBuf;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareSave { schema_version: u32, source: Access }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct CommitSave { schema_version: u32, source: Access, grant_id: String, confirmed: bool }

fn destination(state: &HostState, source: &Access) -> Result<(String, PathBuf, String, String), ApiError> {
    let target = state.runtimes.statuses().map_err(|_| rejected("runtime_unavailable"))?.into_iter()
        .find(|status| status.target.instance_id == source.owner.runtime_id && status.target.session_id == source.owner.session_id)
        .ok_or_else(|| rejected("runtime_stopped"))?.target;
    let root = state.data.workspace_roots().read().map_err(|_| rejected("resource_save_workspace_unavailable"))?
        .get(&target.workspace_id).cloned().ok_or_else(|| rejected("resource_save_workspace_unavailable"))?;
    let root = root.canonicalize().map_err(|_| rejected("resource_save_workspace_unavailable"))?;
    let registry = state.plugins.lock().map_err(|_| rejected("registry_unavailable"))?;
    if !registry.list(&target.scene_id).iter().any(|p| p.manifest.id == "com.zicode.artifacts" && p.enabled
        && p.permission_grants.get("storage.plugin") == Some(&true)) { return Err(rejected("permission_denied")); }
    let proof = sha256_hex(&serde_json::to_vec(&json!([target.workspace_id, root,
        registry.execution_revision(&target.scene_id, "com.zicode.artifacts")])).unwrap());
    let version = registry.list(&target.scene_id).into_iter().find(|p| p.manifest.id == source.owner.plugin_id)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?.manifest.version;
    Ok((proof, root, target.workspace_id, version))
}

pub(in crate::host_server) async fn prepare(State(state): State<Arc<HostState>>, headers: HeaderMap, Json(request): Json<PrepareSave>) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?; validate(&request.source)?;
    if request.schema_version != 1 { return Err(rejected("resource_schema_unsupported")); }
    blocking(state.clone(), move || {
        let proof = authority::identity_access(&state, &request.source, None, None)?;
        let (destination, workspace, id, version) = destination(&state, &request.source)?;
        let root = save_files::location(&workspace, false)?; save_files::quota(&root, 0)?;
        state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?
            .prepare_save(&request.source, &proof, destination, workspace, &id, &version)
    }).await
}

pub(in crate::host_server) async fn commit(State(state): State<Arc<HostState>>, headers: HeaderMap, Json(request): Json<CommitSave>) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?; validate(&request.source)?;
    if request.schema_version != 1 { return Err(rejected("resource_schema_unsupported")); }
    if !request.confirmed { return Err(rejected("resource_confirmation_required")); }
    blocking(state.clone(), move || {
        let proof = authority::identity_access(&state, &request.source, None, None)?;
        let (destination_proof, _, _, _) = destination(&state, &request.source)?;
        let (grant, chunks) = {
            let mut store = state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?;
            let grant = store.save_grant(&request.source, &request.grant_id, &proof, &destination_proof)?;
            let chunks = if grant.saved { Vec::new() } else { store.save_chunks(&request.source, &proof)? };
            (grant, chunks)
        };
        if grant.saved {
            save_files::replay(&grant.workspace, &request.grant_id, &grant.receipt, &grant.extension)?;
            return Ok(json!({"schemaVersion":1,"profile":"resource.save.draft1","status":"saved","saved":true,"replayed":true,"receipt":grant.receipt}));
        }
        let staged = save_files::Staged::new(&grant.workspace, &chunks, &grant.receipt, &grant.extension, &request.grant_id)?;
        #[cfg(test)]
        tests::publication::observe(&request.source.owner.runtime_id);
        // Byte hashing/writes are outside the resource lock. Recheck immediately before publication.
        let current = authority::identity_access(&state, &request.source, None, None)?;
        let (destination_current, _, _, _) = destination(&state, &request.source)?;
        let mut store = state.plugin_resources.lock().map_err(|_| rejected("resource_store_unavailable"))?;
        let current_grant = store.save_grant(&request.source, &request.grant_id, &current, &destination_current)?;
        if !current_grant.saved { staged.publish(&request.grant_id)?; store.mark_saved(&request.grant_id); }
        Ok(json!({"schemaVersion":1,"profile":"resource.save.draft1","status":"saved","saved":true,"replayed":current_grant.saved,"receipt":grant.receipt}))
    }).await
}

#[cfg(test)]
pub(in crate::host_server::plugin_resources) mod tests;

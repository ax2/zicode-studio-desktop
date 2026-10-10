//! Trusted desktop confirmation only. Never exposed to the plugin broker or iframe bridge.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareTransfer {
    schema_version: u32,
    source: Access,
    target: Owner,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct CommitTransfer {
    schema_version: u32,
    source: Access,
    grant_id: String,
    confirmed: bool,
}

fn target_identity(state: &HostState, target: &Owner) -> Result<(String, Value), ApiError> {
    let proof = identity(state, target, None)?;
    let runtime = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .find(|s| {
            s.target.instance_id == target.runtime_id && s.target.session_id == target.session_id
        })
        .ok_or_else(|| rejected("runtime_stopped"))?;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let plugin = registry
        .list(&runtime.target.scene_id)
        .into_iter()
        .find(|p| p.manifest.id == target.plugin_id && p.enabled)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
    if plugin
        .manifest
        .runtime
        .get("resourceInputProfile")
        .and_then(Value::as_str)
        != Some("resource.wasi.input.draft2")
    {
        return Err(rejected("resource_profile_unsupported"));
    }
    let (_, kind) = registry
        .plugin_runtime_entry(&runtime.target.scene_id, &target.plugin_id)
        .map_err(|_| rejected("resource_module_unavailable"))?;
    if kind != "wasi" {
        return Err(rejected("resource_profile_unsupported"));
    }
    let capability = registry
        .capability(
            &runtime.target.scene_id,
            &target.plugin_id,
            &target.capability_id,
        )
        .ok_or_else(|| rejected("capability_unavailable"))?;
    Ok((
        proof,
        json!({"pluginId":target.plugin_id,"capabilityId":target.capability_id,
        "pluginName":plugin.manifest.display_name.unwrap_or(plugin.manifest.name),"pluginVersion":plugin.manifest.version,"toolTitle":capability.title}),
    ))
}

pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PrepareTransfer>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request.source)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    blocking(state.clone(), move || {
        let source_proof = authority::identity_access(&state, &request.source, None, None)?;
        let (target_proof, presentation) = target_identity(&state, &request.target)?;
        let mut result = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .prepare_transfer(&request.source, &source_proof, request.target, target_proof)?;
        result["target"] = presentation;
        Ok(result)
    })
    .await
}

pub(in crate::host_server) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CommitTransfer>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request.source)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    if !request.confirmed {
        return Err(rejected("resource_confirmation_required"));
    }
    if uuid::Uuid::parse_str(&request.grant_id).is_err() {
        return Err(rejected("resource_transfer_unavailable"));
    }
    blocking(state.clone(), move || {
        let source_proof = authority::identity_access(&state, &request.source, None, None)?;
        let target = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .transfer_target(&request.source, &request.grant_id)?;
        let (target_proof, _) = target_identity(&state, &target)?;
        state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .commit_transfer(
                &request.source,
                &request.grant_id,
                &source_proof,
                &target_proof,
            )
    })
    .await
}

#[cfg(test)]
pub(super) mod tests;

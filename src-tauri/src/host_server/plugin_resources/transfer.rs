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

pub(super) fn target_identity(
    state: &HostState,
    target: &Owner,
    mime_type: Option<&str>,
) -> Result<(String, Value), ApiError> {
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
        .execution_plugin(&runtime.target.scene_id, &target.plugin_id)
        .filter(|p| p.enabled)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
    let capability = registry
        .capability(
            &runtime.target.scene_id,
            &target.plugin_id,
            &target.capability_id,
        )
        .ok_or_else(|| rejected("capability_unavailable"))?;
    if mime_type.is_some_and(|mime| {
        !capability
            .resource_input_mime_types
            .as_ref()
            .is_some_and(|types| types.iter().any(|item| item == mime))
    }) {
        return Err(rejected("resource_input_type_unsupported"));
    }
    let profile = plugin
        .manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .and_then(|caps| {
            caps.iter()
                .find(|cap| cap.get("id").and_then(Value::as_str) == Some(&target.capability_id))
        })
        .and_then(|cap| cap.get("resourceInputProfile").and_then(Value::as_str))
        .or_else(|| {
            plugin
                .manifest
                .runtime
                .get("resourceInputProfile")
                .and_then(Value::as_str)
        });
    if profile == Some("resource.wasi.input.draft2") {
        let (_, kind) = registry
            .plugin_runtime_entry(&runtime.target.scene_id, &target.plugin_id)
            .map_err(|_| rejected("resource_module_unavailable"))?;
        if kind != "wasi" {
            return Err(rejected("resource_profile_unsupported"));
        }
    } else if !(plugin.origin == crate::plugin_registry::PluginOrigin::BuiltIn
        && ((profile == Some(crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE)
            && target.plugin_id
                == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID
            && target.capability_id
                == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID)
            || (cfg!(target_os = "windows")
                && profile == Some(crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE)
                && target.plugin_id == crate::plugin_resource_execution::HOST_OCR_PLUGIN_ID
                && target.capability_id
                    == crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID)
            || (profile == Some(crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE)
                && target.plugin_id
                    == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID
                && target.capability_id
                    == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID)))
    {
        return Err(rejected("resource_profile_unsupported"));
    }
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
        let mime_type = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .resource_mime_type(&request.source, &source_proof)?;
        let (target_proof, presentation) =
            target_identity(&state, &request.target, Some(&mime_type))?;
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
        let (target, mime_type) = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?
            .transfer_target(&request.source, &request.grant_id)?;
        let (target_proof, _) = target_identity(&state, &target, Some(&mime_type))?;
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

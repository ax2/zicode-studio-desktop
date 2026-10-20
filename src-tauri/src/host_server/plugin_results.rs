//! Desktop-owned result snapshots and explicit, version-bound save grants.
pub(super) mod module_snapshot;
mod store;
pub(super) mod transfer;
use super::*;
use std::time::Instant;
pub(crate) use store::Store;
type ApiError = (StatusCode, Json<Value>);

#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Scope {
    workspace_id: String,
    scene_id: String,
    plugin_id: String,
    capability_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Prepare {
    scope: Scope,
    result_id: String,
    title: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Commit {
    scope: Scope,
    grant_id: String,
    confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SaveStatus {
    scope: Scope,
    grant_id: String,
}

fn rejected(code: &'static str) -> ApiError {
    plugin_api_error(
        StatusCode::CONFLICT,
        code,
        "Refresh the result or current permissions before saving",
    )
}

fn desktop(state: &HostState, headers: &HeaderMap) -> Result<(), ApiError> {
    if !desktop_http_token_authorized(headers, &state.desktop_token) {
        return Err(plugin_api_error(StatusCode::FORBIDDEN, "desktop_only", ""));
    }
    Ok(())
}

fn proof(registry: &PluginRegistry, scope: &Scope) -> Result<(String, String), ApiError> {
    proof_module(registry, scope, None)
}

fn proof_module(
    registry: &PluginRegistry,
    scope: &Scope,
    snapshot: Option<&[u8]>,
) -> Result<(String, String), ApiError> {
    if scope.workspace_id.len() > 64 || uuid::Uuid::parse_str(&scope.workspace_id).is_err() {
        return Err(rejected("result_workspace_invalid"));
    }
    if scope.capability_id == "service.http.get.v1" {
        let plugin = registry
            .execution_plugin(&scope.scene_id, &scope.plugin_id)
            .filter(|plugin| plugin.enabled)
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        if plugin
            .manifest
            .required_profiles
            .get(crate::host_server::plugin_services::HTTP_GET_PROFILE)
            .and_then(Value::as_str)
            != Some("=1.0.0-preview.1")
            || plugin.permission_grants.get("service.http.read") != Some(&true)
        {
            return Err(rejected("result_source_unavailable"));
        }
        let version = plugin.manifest.version.clone();
        let digest = sha256_hex(
            &serde_json::to_vec(&json!([
                "service.http.get.v1",
                registry.execution_revision(&scope.scene_id, &scope.plugin_id),
                plugin.manifest,
                plugin.permission_grants
            ]))
            .unwrap(),
        );
        return Ok((digest, version));
    }
    if scope.capability_id == "model.generate.v1" {
        let plugin = registry
            .execution_plugin(&scope.scene_id, &scope.plugin_id)
            .filter(|plugin| plugin.enabled)
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        if plugin
            .manifest
            .required_profiles
            .get("model.generate.v1")
            .and_then(Value::as_str)
            != Some("=1.0.0-preview.1")
            || plugin.permission_grants.get("model.generate") != Some(&true)
            || plugin.permission_grants.get("model.catalog.read") != Some(&true)
        {
            return Err(rejected("result_source_unavailable"));
        }
        let version = plugin.manifest.version.clone();
        let digest = sha256_hex(
            &serde_json::to_vec(&json!([
                "model.generate.v1",
                registry.execution_revision(&scope.scene_id, &scope.plugin_id),
                plugin.manifest,
                plugin.permission_grants
            ]))
            .unwrap(),
        );
        return Ok((digest, version));
    }
    if scope.plugin_id == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID
        && scope.capability_id
            == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID
    {
        let capability = registry
            .capability(&scope.scene_id, &scope.plugin_id, &scope.capability_id)
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        let plugin = registry
            .execution_plugin(&scope.scene_id, &scope.plugin_id)
            .filter(|plugin| plugin.enabled)
            .filter(|plugin| {
                plugin.origin == crate::plugin_registry::PluginOrigin::BuiltIn
                    && plugin
                        .manifest
                        .runtime
                        .get("resourceInputProfile")
                        .and_then(Value::as_str)
                        == Some(crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE)
                    && plugin.permission_grants.get("resource.read") == Some(&true)
            })
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        let version = plugin.manifest.version.clone();
        let digest = sha256_hex(
            &serde_json::to_vec(&json!([
                crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE,
                registry.execution_revision(&scope.scene_id, &scope.plugin_id),
                plugin.manifest,
                plugin.permission_grants,
                capability.input_schema
            ]))
            .unwrap(),
        );
        return Ok((digest, version));
    }
    if scope.plugin_id == crate::plugin_resource_execution::HOST_OCR_PLUGIN_ID
        && scope.capability_id == crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID
    {
        let capability = registry
            .capability(&scope.scene_id, &scope.plugin_id, &scope.capability_id)
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        let plugin = registry
            .execution_plugin(&scope.scene_id, &scope.plugin_id)
            .filter(|plugin| plugin.enabled)
            .filter(|plugin| {
                plugin.origin == crate::plugin_registry::PluginOrigin::BuiltIn
                    && plugin
                        .manifest
                        .required_profiles
                        .get("resource.host.input.v1")
                        .and_then(Value::as_str)
                        == Some("=1.0.0-preview.1")
                    && plugin
                        .manifest
                        .contributes
                        .get("capabilities")
                        .and_then(Value::as_array)
                        .is_some_and(|capabilities| {
                            capabilities.iter().any(|item| {
                                item.get("id").and_then(Value::as_str)
                                    == Some(crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID)
                                    && item.get("resourceInputProfile").and_then(Value::as_str)
                                        == Some(crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE)
                            })
                        })
                    && plugin.permission_grants.get("resource.read") == Some(&true)
            })
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        let version = plugin.manifest.version.clone();
        let digest = sha256_hex(
            &serde_json::to_vec(&json!([
                crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE,
                registry.execution_revision(&scope.scene_id, &scope.plugin_id),
                plugin.manifest,
                plugin.permission_grants,
                capability.input_schema
            ]))
            .unwrap(),
        );
        return Ok((digest, version));
    }
    if scope.plugin_id == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID
        && scope.capability_id
            == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID
    {
        let capability = registry
            .capability(&scope.scene_id, &scope.plugin_id, &scope.capability_id)
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        let plugin = registry
            .execution_plugin(&scope.scene_id, &scope.plugin_id)
            .filter(|plugin| plugin.enabled)
            .filter(|plugin| {
                plugin.origin == crate::plugin_registry::PluginOrigin::BuiltIn
                    && plugin
                        .manifest
                        .runtime
                        .get("resourceInputProfile")
                        .and_then(Value::as_str)
                        == Some(crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE)
                    && plugin.permission_grants.get("resource.read") == Some(&true)
            })
            .ok_or_else(|| rejected("result_source_unavailable"))?;
        let version = plugin.manifest.version.clone();
        let digest = sha256_hex(
            &serde_json::to_vec(&json!([
                crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE,
                registry.execution_revision(&scope.scene_id, &scope.plugin_id),
                plugin.manifest,
                plugin.permission_grants,
                capability.input_schema
            ]))
            .unwrap(),
        );
        return Ok((digest, version));
    }
    let capability = registry
        .capability(&scope.scene_id, &scope.plugin_id, &scope.capability_id)
        .ok_or_else(|| rejected("result_source_unavailable"))?;
    let plugin = registry
        .execution_plugin(&scope.scene_id, &scope.plugin_id)
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| rejected("result_source_unavailable"))?;
    let (entry, kind) = registry
        .plugin_runtime_entry(&scope.scene_id, &scope.plugin_id)
        .map_err(|_| rejected("result_source_integrity"))?;
    if kind != "wasi" {
        return Err(rejected("result_profile_unsupported"));
    }
    let module = match snapshot {
        Some(bytes) => {
            module_snapshot::validate(bytes).map_err(|_| rejected("result_source_integrity"))?;
            std::borrow::Cow::Borrowed(bytes)
        }
        None => std::borrow::Cow::Owned(
            module_snapshot::read(&entry).map_err(|_| rejected("result_source_integrity"))?,
        ),
    };
    let digest = sha256_hex(
        &serde_json::to_vec(&json!([
            registry.execution_revision(&scope.scene_id, &scope.plugin_id),
            plugin.manifest,
            plugin.permission_grants,
            capability.input_schema,
            sha256_hex(&module)
        ]))
        .unwrap(),
    );
    Ok((digest, plugin.manifest.version))
}

pub(super) fn source_proof_from_module(
    registry: &PluginRegistry,
    request: &CapabilityInvokeRequest,
    module: &[u8],
) -> Result<(String, String), ApiError> {
    proof_module(registry, &scope_for(request), Some(module))
}

pub(super) fn source_proof(
    registry: &PluginRegistry,
    request: &CapabilityInvokeRequest,
) -> Result<(String, String), ApiError> {
    proof(registry, &scope_for(request))
}

fn scope_for(request: &CapabilityInvokeRequest) -> Scope {
    Scope {
        workspace_id: request.workspace_id.clone(),
        scene_id: request.scene_id.clone(),
        plugin_id: request.plugin_id.clone(),
        capability_id: request.capability_id.clone(),
    }
}

pub(super) fn capture(
    state: &HostState,
    registry: &PluginRegistry,
    request: &CapabilityInvokeRequest,
    expected: &(String, String),
    result: &Value,
) -> Result<Value, ApiError> {
    let scope = scope_for(request);
    if proof(registry, &scope)? != *expected {
        return Err(rejected("result_source_changed"));
    }
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    capture_with_declared_type(&mut store, registry, scope, expected, result)
}

fn capture_with_declared_type(
    store: &mut Store,
    registry: &PluginRegistry,
    scope: Scope,
    expected: &(String, String),
    result: &Value,
) -> Result<Value, ApiError> {
    let json_capture = registry
        .execution_plugin(&scope.scene_id, &scope.plugin_id)
        .filter(|plugin| plugin.enabled)
        .is_some_and(|plugin| {
            plugin.manifest.contributes["capabilities"]
                .as_array()
                .is_some_and(|items| {
                    items.iter().any(|item| {
                        item.get("id").and_then(Value::as_str)
                            == Some(scope.capability_id.as_str())
                            && item.get("resultCaptureMimeType").and_then(Value::as_str)
                                == Some("application/json")
                    })
                })
        });
    if json_capture {
        store.capture_json(scope, expected.0.clone(), expected.1.clone(), result)
    } else {
        store.capture(scope, expected.0.clone(), expected.1.clone(), result)
    }
}

pub(super) fn capture_model(
    state: &HostState,
    registry: &PluginRegistry,
    workspace_id: &str,
    scene_id: &str,
    plugin_id: &str,
    text: &str,
) -> Result<Value, ApiError> {
    let scope = Scope {
        workspace_id: workspace_id.to_owned(),
        scene_id: scene_id.to_owned(),
        plugin_id: plugin_id.to_owned(),
        capability_id: "model.generate.v1".into(),
    };
    let (proof, version) = proof(registry, &scope)?;
    state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?
        .capture(
            scope,
            proof,
            version,
            &json!({"ok":true,"data":{"text":text}}),
        )
}

pub(super) fn capture_service_http(
    state: &HostState,
    registry: &PluginRegistry,
    workspace_id: &str,
    scene_id: &str,
    plugin_id: &str,
    result: &Value,
) -> Result<Value, ApiError> {
    let scope = Scope {
        workspace_id: workspace_id.to_owned(),
        scene_id: scene_id.to_owned(),
        plugin_id: plugin_id.to_owned(),
        capability_id: "service.http.get.v1".into(),
    };
    let (proof, version) = proof(registry, &scope)?;
    let text = serde_json::to_string(result).map_err(|_| rejected("result_capture_unavailable"))?;
    state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?
        .capture(
            scope,
            proof,
            version,
            &json!({"ok":true,"data":{"text":text}}),
        )
}

fn authorize_save(registry: &PluginRegistry, scene: &str) -> Result<(), ApiError> {
    if !registry
        .execution_plugin(scene, "com.zicode.artifacts")
        .is_some_and(|plugin| {
            plugin.enabled && plugin.permission_grants.get("storage.plugin") == Some(&true)
        })
    {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "Artifacts storage is unavailable",
        ));
    }
    Ok(())
}

pub(super) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Prepare>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.title.trim().is_empty()
        || request.title.chars().count() > 200
        || request.title.chars().any(char::is_control)
    {
        return Err(rejected("result_title_invalid"));
    }
    let write_gate = state
        .workspace_write_gates
        .gate(&request.scope.workspace_id)
        .map_err(|_| rejected("result_store_unavailable"))?;
    let write_guard = write_gate
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    if *write_guard {
        return Err(rejected("result_workspace_closed"));
    }
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    authorize_save(&registry, &request.scope.scene_id)?;
    let current = proof(&registry, &request.scope)?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    let record = store.record(&request.scope, &request.result_id)?;
    if current.0 != record.proof {
        return Err(rejected("result_source_changed"));
    }
    let grant = store.prepare(record.id.clone(), request.title.clone())?;
    Ok(Json(
        json!({"schemaVersion":1,"grantId":grant,"expiresInSeconds":120,
        "preview":{"resultId":record.id,"title":request.title,"text":record.text,"mimeType":record.mime_type,
        "byteLength":record.text.len(),"contentVersion":sha256_hex(record.text.as_bytes()),"packageVersion":record.package_version,
        "operation":"create_new_artifact","workspaceId":record.scope.workspace_id,"sceneId":record.scope.scene_id}}),
    ))
}

pub(super) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Commit>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if !request.confirmed {
        return Err(rejected("result_confirmation_required"));
    }
    let write_gate = state
        .workspace_write_gates
        .gate(&request.scope.workspace_id)
        .map_err(|_| rejected("result_store_unavailable"))?;
    let write_guard = write_gate
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    if *write_guard {
        return Err(rejected("result_workspace_closed"));
    }
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    authorize_save(&registry, &request.scope.scene_id)?;
    let current = proof(&registry, &request.scope)?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    let result_id = store.grant(&request.grant_id)?.result_id.clone();
    let record = store.record(&request.scope, &result_id)?;
    if current.0 != record.proof {
        return Err(rejected("result_source_changed"));
    }
    let grant = store.grant(&request.grant_id)?;
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&request.scope.workspace_id)
        .map_err(artifacts_api_error)?;
    if let Some(artifact) = saved_by_grant(&scoped, &request.scope, &request.grant_id)? {
        grant.artifact = Some(artifact.clone());
        return Ok(Json(
            json!({"schemaVersion":1,"artifact":artifact,"replayed":true}),
        ));
    }
    if grant.artifact.is_some() {
        return Err(rejected("result_save_artifact_unavailable"));
    }
    let artifact=scoped.create(ArtifactDraft {
        workspace_id:request.scope.workspace_id,scene_id:request.scope.scene_id,plugin_id:request.scope.plugin_id,
        kind:"file".into(),title:grant.title.clone(),summary:String::new(),mime_type:record.mime_type.into(),
        provenance:json!({"resultId":record.id,"saveGrantDigest":sha256_hex(request.grant_id.as_bytes()),"capabilityId":request.scope.capability_id,"packageVersion":record.package_version,
            "sourceRevision":record.proof,"contentVersion":sha256_hex(record.text.as_bytes()),"toolVersion":null}),
        content:record.json_value.clone().unwrap_or_else(|| json!(record.text)),
    }).map_err(artifacts_api_error)?;
    grant.artifact = Some(artifact.clone());
    Ok(Json(
        json!({"schemaVersion":1,"artifact":artifact,"replayed":false}),
    ))
}

fn saved_by_grant(
    store: &ArtifactStore,
    scope: &Scope,
    grant_id: &str,
) -> Result<Option<ArtifactDocument>, ApiError> {
    let grant_digest = sha256_hex(grant_id.as_bytes());
    store
        .find_matching(&scope.scene_id, |item| {
            item.workspace_id == scope.workspace_id
                && item.kind == "file"
                && item.plugin_id == scope.plugin_id
                && item
                    .provenance
                    .get("saveGrantDigest")
                    .and_then(Value::as_str)
                    == Some(grant_digest.as_str())
                && item.provenance.get("capabilityId").and_then(Value::as_str)
                    == Some(scope.capability_id.as_str())
        })
        .map_err(artifacts_api_error)
}

/// Read-only recovery. An absent receipt means unknown, never proof that a write did not occur.
pub(super) async fn save_status(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<SaveStatus>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if uuid::Uuid::parse_str(&request.grant_id).is_err() {
        return Err(rejected("result_grant_unavailable"));
    }
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let scoped = artifacts
        .scoped(&request.scope.workspace_id)
        .map_err(artifacts_api_error)?;
    let found = saved_by_grant(&scoped, &request.scope, &request.grant_id)?;
    Ok(Json(match found {
        Some(artifact) => {
            json!({"schemaVersion":1,"status":"saved","artifactId":artifact.descriptor.id})
        }
        None => json!({"schemaVersion":1,"status":"unknown"}),
    }))
}

#[cfg(test)]
mod json_http_tests;
#[cfg(test)]
mod tests;

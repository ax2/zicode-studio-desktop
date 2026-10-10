//! Desktop-owned result snapshots and explicit, version-bound save grants.
mod store;
pub(super) mod module_snapshot;
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
    let capability = registry
        .capability(&scope.scene_id, &scope.plugin_id, &scope.capability_id)
        .ok_or_else(|| rejected("result_source_unavailable"))?;
    let plugin = registry
        .list(&scope.scene_id)
        .into_iter()
        .find(|p| p.manifest.id == scope.plugin_id && p.enabled)
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
    state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?
        .capture(scope, expected.0.clone(), expected.1.clone(), result)
}

fn authorize_save(registry: &PluginRegistry, scene: &str) -> Result<(), ApiError> {
    if !registry.list(scene).iter().any(|p| {
        p.manifest.id == "com.zicode.artifacts"
            && p.enabled
            && p.permission_grants.get("storage.plugin") == Some(&true)
    }) {
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
        "preview":{"resultId":record.id,"title":request.title,"text":record.text,"mimeType":"text/plain",
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
    if let Some(artifact) = &grant.artifact {
        return Ok(Json(
            json!({"schemaVersion":1,"artifact":artifact,"replayed":true}),
        ));
    }
    let artifacts = state
        .artifacts
        .lock()
        .map_err(|_| artifacts_unavailable())?;
    let artifact=artifacts.scoped(&request.scope.workspace_id).map_err(artifacts_api_error)?.create(ArtifactDraft {
        workspace_id:request.scope.workspace_id,scene_id:request.scope.scene_id,plugin_id:request.scope.plugin_id,
        kind:"file".into(),title:grant.title.clone(),summary:String::new(),mime_type:"text/plain".into(),
        provenance:json!({"resultId":record.id,"capabilityId":request.scope.capability_id,"packageVersion":record.package_version,
            "sourceRevision":record.proof,"contentVersion":sha256_hex(record.text.as_bytes()),"toolVersion":null}),
        content:json!(record.text),
    }).map_err(artifacts_api_error)?;
    grant.artifact = Some(artifact.clone());
    Ok(Json(
        json!({"schemaVersion":1,"artifact":artifact,"replayed":false}),
    ))
}

#[cfg(test)]
mod tests;

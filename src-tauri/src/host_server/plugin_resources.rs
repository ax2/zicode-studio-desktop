//! Candidate resource input grants. No filesystem access or WASI callback.
mod operations;
mod store;
mod authority;
pub(super) mod transfer;
pub(super) mod save;
mod save_files;
pub(super) mod library;
pub(super) mod worker;
pub(super) mod local_file;
pub(super) mod local_directory;
use super::*;
pub(crate) use operations::Operations;
use std::time::Instant;
pub(crate) use store::Store;
type ApiError = (StatusCode, Json<Value>);

const MAX_CHUNK: usize = 64 * 1024;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Owner {
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    capability_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Prepare {
    schema_version: u32,
    owner: Owner,
    mime_type: String,
    byte_length: usize,
    content_version: String,
    #[serde(default)]
    catalog_revision: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Access {
    schema_version: u32,
    owner: Owner,
    resource_id: String,
    content_version: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Append {
    access: Access,
    offset: usize,
    data_base64: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Commit {
    access: Access,
    confirmed: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Read {
    access: Access,
    offset: usize,
    length: usize,
}

fn rejected(code: &'static str) -> ApiError {
    plugin_api_error(StatusCode::CONFLICT, code, "Resource request rejected")
}

fn validate(access: &Access) -> Result<(), ApiError> {
    if access.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    if uuid::Uuid::parse_str(&access.resource_id).is_err() {
        return Err(rejected("resource_unavailable"));
    }
    Ok(())
}

fn desktop(state: &HostState, headers: &HeaderMap) -> Result<(), ApiError> {
    if !desktop_http_token_authorized(headers, &state.desktop_token) {
        return Err(plugin_api_error(StatusCode::FORBIDDEN, "desktop_only", ""));
    }
    Ok(())
}

fn identity(
    state: &HostState,
    owner: &Owner,
    expected_generation: Option<&str>,
) -> Result<String, ApiError> {
    identity_module(state, owner, expected_generation, None)
}

fn identity_module(
    state: &HostState,
    owner: &Owner,
    expected_generation: Option<&str>,
    module: Option<&[u8]>,
) -> Result<String, ApiError> {
    // Derive workspace and scene from a live Host runtime, never from caller fields.
    let target = state
        .runtimes
        .statuses()
        .map_err(|_| rejected("runtime_unavailable"))?
        .into_iter()
        .find(|s| {
            s.target.instance_id == owner.runtime_id && s.target.session_id == owner.session_id
        })
        .map(|s| s.target)
        .ok_or_else(|| rejected("runtime_stopped"))?;
    // A new Broker credential is a new grant generation, even for reused IDs.
    let record = state
        .plugin_tokens
        .lock()
        .map_err(|_| rejected("broker_auth_unavailable"))?
        .get(&owner.runtime_id)
        .cloned()
        .filter(|r| r.expires_at > SystemTime::now())
        .ok_or_else(|| rejected("broker_token_invalid"))?;
    if state.runtimes.broker_target(&record.target).as_ref() != Some(&target) {
        return Err(rejected("broker_token_invalid"));
    }
    let generation = record.token_hash;
    if expected_generation.is_some_and(|expected| expected != generation) {
        return Err(rejected("broker_token_invalid"));
    }
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let plugin = registry
        .list(&target.scene_id)
        .into_iter()
        .find(|p| p.manifest.id == owner.plugin_id && p.enabled)
        .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
    if plugin.permission_grants.get("resource.read") != Some(&true) {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "permission_denied",
            "",
        ));
    }
    let request = CapabilityInvokeRequest {
        workspace_id: target.workspace_id.clone(),
        scene_id: target.scene_id.clone(),
        plugin_id: owner.plugin_id.clone(),
        capability_id: owner.capability_id.clone(),
        input: Value::Null,
        capture_result: false,
        catalog_revision: None,
        call_id: None,
    };
    let proof = match module {
        Some(bytes) => plugin_results::source_proof_from_module(&registry, &request, bytes)?,
        None => plugin_results::source_proof(&registry, &request)?,
    }
    .0;
    Ok(sha256_hex(
        &serde_json::to_vec(&json!([target, generation, proof])).unwrap(),
    ))
}

async fn blocking<F>(state: Arc<HostState>, operation: F) -> Result<Json<Value>, ApiError>
where
    F: FnOnce() -> Result<Value, ApiError> + Send + 'static,
{
    state.plugin_resource_operations.run(operation).await
}

pub(super) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Prepare>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 {
        return Err(rejected("resource_schema_unsupported"));
    }
    blocking(state.clone(), move || {
        let proof = identity(&state, &request.owner, None)?;
        if let Some(revision) = &request.catalog_revision {
            if revision.len() != 64 { return Err(rejected("catalog_changed")); }
            let target = state.runtimes.statuses().map_err(|_| rejected("runtime_unavailable"))?
                .into_iter().find(|s| s.target.instance_id == request.owner.runtime_id && s.target.session_id == request.owner.session_id)
                .ok_or_else(|| rejected("runtime_stopped"))?.target;
            state.plugins.lock().map_err(|_| rejected("registry_unavailable"))?
                .manual_tool_detail(&crate::plugin_registry::manual_catalog::DetailQuery {
                    scene_id: target.scene_id, plugin_id: request.owner.plugin_id.clone(), capability_id: request.owner.capability_id.clone(), revision: revision.clone(),
                }).map_err(|_| rejected("catalog_changed"))?;
            if identity(&state, &request.owner, None)? != proof { return Err(rejected("resource_authorization_changed")); }
        }
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        store.prepare(request, proof)
    })
    .await
}

pub(super) async fn append(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Append>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request.access)?;
    if request.data_base64.len() > MAX_CHUNK.div_ceil(3) * 4 {
        return Err(rejected("resource_chunk_too_large"));
    }
    let data = base64::engine::general_purpose::STANDARD
        .decode(&request.data_base64)
        .map_err(|_| rejected("resource_chunk_invalid"))?;
    if data.len() > MAX_CHUNK || data.is_empty() {
        return Err(rejected("resource_chunk_invalid"));
    }
    blocking(state.clone(), move || {
        let proof = identity(&state, &request.access.owner, None)?;
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        store.append(&request.access, &proof, request.offset, data)
    })
    .await
}

pub(super) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Commit>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request.access)?;
    if !request.confirmed {
        return Err(rejected("resource_confirmation_required"));
    }
    // Hashing a full resource must not occupy an async HTTP execution thread.
    blocking(state.clone(), move || {
        let proof = identity(&state, &request.access.owner, None)?;
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        store.commit(&request.access, &proof)
    })
    .await
}

pub(super) async fn read(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Read>,
) -> Result<Json<Value>, ApiError> {
    validate(&request.access)?;
    if request.length == 0 || request.length > MAX_CHUNK {
        return Err(rejected("resource_chunk_too_large"));
    }
    blocking(state.clone(), move || {
        let authorized = plugin_tool_auth::authorize(
            &state,
            &headers,
            &request.access.owner.runtime_id,
            &request.access.owner.session_id,
        )?;
        let proof = authority::identity_access(&state, &request.access, Some(&authorized.token_hash), None)?;
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        store.read(&request.access, &proof, request.offset, request.length)
    })
    .await
}

pub(super) async fn revoke(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Access>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request)?;
    // Revocation still works after runtime stop/permission removal.
    blocking(state.clone(), move || {
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        store.revoke(&request)?;
        Ok(json!({"schemaVersion":1,"revoked":true}))
    })
    .await
}

// Trusted desktop parent only; the isolated View never receives a Host token.
pub(super) async fn read_view(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Read>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    validate(&request.access)?;
    if request.length == 0 || request.length > 32 * 1024 {
        return Err(rejected("resource_chunk_too_large"));
    }
    blocking(state.clone(), move || {
        let proof = authority::identity_access(&state, &request.access, None, None)?;
        let mut store = state
            .plugin_resources
            .lock()
            .map_err(|_| rejected("resource_store_unavailable"))?;
        store.read(&request.access, &proof, request.offset, request.length)
    })
    .await
}

#[cfg(test)]
mod tests;

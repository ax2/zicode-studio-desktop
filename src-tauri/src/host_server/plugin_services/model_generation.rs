//! One-shot desktop approval for a plugin model request. This preview does not
//! expose model credentials, endpoints or a general service.v1 transport.
use super::*;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const MAX_GOAL_BYTES: usize = 2_048;
const MAX_MATERIAL_BYTES: usize = 32_768;
const MAX_RESULT_BYTES: usize = 24_576;
const MAX_DEADLINE_MS: u64 = 120_000;
const GRANT_TTL: Duration = Duration::from_secs(120);
const MAX_GRANTS: usize = 8;
const MAX_OPERATIONS: usize = 8;
const OPERATION_TTL: Duration = Duration::from_secs(240);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareRequest {
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    model_ref: String,
    goal: String,
    materials: Vec<Material>,
    max_output_tokens: u32,
    deadline_ms: u64,
    #[serde(default)]
    operation_id: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Material {
    source_id: String,
    display_name: String,
    source_kind: String,
    trust: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct CommitRequest {
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    grant_id: String,
    confirmed: bool,
    #[serde(default)]
    operation_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct CancelRequest {
    schema_version: u32,
    workspace_id: String,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    operation_id: String,
}

struct Grant {
    owner: (String, String, String),
    workspace_id: String,
    scene: String,
    model_ref: String,
    endpoint: crate::model_tools::ModelEndpoint,
    prompt: String,
    max_output_tokens: u32,
    deadline: Duration,
    expires: Instant,
    revision: u64,
    generation: u64,
    operation_id: Option<String>,
}

struct Operation {
    owner: (String, String, String),
    workspace_id: String,
    cancellation: tokio_util::sync::CancellationToken,
    started: bool,
    finished: bool,
    expires: Instant,
}

#[derive(Default)]
pub(in crate::host_server) struct Grants {
    pending: HashMap<String, Grant>,
    operations: HashMap<String, Operation>,
    plugin_revisions: HashMap<String, u64>,
    generation: u64,
}

impl Grants {
    pub(in crate::host_server) fn invalidate_workspace(&mut self, workspace_id: &str) {
        self.pending
            .retain(|_, grant| grant.workspace_id != workspace_id);
        for operation in self.operations.values_mut() {
            if operation.workspace_id == workspace_id {
                operation.cancellation.cancel();
                if !operation.started {
                    operation.finished = true;
                    operation.expires = Instant::now() + Duration::from_secs(60);
                }
            }
        }
    }

    pub(in crate::host_server) fn invalidate(&mut self) {
        self.pending.clear();
        for operation in self.operations.values_mut() {
            operation.cancellation.cancel();
            if !operation.started {
                operation.finished = true;
                operation.expires = Instant::now() + Duration::from_secs(60);
            }
        }
        self.generation = self.generation.wrapping_add(1);
    }

    pub(in crate::host_server) fn invalidate_plugin(&mut self, plugin_id: &str) {
        self.pending.retain(|_, grant| grant.owner.0 != plugin_id);
        for operation in self.operations.values_mut() {
            if operation.owner.0 == plugin_id {
                operation.cancellation.cancel();
                if !operation.started {
                    operation.finished = true;
                    operation.expires = Instant::now() + Duration::from_secs(60);
                }
            }
        }
        let revision = self
            .plugin_revisions
            .entry(plugin_id.to_owned())
            .or_default();
        *revision = revision.wrapping_add(1);
    }

    fn version_for(&self, plugin_id: &str) -> (u64, u64) {
        (
            self.plugin_revisions
                .get(plugin_id)
                .copied()
                .unwrap_or_default(),
            self.generation,
        )
    }

    fn start_operation(
        &mut self,
        operation_id: &str,
        owner: &(String, String, String),
        workspace_id: &str,
    ) -> Result<tokio_util::sync::CancellationToken, ApiError> {
        let now = Instant::now();
        self.operations.retain(|_, operation| {
            if operation.expires <= now {
                operation.cancellation.cancel();
                false
            } else {
                true
            }
        });
        if self.operations.contains_key(operation_id) {
            return Err(denied(StatusCode::CONFLICT, "model_operation_unavailable"));
        }
        if self.operations.len() >= MAX_OPERATIONS {
            return Err(denied(
                StatusCode::TOO_MANY_REQUESTS,
                "model_operations_busy",
            ));
        }
        let cancellation = tokio_util::sync::CancellationToken::new();
        self.operations.insert(
            operation_id.to_string(),
            Operation {
                owner: owner.clone(),
                workspace_id: workspace_id.to_string(),
                cancellation: cancellation.clone(),
                started: false,
                finished: false,
                expires: Instant::now() + OPERATION_TTL,
            },
        );
        Ok(cancellation)
    }

    fn cancel_operation(
        &mut self,
        operation_id: &str,
        owner: &(String, String, String),
        workspace_id: &str,
    ) -> Result<bool, ApiError> {
        let operation = self
            .operations
            .get_mut(operation_id)
            .filter(|operation| operation.owner == *owner && operation.workspace_id == workspace_id)
            .ok_or_else(|| denied(StatusCode::CONFLICT, "model_operation_unavailable"))?;
        if operation.finished {
            return Ok(false);
        }
        operation.cancellation.cancel();
        Ok(true)
    }

    fn operation_token(
        &mut self,
        operation_id: &str,
        owner: &(String, String, String),
        workspace_id: &str,
    ) -> Result<tokio_util::sync::CancellationToken, ApiError> {
        let operation = self
            .operations
            .get_mut(operation_id)
            .filter(|operation| operation.owner == *owner && operation.workspace_id == workspace_id)
            .ok_or_else(|| denied(StatusCode::CONFLICT, "model_operation_unavailable"))?;
        if !operation.finished {
            operation.started = true;
            operation.expires = Instant::now() + Duration::from_secs(150);
        }
        Ok(operation.cancellation.clone())
    }

    fn finish_operation(&mut self, operation_id: &str) {
        if let Some(operation) = self.operations.get_mut(operation_id) {
            operation.finished = true;
            operation.expires = Instant::now() + Duration::from_secs(60);
        }
    }
}

fn denied(status: StatusCode, code: &'static str) -> ApiError {
    plugin_api_error(status, code, "Model generation request rejected")
}

fn active_scene(state: &HostState, owner: &(String, String, String)) -> Result<String, ApiError> {
    let target = state
        .runtimes
        .statuses()
        .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "runtime_unavailable"))?
        .into_iter()
        .find(|status| status.target.instance_id == owner.1 && status.target.session_id == owner.2)
        .map(|status| status.target)
        .ok_or_else(|| denied(StatusCode::CONFLICT, "runtime_stopped"))?;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable"))?;
    let plugin = registry
        .execution_plugin(&target.scene_id, &owner.0)
        .filter(|plugin| plugin.enabled)
        .ok_or_else(|| denied(StatusCode::CONFLICT, "service_plugin_unavailable"))?;
    if plugin
        .manifest
        .required_profiles
        .get("model.generate.v1")
        .is_none()
    {
        return Err(denied(
            StatusCode::CONFLICT,
            "model_generation_profile_required",
        ));
    }
    if plugin.permission_grants.get("model.generate") != Some(&true)
        || plugin.permission_grants.get("model.catalog.read") != Some(&true)
    {
        return Err(denied(StatusCode::FORBIDDEN, "permission_denied"));
    }
    Ok(target.scene_id)
}

fn prompt(goal: &str, materials: &[Material]) -> Result<String, ApiError> {
    if goal.trim().is_empty() || goal.len() > MAX_GOAL_BYTES || materials.len() > 32 {
        return Err(denied(StatusCode::BAD_REQUEST, "model_input_invalid"));
    }
    let mut total = 0usize;
    for material in materials {
        total = total.saturating_add(material.text.len());
        if total > MAX_MATERIAL_BYTES
            || material.source_id.is_empty()
            || material.source_id.len() > 128
            || material.display_name.is_empty()
            || material.display_name.len() > 128
            || !matches!(
                material.source_kind.as_str(),
                "user_text" | "tool_handoff" | "clipboard_text" | "explicit_file_selection"
            )
            || !matches!(
                material.trust.as_str(),
                "user_authored" | "tool_output" | "untrusted_user_material"
            )
        {
            return Err(denied(StatusCode::BAD_REQUEST, "model_input_invalid"));
        }
    }
    serde_json::to_string(&json!({"goal":goal,"materials":materials}))
        .map_err(|_| denied(StatusCode::BAD_REQUEST, "model_input_invalid"))
}

pub(in crate::host_server) async fn prepare_generation(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PrepareRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(denied(StatusCode::FORBIDDEN, "desktop_only"));
    }
    if request.schema_version != 1
        || request.workspace_id.len() > 64
        || uuid::Uuid::parse_str(&request.workspace_id).is_err()
        || !request.model_ref.starts_with("model-")
        || request.model_ref.len() > 128
        || !(1..=4096).contains(&request.max_output_tokens)
        || !(1_000..=MAX_DEADLINE_MS).contains(&request.deadline_ms)
        || request
            .operation_id
            .as_deref()
            .is_some_and(|id| uuid::Uuid::parse_str(id).is_err())
    {
        return Err(denied(StatusCode::BAD_REQUEST, "model_input_invalid"));
    }
    let prompt = prompt(&request.goal, &request.materials)?;
    state
        .data
        .workspace_root_path(&request.workspace_id)
        .map_err(|_| denied(StatusCode::CONFLICT, "model_workspace_unavailable"))?;
    let owner = (request.plugin_id, request.runtime_id, request.session_id);
    let scene = active_scene(&state, &owner)?;
    let root = crate::app_paths::system_root()
        .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_config_unavailable"))?;
    let secret = state.desktop_token.clone();
    let scene_for_worker = scene.clone();
    let owner_for_worker = owner.clone();
    let model_ref_for_worker = request.model_ref.clone();
    let endpoint = tokio::task::spawn_blocking(move || {
        let choices = crate::model_tools::catalog(&root, &scene_for_worker)?;
        let mut matches = choices.iter().filter(|choice| {
            super::model_ref(choice, &secret, &scene_for_worker, &owner_for_worker)
                == model_ref_for_worker
        });
        let choice = matches.next().ok_or("model_selection_unavailable")?;
        if matches.next().is_some() {
            return Err("model_selection_ambiguous".into());
        }
        crate::model_tools::resolve(
            &root,
            &scene_for_worker,
            Some(&choice.provider),
            Some(&choice.model),
        )
    })
    .await
    .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_worker_unavailable"))?
    .map_err(|_| denied(StatusCode::CONFLICT, "model_selection_unavailable"))?;
    let display_name: String = endpoint.choice.name.trim().chars().take(128).collect();
    let destination = endpoint.choice.endpoint.clone();
    let material_count = request.materials.len();
    let input_bytes = request.goal.len()
        + request
            .materials
            .iter()
            .map(|item| item.text.len())
            .sum::<usize>();
    let grant_id = uuid::Uuid::new_v4().to_string();
    let prompt_preview = prompt.clone();
    {
        let mut grants = state
            .model_generation_grants
            .lock()
            .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?;
        grants
            .pending
            .retain(|_, grant| grant.expires > Instant::now());
        if grants.pending.len() >= MAX_GRANTS {
            return Err(denied(StatusCode::TOO_MANY_REQUESTS, "model_grants_busy"));
        }
        if let Some(operation_id) = request.operation_id.as_deref() {
            grants.start_operation(operation_id, &owner, &request.workspace_id)?;
        }
        let (revision, generation) = grants.version_for(&owner.0);
        grants.pending.insert(
            grant_id.clone(),
            Grant {
                owner,
                workspace_id: request.workspace_id,
                scene,
                model_ref: request.model_ref,
                endpoint,
                prompt,
                max_output_tokens: request.max_output_tokens,
                deadline: Duration::from_millis(request.deadline_ms),
                expires: Instant::now() + GRANT_TTL,
                revision,
                generation,
                operation_id: request.operation_id.clone(),
            },
        );
    }
    Ok(Json(
        json!({"schemaVersion":1,"grantId":grant_id,"displayName":display_name,
        "destination":destination,"materialCount":material_count,"inputBytes":input_bytes,
        "promptPreview":prompt_preview,
        "expiresInMs":GRANT_TTL.as_millis(),"operationId":request.operation_id}),
    ))
}

pub(in crate::host_server) async fn cancel_generation(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CancelRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(denied(StatusCode::FORBIDDEN, "desktop_only"));
    }
    if request.schema_version != 1
        || uuid::Uuid::parse_str(&request.workspace_id).is_err()
        || uuid::Uuid::parse_str(&request.operation_id).is_err()
    {
        return Err(denied(StatusCode::BAD_REQUEST, "model_operation_invalid"));
    }
    let owner = (request.plugin_id, request.runtime_id, request.session_id);
    let requested = state
        .model_generation_grants
        .lock()
        .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
        .cancel_operation(&request.operation_id, &owner, &request.workspace_id)?;
    Ok(Json(json!({
        "schemaVersion":1,
        "operation":"model.generate.cancel",
        "status":if requested {"requested"} else {"finished"},
        "executionFinished":!requested,
    })))
}

pub(in crate::host_server) async fn commit_generation(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CommitRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(denied(StatusCode::FORBIDDEN, "desktop_only"));
    }
    if request.schema_version != 1 {
        return Err(denied(
            StatusCode::BAD_REQUEST,
            "model_confirmation_required",
        ));
    }
    let owner = (request.plugin_id, request.runtime_id, request.session_id);
    let grant = {
        let mut grants = state
            .model_generation_grants
            .lock()
            .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?;
        let grant = grants
            .pending
            .remove(&request.grant_id)
            .ok_or_else(|| denied(StatusCode::CONFLICT, "model_grant_unavailable"))?;
        if grants.version_for(&owner.0) != (grant.revision, grant.generation) {
            return Err(denied(StatusCode::CONFLICT, "model_authorization_changed"));
        }
        grant
    };
    if !request.confirmed {
        if let Some(operation_id) = grant.operation_id.as_deref() {
            state
                .model_generation_grants
                .lock()
                .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
                .finish_operation(operation_id);
        }
        return Err(denied(
            StatusCode::BAD_REQUEST,
            "model_confirmation_required",
        ));
    }
    if grant.operation_id != request.operation_id {
        if let Some(operation_id) = grant.operation_id.as_deref() {
            state
                .model_generation_grants
                .lock()
                .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
                .finish_operation(operation_id);
        }
        return Err(denied(StatusCode::CONFLICT, "model_operation_unavailable"));
    }
    if grant.owner != owner
        || grant.workspace_id != request.workspace_id
        || grant.expires <= Instant::now()
        || active_scene(&state, &owner)? != grant.scene
    {
        return Err(denied(StatusCode::CONFLICT, "model_grant_unavailable"));
    }
    let scene = grant.scene.clone();
    let expected_scene = scene.clone();
    let expected_version = (grant.revision, grant.generation);
    let plugin = owner.0.clone();
    let model_ref = grant.model_ref.clone();
    let operation_id = grant.operation_id.clone();
    let scene_for_request = scene.clone();
    let cancellation = if let Some(operation_id) = operation_id.as_deref() {
        state
            .model_generation_grants
            .lock()
            .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
            .operation_token(operation_id, &owner, &request.workspace_id)?
    } else {
        tokio_util::sync::CancellationToken::new()
    };
    let generation_result = async move {
        let endpoint_for_credential = grant.endpoint.choice.provider.clone();
        let scene_for_credential = scene_for_request.clone();
        let requires_key = grant.endpoint.choice.requires_key;
        let key = if requires_key {
            tokio::task::spawn_blocking(move || {
                crate::credential_broker::model_tool_credential(
                    &scene_for_credential,
                    &endpoint_for_credential,
                )
            })
            .await
            .map_err(|_| "model_credential_unavailable")??
        } else {
            None
        };
        let payload = crate::model_tools::complete_limited_cancellable(
            &grant.endpoint,
            key.as_deref(),
            grant.prompt,
            grant.deadline,
            grant.max_output_tokens,
            cancellation,
        )
        .await?;
        let text = crate::translation::extract_text(&payload).ok_or("model_response_invalid")?;
        if text.len() > MAX_RESULT_BYTES {
            return Err("model_response_too_large".into());
        }
        Ok::<_, String>(text)
    }
    .await;
    if let Some(operation_id) = operation_id.as_deref() {
        state
            .model_generation_grants
            .lock()
            .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
            .finish_operation(operation_id);
    }
    let result = generation_result.map_err(|error| {
        if error == "model_request_cancelled" {
            denied(StatusCode::CONFLICT, "model_request_cancelled")
        } else {
            denied(StatusCode::BAD_GATEWAY, "model_request_failed")
        }
    })?;
    if active_scene(&state, &owner)? != expected_scene {
        return Err(denied(StatusCode::CONFLICT, "model_authorization_changed"));
    }
    if state
        .model_generation_grants
        .lock()
        .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
        .version_for(&owner.0)
        != expected_version
    {
        return Err(denied(StatusCode::CONFLICT, "model_authorization_changed"));
    }
    log::info!("[plugin-services] model generation completed for plugin {plugin}");
    let result_ref = {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable"))?;
        crate::host_server::plugin_results::capture_model(
            &state,
            &registry,
            &request.workspace_id,
            &scene,
            &owner.0,
            &result,
        )
        .ok()
    };
    let mut response = json!({"schemaVersion":1,"operation":"model.generate",
        "result":{"modelRef":model_ref,"text":result}});
    match result_ref {
        Some(reference) => response["resultRef"] = reference,
        None => response["resultCaptureError"] = json!({"code":"result_capture_unavailable"}),
    }
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompt_rejects_oversize_and_invalid_source_labels() {
        assert!(prompt("", &[]).is_err());
        assert!(prompt(&"x".repeat(MAX_GOAL_BYTES + 1), &[]).is_err());
        let material = Material {
            source_id: "one".into(),
            display_name: "Text".into(),
            source_kind: "user_text".into(),
            trust: "user_authored".into(),
            text: "hello".into(),
        };
        let valid = prompt("Summarize", &[material]).unwrap();
        assert!(valid.contains("hello"));
        let spoofed = Material {
            source_id: "two".into(),
            display_name: "File".into(),
            source_kind: "arbitrary_path".into(),
            trust: "user_authored".into(),
            text: "hello".into(),
        };
        assert!(prompt("Summarize", &[spoofed]).is_err());
    }

    #[test]
    fn invalidation_advances_authorization_revision() {
        let mut grants = Grants::default();
        let operation_id = uuid::Uuid::new_v4().to_string();
        let owner = ("plugin".into(), "runtime".into(), "session".into());
        let cancellation = grants
            .start_operation(&operation_id, &owner, "workspace")
            .unwrap();
        let before = grants.version_for(&owner.0);
        grants.invalidate();
        assert_ne!(grants.version_for(&owner.0), before);
        assert!(grants.pending.is_empty());
        assert!(cancellation.is_cancelled());
    }

    #[test]
    fn invalidating_one_plugin_preserves_other_model_operations() {
        let mut grants = Grants::default();
        let plugin_a = ("plugin-a".into(), "runtime-a".into(), "session-a".into());
        let plugin_b = ("plugin-b".into(), "runtime-b".into(), "session-b".into());
        let operation_a = uuid::Uuid::new_v4().to_string();
        let operation_b = uuid::Uuid::new_v4().to_string();
        let token_a = grants
            .start_operation(&operation_a, &plugin_a, "workspace")
            .unwrap();
        let token_b = grants
            .start_operation(&operation_b, &plugin_b, "workspace")
            .unwrap();
        let version_b = grants.version_for(&plugin_b.0);

        grants.invalidate_plugin(&plugin_a.0);

        assert!(token_a.is_cancelled());
        assert!(!token_b.is_cancelled());
        assert!(grants.version_for(&plugin_a.0) != grants.version_for("unrelated"));
        assert_eq!(grants.version_for(&plugin_b.0), version_b);
        let retained = grants
            .operation_token(&operation_b, &plugin_b, "workspace")
            .unwrap();
        assert!(!retained.is_cancelled());
        assert!(grants
            .cancel_operation(&operation_b, &plugin_b, "workspace")
            .unwrap());
    }

    #[test]
    fn closing_one_workspace_cancels_only_its_model_operation() {
        let mut grants = Grants::default();
        let first = ("plugin".into(), "runtime-a".into(), "session-a".into());
        let other = ("plugin".into(), "runtime-b".into(), "session-b".into());
        let first_id = uuid::Uuid::new_v4().to_string();
        let other_id = uuid::Uuid::new_v4().to_string();
        let first_token = grants
            .start_operation(&first_id, &first, "workspace-a")
            .unwrap();
        let other_token = grants
            .start_operation(&other_id, &other, "workspace-b")
            .unwrap();

        grants.invalidate_workspace("workspace-a");

        assert!(first_token.is_cancelled());
        assert!(!other_token.is_cancelled());
        assert!(grants
            .operation_token(&other_id, &other, "workspace-b")
            .is_ok());
    }

    #[test]
    fn model_operation_cancellation_is_owner_bound_and_keeps_terminal_state() {
        let mut grants = Grants::default();
        let owner = ("plugin".into(), "runtime".into(), "session".into());
        let operation_id = uuid::Uuid::new_v4().to_string();
        let token = grants
            .start_operation(&operation_id, &owner, "workspace")
            .unwrap();
        assert!(grants
            .cancel_operation(&operation_id, &owner, "another-workspace")
            .is_err());
        assert!(!token.is_cancelled());
        assert!(grants
            .cancel_operation(&operation_id, &owner, "workspace")
            .unwrap());
        assert!(token.is_cancelled());
        grants.finish_operation(&operation_id);
        assert!(!grants
            .cancel_operation(&operation_id, &owner, "workspace")
            .unwrap());
        assert!(grants
            .cancel_operation(
                &operation_id,
                &("other".into(), "runtime".into(), "session".into()),
                "workspace"
            )
            .is_err());
    }
}

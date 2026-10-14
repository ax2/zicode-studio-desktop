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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareRequest {
    schema_version: u32,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    model_ref: String,
    goal: String,
    materials: Vec<Material>,
    max_output_tokens: u32,
    deadline_ms: u64,
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
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    grant_id: String,
    confirmed: bool,
}

struct Grant {
    owner: (String, String, String),
    scene: String,
    model_ref: String,
    endpoint: crate::model_tools::ModelEndpoint,
    prompt: String,
    max_output_tokens: u32,
    deadline: Duration,
    expires: Instant,
    revision: u64,
}

#[derive(Default)]
pub(in crate::host_server) struct Grants {
    pending: HashMap<String, Grant>,
    revision: u64,
}

impl Grants {
    pub(in crate::host_server) fn invalidate(&mut self) {
        self.pending.clear();
        self.revision = self.revision.wrapping_add(1);
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
        .list(&target.scene_id)
        .into_iter()
        .find(|plugin| plugin.enabled && plugin.manifest.id == owner.0)
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
        || !request.model_ref.starts_with("model-")
        || request.model_ref.len() > 128
        || !(1..=4096).contains(&request.max_output_tokens)
        || !(1_000..=MAX_DEADLINE_MS).contains(&request.deadline_ms)
    {
        return Err(denied(StatusCode::BAD_REQUEST, "model_input_invalid"));
    }
    let prompt = prompt(&request.goal, &request.materials)?;
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
        let revision = grants.revision;
        grants.pending.insert(
            grant_id.clone(),
            Grant {
                owner,
                scene,
                model_ref: request.model_ref,
                endpoint,
                prompt,
                max_output_tokens: request.max_output_tokens,
                deadline: Duration::from_millis(request.deadline_ms),
                expires: Instant::now() + GRANT_TTL,
                revision,
            },
        );
    }
    Ok(Json(
        json!({"schemaVersion":1,"grantId":grant_id,"displayName":display_name,
        "destination":destination,"materialCount":material_count,"inputBytes":input_bytes,
        "promptPreview":prompt_preview,
        "expiresInMs":GRANT_TTL.as_millis()}),
    ))
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
        if grant.revision != grants.revision {
            return Err(denied(StatusCode::CONFLICT, "model_authorization_changed"));
        }
        grant
    };
    if !request.confirmed {
        return Err(denied(
            StatusCode::BAD_REQUEST,
            "model_confirmation_required",
        ));
    }
    if grant.owner != owner
        || grant.expires <= Instant::now()
        || active_scene(&state, &owner)? != grant.scene
    {
        return Err(denied(StatusCode::CONFLICT, "model_grant_unavailable"));
    }
    let scene = grant.scene.clone();
    let expected_scene = scene.clone();
    let expected_revision = grant.revision;
    let plugin = owner.0.clone();
    let model_ref = grant.model_ref.clone();
    let result = tokio::task::spawn_blocking(move || {
        let key = if grant.endpoint.choice.requires_key {
            crate::credential_broker::model_tool_credential(
                &scene,
                &grant.endpoint.choice.provider,
            )?
        } else {
            None
        };
        let payload = crate::model_tools::complete_limited(
            &grant.endpoint,
            key.as_deref(),
            grant.prompt,
            grant.deadline,
            grant.max_output_tokens,
        )?;
        let text = crate::translation::extract_text(&payload).ok_or("model_response_invalid")?;
        if text.len() > MAX_RESULT_BYTES {
            return Err("model_response_too_large".into());
        }
        Ok::<_, String>(text)
    })
    .await
    .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_worker_unavailable"))?
    .map_err(|_| denied(StatusCode::BAD_GATEWAY, "model_request_failed"))?;
    if active_scene(&state, &owner)? != expected_scene {
        return Err(denied(StatusCode::CONFLICT, "model_authorization_changed"));
    }
    if state
        .model_generation_grants
        .lock()
        .map_err(|_| denied(StatusCode::SERVICE_UNAVAILABLE, "model_grants_unavailable"))?
        .revision
        != expected_revision
    {
        return Err(denied(StatusCode::CONFLICT, "model_authorization_changed"));
    }
    log::info!("[plugin-services] model generation completed for plugin {plugin}");
    Ok(Json(json!({"schemaVersion":1,"operation":"model.generate",
        "result":{"modelRef":model_ref,"text":result}})))
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
        let before = grants.revision;
        grants.invalidate();
        assert_ne!(grants.revision, before);
        assert!(grants.pending.is_empty());
    }
}

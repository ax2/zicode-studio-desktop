//! Read-only service discovery for authenticated desktop plugin views.
//! This is a narrow negotiated preview, not the proposed service.v1 profile.
mod model_generation;
pub(super) use model_generation::{commit_generation, prepare_generation, Grants};
use super::*;
use base64::Engine;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type ApiError = (StatusCode, Json<Value>);
const MAX_MODELS: usize = 128;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ModelListRequest {
    schema_version: u32,
    runtime_id: String,
    session_id: String,
    plugin_id: String,
    #[serde(default)]
    cursor: Option<String>,
}

fn rejected(status: StatusCode, code: &'static str) -> ApiError {
    plugin_api_error(status, code, "Model catalog request rejected")
}

pub(super) async fn models(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<ModelListRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(rejected(StatusCode::FORBIDDEN, "desktop_only"));
    }
    if request.schema_version != 1 {
        return Err(rejected(
            StatusCode::BAD_REQUEST,
            "service_schema_unsupported",
        ));
    }
    let offset = request
        .cursor
        .as_deref()
        .map(|cursor| cursor.parse::<usize>())
        .transpose()
        .map_err(|_| rejected(StatusCode::BAD_REQUEST, "model_cursor_invalid"))?
        .unwrap_or(0);
    if offset > 4096 {
        return Err(rejected(StatusCode::BAD_REQUEST, "model_cursor_invalid"));
    }
    let target = state
        .runtimes
        .statuses()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "runtime_unavailable"))?
        .into_iter()
        .find(|status| {
            status.target.instance_id == request.runtime_id
                && status.target.session_id == request.session_id
        })
        .map(|status| status.target)
        .ok_or_else(|| rejected(StatusCode::CONFLICT, "runtime_stopped"))?;
    {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable"))?;
        let plugin = registry
            .list(&target.scene_id)
            .into_iter()
            .find(|plugin| plugin.enabled && plugin.manifest.id == request.plugin_id)
            .ok_or_else(|| rejected(StatusCode::CONFLICT, "service_plugin_unavailable"))?;
        if plugin
            .manifest
            .required_profiles
            .get("model.catalog.read.v1")
            .is_none()
        {
            return Err(rejected(
                StatusCode::CONFLICT,
                "model_catalog_profile_required",
            ));
        }
        if plugin.permission_grants.get("model.catalog.read") != Some(&true) {
            return Err(rejected(StatusCode::FORBIDDEN, "permission_denied"));
        }
    }
    let root = crate::app_paths::system_root()
        .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "model_config_unavailable"))?;
    let scene = target.scene_id;
    let secret = state.desktop_token.clone();
    let owner = (request.plugin_id, request.runtime_id, request.session_id);
    let choices = tokio::task::spawn_blocking(move || {
        let choices = crate::model_tools::catalog(&root, &scene)?;
        Ok::<_, String>(project_models(&choices, &secret, &scene, &owner, offset))
    })
    .await
    .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "model_worker_unavailable"))?
    .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "model_config_unavailable"))?;
    Ok(Json(
        json!({"schemaVersion":1,"operation":"models.list","result":choices}),
    ))
}

fn project_models(
    choices: &[crate::model_tools::ModelChoice],
    secret: &str,
    scene: &str,
    owner: &(String, String, String),
    offset: usize,
) -> Value {
    let models: Vec<Value> = choices
        .iter()
        .skip(offset)
        .take(MAX_MODELS)
        .map(|choice| {
            let model_ref = model_ref(choice, secret, scene, owner);
            let display_name: String = choice.name.trim().chars().take(128).collect();
            json!({"modelRef":model_ref,"displayName":if display_name.is_empty() { "Model" } else { &display_name },
                "providerKind":"host_managed","supportsCancellation":false})
        })
        .collect();
    let mut result = json!({"models":models});
    if offset + MAX_MODELS < choices.len() {
        result["nextCursor"] = json!((offset + MAX_MODELS).to_string());
    }
    result
}

fn model_ref(
    choice: &crate::model_tools::ModelChoice,
    secret: &str,
    scene: &str,
    owner: &(String, String, String),
) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC key");
    mac.update(
        &serde_json::to_vec(&(scene, owner, &choice.provider, &choice.model, &choice.endpoint))
            .expect("model identity"),
    );
    format!(
        "model-{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_list_request_rejects_plugin_supplied_scope_fields() {
        let request = json!({"schemaVersion":1,"runtimeId":"r","sessionId":"s","pluginId":"p"});
        assert!(serde_json::from_value::<ModelListRequest>(request.clone()).is_ok());
        for field in ["sceneId", "workspaceId", "model", "provider"] {
            let mut spoofed = request.clone();
            spoofed[field] = json!("spoofed");
            assert!(serde_json::from_value::<ModelListRequest>(spoofed).is_err());
        }
    }

    #[test]
    fn model_projection_hides_connection_and_credentials() {
        let choices = vec![crate::model_tools::ModelChoice {
            provider: "private-provider".into(),
            model: "private-model".into(),
            name: "Visible model".into(),
            endpoint: "https://private.example".into(),
            requires_key: true,
        }];
        let owner = ("plugin".into(), "runtime".into(), "session".into());
        let result = project_models(&choices, "secret", "programming", &owner, 0);
        let text = result.to_string();
        assert!(!text.contains("private-provider"));
        assert!(!text.contains("private-model"));
        assert!(!text.contains("private.example"));
        assert_eq!(result["models"][0]["displayName"], "Visible model");
        assert_eq!(result["models"][0]["supportsCancellation"], false);
        assert_eq!(
            result,
            project_models(&choices, "secret", "programming", &owner, 0)
        );
        assert_ne!(
            result,
            project_models(&choices, "other", "programming", &owner, 0)
        );
    }

    #[tokio::test]
    async fn http_catalog_requires_live_scope_profile_and_grant() {
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("model-service-{}", uuid::Uuid::new_v4()));
        let public = root.join("public");
        let package = root.join("provider");
        std::fs::create_dir_all(&public).unwrap();
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(root.join("owner.json"), r#"{"purpose":"Studio model catalog HTTP boundary","lifetime":"remove on success, retain on failure"}"#).unwrap();
        std::fs::write(public.join("index.html"), "test").unwrap();
        std::fs::write(package.join("plugin.json"), serde_json::to_vec(&json!({
            "schemaVersion":2,"id":"com.example.model-catalog","name":"Model catalog fixture",
            "description":"Studio-owned read-only service fixture","version":"0.1.0","publisher":"test",
            "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
            "requiredProfiles":{"model.catalog.read.v1":"=1.0.0-preview.1"},
            "contributes":{"commands":[{"id":"fixture.open","title":"Open"}]},
            "permissions":{"optional":[{"name":"model.catalog.read","reason":"List scene models"}]}
        })).unwrap()).unwrap();
        let metadata =
            crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(16);
        let target = RuntimeTarget::new(
            "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "model-service-session",
            "model-service-runtime",
        );
        let _runtime = runtimes.register_in_memory(target.clone()).unwrap();
        let host = HostServer::start_with_mode(
            public,
            runtimes,
            auth,
            HashMap::new(),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry.install_developer(&package).unwrap();
            registry
                .set_enabled("programming", "com.example.model-catalog", true)
                .unwrap();
        }
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("{}/v2/plugin-services/models", host.origin());
        let request = json!({"schemaVersion":1,"runtimeId":target.instance_id,
            "sessionId":target.session_id,"pluginId":"com.example.model-catalog"});
        let denied = client.post(&url).json(&request).send().await.unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        let token = host.state.desktop_token.clone();
        let denied = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(denied.status(), StatusCode::FORBIDDEN);
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry
                .set_permission(
                    "programming",
                    "com.example.model-catalog",
                    "model.catalog.read",
                    true,
                )
                .unwrap();
        }
        let allowed = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(allowed.status(), StatusCode::OK);
        let body: Value = allowed.json().await.unwrap();
        assert_eq!(body["operation"], "models.list");
        assert!(body["result"]["models"].is_array());
        let spoofed = client.post(&url).header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"runtimeId":target.instance_id,
                "sessionId":target.session_id,"pluginId":"com.example.model-catalog","sceneId":"other"}))
            .send().await.unwrap();
        assert_eq!(spoofed.status(), StatusCode::UNPROCESSABLE_ENTITY);
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry
                .set_permission(
                    "programming",
                    "com.example.model-catalog",
                    "model.catalog.read",
                    false,
                )
                .unwrap();
        }
        let revoked = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(revoked.status(), StatusCode::FORBIDDEN);
        drop(denied);
        drop(spoofed);
        drop(revoked);
        drop(client);
        drop(host);
        let canonical = std::fs::canonicalize(&root).unwrap();
        assert!(canonical.starts_with(std::fs::canonicalize(scratch).unwrap()));
        let mut removed = false;
        for _ in 0..20 {
            if std::fs::remove_dir_all(&canonical).is_ok() {
                removed = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
        assert!(
            removed,
            "isolated model catalog test directory remained in use"
        );
    }
}

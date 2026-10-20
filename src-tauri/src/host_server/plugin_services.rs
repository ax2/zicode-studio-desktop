//! Read-only service discovery for authenticated desktop plugin views.
//! This is a narrow negotiated preview, not the proposed service.v1 profile.
mod http_get;
mod model_generation;
#[cfg(test)]
mod model_generation_revocation_host_tests;
use super::*;
use base64::Engine;
use hmac::{Hmac, Mac};
pub(super) use http_get::AuditWriter as HttpGetAudit;
pub(super) use http_get::Grants as HttpGetGrants;
pub(super) use http_get::PROFILE as HTTP_GET_PROFILE;
pub(super) use http_get::{
    cancel as cancel_http_get, commit as commit_http_get, prepare as prepare_http_get,
};
pub(super) use model_generation::{
    cancel_generation, commit_generation, prepare_generation, Grants,
};
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
            .execution_plugin(&target.scene_id, &request.plugin_id)
            .filter(|plugin| plugin.enabled)
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
                "providerKind":"host_managed","supportsCancellation":true})
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
        &serde_json::to_vec(&(
            scene,
            owner,
            &choice.provider,
            &choice.model,
            &choice.endpoint,
        ))
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
    use sha2::Digest;

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
        assert_eq!(result["models"][0]["supportsCancellation"], true);
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

    #[tokio::test]
    async fn model_generation_result_is_captured_and_save_requires_confirmation() {
        const CHILD: &str = "ZICODE_MODEL_GENERATION_HTTP_TEST_CHILD";
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        if std::env::var_os(CHILD).is_none() {
            let root = scratch.join(format!("model-generation-http-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            std::fs::write(
                root.join("owner.json"),
                r#"{"purpose":"model generation HTTP to result save acceptance","lifetime":"remove on success; keep on failure"}"#,
            )
            .unwrap();
            let output = crate::process_command::new_command(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "host_server::plugin_services::tests::model_generation_result_is_captured_and_save_requires_confirmation",
                    "--nocapture",
                ])
                .env(CHILD, "1")
                .env("ZICODE_MODEL_GENERATION_HTTP_TEST_ROOT", &root)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "stdout:\n{}\nstderr:\n{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            let canonical = std::fs::canonicalize(&root).unwrap();
            assert!(canonical.starts_with(std::fs::canonicalize(scratch).unwrap()));
            std::fs::remove_dir_all(canonical).unwrap();
            return;
        }

        let root = std::path::PathBuf::from(
            std::env::var_os("ZICODE_MODEL_GENERATION_HTTP_TEST_ROOT").unwrap(),
        );
        crate::desktop_profile::initialize([
            "--isolated-profile".into(),
            root.join("profile").into_os_string(),
        ])
        .unwrap();

        use std::io::{BufRead, BufReader, Read, Write};
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let (second_request_tx, second_request_rx) = std::sync::mpsc::channel();
        let mock_model = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let mut cancelled_socket_closed = false;
            for index in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    assert_ne!(reader.read_line(&mut line).unwrap(), 0);
                    if line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line);
                }
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap_or_default();
                let mut body = vec![0; content_length];
                reader.read_exact(&mut body).unwrap();
                requests.push(serde_json::from_slice::<Value>(&body).unwrap());
                if index == 0 {
                    let response = serde_json::to_vec(&json!({
                        "choices":[{"message":{"content":"Synthetic model response."}}]
                    }))
                    .unwrap();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        response.len()
                    )
                    .unwrap();
                    stream.write_all(&response).unwrap();
                } else {
                    second_request_tx.send(()).unwrap();
                    let mut byte = [0; 1];
                    cancelled_socket_closed = stream.read(&mut byte).is_ok_and(|read| read == 0);
                }
            }
            (requests, cancelled_socket_closed)
        });

        let scene = "programming";
        let digest = sha2::Sha256::digest(scene.as_bytes());
        let scene_key: String = digest[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let system_root = crate::app_paths::system_root().unwrap();
        let models_path = system_root
            .join("scenes")
            .join(scene_key)
            .join("agent/models.json");
        std::fs::create_dir_all(models_path.parent().unwrap()).unwrap();
        std::fs::write(
            &models_path,
            serde_json::to_vec(&json!({"providers":{"local-fixture":{
                "api":"openai-completions","baseUrl":format!("http://{address}/v1"),
                "authHeader":false,"models":[{"id":"studio-local-fixture","name":"Local Test Model"}]
            }}}))
            .unwrap(),
        )
        .unwrap();

        let workspace_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let workspace = root.join("workspace");
        let public = root.join("public");
        let package = root.join("provider");
        std::fs::create_dir_all(&workspace).unwrap();
        std::fs::create_dir_all(&public).unwrap();
        std::fs::create_dir_all(&package).unwrap();
        std::fs::write(public.join("index.html"), "test").unwrap();
        std::fs::write(
            package.join("plugin.json"),
            serde_json::to_vec(&json!({
                "schemaVersion":2,"id":"com.example.model-generation","name":"Model generation HTTP fixture",
                "description":"Isolated test plugin for the model result flow","version":"0.1.0","publisher":"test",
                "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
                "requiredProfiles":{"model.catalog.read.v1":"=1.0.0-preview.1","model.generate.v1":"=1.0.0-preview.1"},
                "contributes":{"commands":[],"capabilities":[],"views":[],"piTools":[]},
                "permissions":{"required":[
                    {"name":"model.catalog.read","reason":"List models for the test"},
                    {"name":"model.generate","reason":"Run the explicitly confirmed test request"}
                ],"optional":[]}
            }))
            .unwrap(),
        )
        .unwrap();

        let metadata =
            crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(16);
        let target = RuntimeTarget::new(
            workspace_id,
            "model-generation-http-session",
            "model-generation-http-runtime",
        );
        let runtime = runtimes.register_in_memory(target.clone()).unwrap();
        let host = HostServer::start_with_mode(
            public,
            runtimes,
            auth,
            HashMap::from([(workspace_id.to_owned(), workspace)]),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        let plugin_id = "com.example.model-generation";
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry.install_developer(&package).unwrap();
            registry
                .set_permission(scene, plugin_id, "model.catalog.read", true)
                .unwrap();
            registry
                .set_permission(scene, plugin_id, "model.generate", true)
                .unwrap();
            registry.set_enabled(scene, plugin_id, true).unwrap();
        }

        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let token = host.desktop_token().to_owned();
        let catalog: Value = client
            .post(format!("{}/v2/plugin-services/models", host.origin()))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"runtimeId":target.instance_id,
                "sessionId":target.session_id,"pluginId":plugin_id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(catalog["operation"], "models.list");
        assert_eq!(catalog["result"]["models"].as_array().unwrap().len(), 1);
        let model_ref = catalog["result"]["models"][0]["modelRef"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(model_ref.starts_with("model-"));
        assert!(catalog["result"]["models"][0]["endpoint"].is_null());

        let prepare_url = format!(
            "{}/v2/plugin-services/model-generation/prepare",
            host.origin()
        );
        let prepare_request = json!({
            "schemaVersion":1,"workspaceId":workspace_id,"runtimeId":target.instance_id,
            "sessionId":target.session_id,"pluginId":plugin_id,"modelRef":model_ref,
            "goal":"Summarize this note","materials":[{"sourceId":"note-1",
                "displayName":"Synthetic note","sourceKind":"user_text","trust":"user_authored",
                "text":"Synthetic input for result transfer."}],"maxOutputTokens":128,"deadlineMs":5000
        });
        let prepare: Value = client
            .post(&prepare_url)
            .header("x-zicode-desktop-token", &token)
            .json(&prepare_request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(prepare["displayName"], "Local Test Model");
        assert!(prepare["promptPreview"]
            .as_str()
            .unwrap()
            .contains("Synthetic input"));
        let declined = client
            .post(format!(
                "{}/v2/plugin-services/model-generation/commit",
                host.origin()
            ))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":workspace_id,
                "runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin_id,
                "grantId":prepare["grantId"],"confirmed":false}))
            .send()
            .await
            .unwrap();
        assert_eq!(declined.status(), StatusCode::BAD_REQUEST);

        let operation_id = uuid::Uuid::new_v4().to_string();
        let mut confirmed_prepare_request = prepare_request.clone();
        confirmed_prepare_request["operationId"] = json!(operation_id);
        let prepare: Value = client
            .post(&prepare_url)
            .header("x-zicode-desktop-token", &token)
            .json(&confirmed_prepare_request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(prepare["operationId"], operation_id);
        let generated: Value = client
            .post(format!(
                "{}/v2/plugin-services/model-generation/commit",
                host.origin()
            ))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":workspace_id,
                "runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin_id,
                "grantId":prepare["grantId"],"confirmed":true,"operationId":operation_id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(generated["result"]["text"], "Synthetic model response.");
        assert!(generated["resultRef"]["resultId"].is_string());
        assert!(generated["resultCaptureError"].is_null());
        let cancel: Value = client
            .post(format!(
                "{}/v2/plugin-services/model-generation/cancel",
                host.origin()
            ))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":workspace_id,
                "runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin_id,
                "operationId":operation_id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(cancel["status"], "finished");
        assert_eq!(cancel["executionFinished"], true);

        let cancelled_operation_id = uuid::Uuid::new_v4().to_string();
        let mut cancelled_prepare_request = prepare_request.clone();
        cancelled_prepare_request["operationId"] = json!(cancelled_operation_id);
        let cancelled_prepare: Value = client
            .post(&prepare_url)
            .header("x-zicode-desktop-token", &token)
            .json(&cancelled_prepare_request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let commit_task = {
            let client = client.clone();
            let host_origin = host.origin().to_owned();
            let token = token.clone();
            let workspace_id = workspace_id.to_owned();
            let runtime_id = target.instance_id.clone();
            let session_id = target.session_id.clone();
            let plugin_id = plugin_id.to_owned();
            let grant_id = cancelled_prepare["grantId"].as_str().unwrap().to_owned();
            let operation_id = cancelled_operation_id.clone();
            tokio::spawn(async move {
                client
                    .post(format!(
                        "{host_origin}/v2/plugin-services/model-generation/commit"
                    ))
                    .header("x-zicode-desktop-token", token)
                    .json(&json!({"schemaVersion":1,"workspaceId":workspace_id,
                        "runtimeId":runtime_id,"sessionId":session_id,"pluginId":plugin_id,
                        "grantId":grant_id,"confirmed":true,"operationId":operation_id}))
                    .send()
                    .await
                    .unwrap()
            })
        };
        tokio::task::spawn_blocking(move || {
            second_request_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .expect("second model request did not reach local service");
        })
        .await
        .unwrap();
        let cancel_ack: Value = client
            .post(format!(
                "{}/v2/plugin-services/model-generation/cancel",
                host.origin()
            ))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":workspace_id,
                "runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin_id,
                "operationId":cancelled_operation_id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(cancel_ack["status"], "requested");
        assert_eq!(cancel_ack["executionFinished"], false);
        let cancelled_response = commit_task.await.unwrap();
        assert_eq!(cancelled_response.status(), StatusCode::CONFLICT);
        let cancelled_body: Value = cancelled_response.json().await.unwrap();
        assert_eq!(cancelled_body["error"]["code"], "model_request_cancelled");
        assert!(cancelled_body["resultRef"].is_null());
        let terminal_cancel: Value = client
            .post(format!(
                "{}/v2/plugin-services/model-generation/cancel",
                host.origin()
            ))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":workspace_id,
                "runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin_id,
                "operationId":cancelled_operation_id}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(terminal_cancel["status"], "finished");
        assert_eq!(terminal_cancel["executionFinished"], true);

        let (sent_model_requests, cancelled_socket_closed) = mock_model.join().unwrap();
        assert_eq!(sent_model_requests.len(), 2);
        assert!(
            cancelled_socket_closed,
            "Host cancellation left model connection open"
        );
        let sent_prompt = sent_model_requests[0]["messages"][0]["content"]
            .as_str()
            .unwrap();
        assert!(sent_prompt.contains("Summarize this note"));
        assert!(sent_prompt.contains("Synthetic input for result transfer."));

        let scope = json!({"workspaceId":workspace_id,"sceneId":scene,"pluginId":plugin_id,
            "capabilityId":"model.generate.v1"});
        let save_url = format!("{}/v2/plugin-results/prepare-save", host.origin());
        let prepared: Value = client
            .post(&save_url)
            .header("x-zicode-desktop-token", &token)
            .json(
                &json!({"scope":scope,"resultId":generated["resultRef"]["resultId"],
                "title":"Synthetic generated answer"}),
            )
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(prepared["preview"]["text"], "Synthetic model response.");
        let commit_url = format!("{}/v2/plugin-results/commit-save", host.origin());
        let commit = |confirmed| {
            client
                .post(&commit_url)
                .header("x-zicode-desktop-token", &token)
                .json(&json!({"scope":scope,"grantId":prepared["grantId"],"confirmed":confirmed}))
        };
        let declined = commit(false).send().await.unwrap();
        assert_eq!(declined.status(), StatusCode::CONFLICT);
        let saved: Value = commit(true).send().await.unwrap().json().await.unwrap();
        assert_eq!(saved["artifact"]["content"], "Synthetic model response.");

        drop(client);
        drop(host);
        drop(runtime);
    }
}

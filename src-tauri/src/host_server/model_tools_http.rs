use super::*;

type ApiFailure = (StatusCode, Json<Value>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ModelQuery {
    scene_id: String,
    purpose: String,
}

pub(super) async fn model_tool_catalog(
    State(state): State<Arc<HostState>>,
    Query(query): Query<ModelQuery>,
) -> Result<Json<Value>, ApiFailure> {
    match query.purpose.as_str() {
        "translation" => ensure_translate_authorized(&state, &query.scene_id)?,
        "summary" => ensure_notes_authorized(&state, &query.scene_id, false)?,
        _ => return Err(failure("model_purpose_invalid")),
    }
    let root = crate::app_paths::system_root().map_err(|_| failure("model_config_unavailable"))?;
    let models =
        tokio::task::spawn_blocking(move || crate::model_tools::catalog(&root, &query.scene_id))
            .await
            .map_err(|_| failure("model_worker_unavailable"))?
            .map_err(|e| failure(&e))?;
    Ok(Json(json!({"models": models})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TranslateRequest {
    scene_id: String,
    text: String,
    target_lang: String,
    #[serde(default)]
    source_lang: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

pub(super) async fn translate_http(
    State(state): State<Arc<HostState>>,
    Json(request): Json<TranslateRequest>,
) -> Result<Json<Value>, ApiFailure> {
    ensure_translate_authorized(&state, &request.scene_id)?;
    crate::translation::validate(
        &request.text,
        &request.target_lang,
        request.source_lang.as_deref(),
    )
    .map_err(|e| failure(&e))?;
    let root = crate::app_paths::system_root().map_err(|_| failure("model_config_unavailable"))?;
    let result = tokio::task::spawn_blocking(move || {
        let endpoint = crate::model_tools::resolve(
            &root,
            &request.scene_id,
            request.provider.as_deref(),
            request.model.as_deref(),
        )?;
        let key = credential(&request.scene_id, &endpoint)?;
        crate::translation::translate(
            &crate::translation::TranslationRequest {
                text: request.text,
                target_lang: request.target_lang,
                source_lang: request.source_lang,
            },
            &endpoint,
            key.as_deref(),
        )
    })
    .await
    .map_err(|_| failure("model_worker_unavailable"))?
    .map_err(|e| failure(&e))?;
    Ok(Json(json!(result)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SummarizeNoteRequest {
    scene_id: String,
    workspace_id: String,
    text: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    provider: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

pub(super) async fn summarize_note(
    State(state): State<Arc<HostState>>,
    Json(request): Json<SummarizeNoteRequest>,
) -> Result<Json<Value>, ApiFailure> {
    ensure_notes_authorized(&state, &request.scene_id, false)?;
    let network_granted = state
        .plugins
        .lock()
        .map_err(|_| failure("model_config_unavailable"))?
        .list(&request.scene_id)
        .into_iter()
        .find(|plugin| plugin.manifest.id == "com.zicode.notes")
        .and_then(|plugin| plugin.permission_grants.get("network.fetch").copied())
        .unwrap_or(false);
    if !network_granted {
        return Err(failure("model_network_permission_required"));
    }
    if request.workspace_id.trim().is_empty() {
        return Err(failure("Workspace is required"));
    }
    crate::summary::validate(&request.text, request.title.as_deref()).map_err(|e| failure(&e))?;
    let root = crate::app_paths::system_root().map_err(|_| failure("model_config_unavailable"))?;
    let result = tokio::task::spawn_blocking(move || {
        let endpoint = crate::model_tools::resolve(
            &root,
            &request.scene_id,
            request.provider.as_deref(),
            request.model.as_deref(),
        )?;
        let key = credential(&request.scene_id, &endpoint)?;
        crate::summary::summarize(
            &crate::summary::SummarizeRequest { text: request.text },
            &endpoint,
            key.as_deref(),
            request.title.as_deref(),
        )
    })
    .await
    .map_err(|_| failure("model_worker_unavailable"))?
    .map_err(|e| failure(&e))?;
    Ok(Json(json!(result)))
}

fn credential(
    scene: &str,
    endpoint: &crate::model_tools::ModelEndpoint,
) -> Result<Option<String>, String> {
    if endpoint.choice.requires_key {
        crate::credential_broker::model_tool_credential(scene, &endpoint.choice.provider)
    } else {
        Ok(None)
    }
}

fn failure(message: &str) -> ApiFailure {
    plugin_api_error(StatusCode::BAD_REQUEST, "model_tool_failed", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn checks_notes_network_permission_and_model_selection_through_the_host() {
        let temp = std::env::temp_dir().join(format!("zicode-model-http-{}", uuid::Uuid::new_v4()));
        let public = temp.join("public");
        std::fs::create_dir_all(&public).unwrap();
        std::fs::write(public.join("index.html"), "test").unwrap();
        let metadata =
            crate::metadata_store::MetadataStore::open(&temp.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start(public, NativePiManager::new(32), auth)
            .await
            .unwrap();
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry
                .set_enabled("programming", "com.zicode.notes", true)
                .unwrap();
            registry
                .set_permission("programming", "com.zicode.notes", "storage.plugin", true)
                .unwrap();
            registry
                .set_permission("programming", "com.zicode.notes", "network.fetch", false)
                .unwrap();
            registry
                .set_enabled("programming", "com.zicode.translate", false)
                .unwrap();
        }
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("{}/v2/notes/summarize", host.origin());
        let input = json!({"sceneId":"programming","workspaceId":"fixture","text":"Article"});
        let denied: Value = client
            .post(&url)
            .json(&input)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(
            denied["error"]["message"],
            "model_network_permission_required"
        );
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_permission("programming", "com.zicode.notes", "network.fetch", true)
            .unwrap();
        let unselected: Value = client
            .post(&url)
            .json(&input)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(unselected["error"]["message"], "model_selection_required");
        let disabled = client
            .get(format!(
                "{}/v2/model-tools/models?sceneId=programming&purpose=translation",
                host.origin()
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(disabled.status(), StatusCode::FORBIDDEN);
        host.stop_and_wait().await.unwrap();
        for _ in 0..100 {
            if std::fs::remove_dir_all(&temp).is_ok() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("fixture files remain locked");
    }
}

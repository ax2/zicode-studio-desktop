//! Studio-owned task overview. This route is not a plugin lifecycle profile.
use super::*;
use crate::plugin_task_store::{Store, TaskCursor};

type ApiError = (StatusCode, Json<Value>);

/// Best-effort task-state reconciliation after the registry has already
/// stopped the plugin's active capabilities. A missing database has no tasks.
pub(super) async fn revoke_plugin_tasks(
    state: Arc<HostState>,
    plugin_id: String,
    scene_id: Option<String>,
) -> Result<usize, &'static str> {
    tokio::task::spawn_blocking(move || {
        revoke_plugin_tasks_now(&state, &plugin_id, scene_id.as_deref())
    })
    .await
    .map_err(|_| "task_store_unavailable")?
}

pub(super) fn revoke_plugin_tasks_now(
    state: &HostState,
    plugin_id: &str,
    scene_id: Option<&str>,
) -> Result<usize, &'static str> {
    let Some(store) = task_store_if_exists(state)? else {
        return Ok(0);
    };
    store.revoke_plugin(plugin_id, scene_id)
}

pub(super) fn interrupt_active_tasks_now(state: &HostState) -> Result<usize, &'static str> {
    let Some(store) = task_store_if_exists(state)? else {
        return Ok(0);
    };
    store.interrupt_active()
}

pub(super) fn interrupt_workspace_tasks_now(
    state: &HostState,
    workspace_id: &str,
) -> Result<usize, &'static str> {
    let Some(store) = task_store_if_exists(state)? else {
        return Ok(0);
    };
    store.interrupt_workspace(workspace_id)
}

fn task_store_if_exists(state: &HostState) -> Result<Option<Arc<Store>>, &'static str> {
    let store = {
        let mut slot = state
            .plugin_task_store
            .lock()
            .map_err(|_| "task_store_unavailable")?;
        if slot.is_none() {
            if !state.plugin_task_database.exists() {
                return Ok(None);
            }
            *slot = Some(Arc::new(Store::open(&state.plugin_task_database)?));
        }
        slot.as_ref().cloned().ok_or("task_store_unavailable")?
    };
    Ok(Some(store))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct WorkspaceRequest {
    schema_version: u32,
    workspace_id: String,
    #[serde(default)]
    before: Option<TaskCursor>,
    limit: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct DetailRequest {
    schema_version: u32,
    workspace_id: String,
    task_ref: String,
    #[serde(default)]
    before_sequence: Option<u64>,
}

pub(super) async fn detail(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<DetailRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "desktop_only",
            "Task detail is available to the Studio desktop only",
        ));
    }
    if request.schema_version != 1
        || request.workspace_id.len() > 64
        || uuid::Uuid::parse_str(&request.workspace_id).is_err()
        || request
            .before_sequence
            .is_some_and(|sequence| sequence == 0 || sequence > i64::MAX as u64)
    {
        return Err(rejected(StatusCode::BAD_REQUEST, "task_request_invalid"));
    }
    state
        .data
        .workspace_root_path(&request.workspace_id)
        .map_err(|_| rejected(StatusCode::CONFLICT, "task_workspace_unavailable"))?;
    let state_for_read = state.clone();
    let detail = tokio::task::spawn_blocking(move || {
        let store = {
            let mut slot = state_for_read
                .plugin_task_store
                .lock()
                .map_err(|_| "task_store_unavailable")?;
            if slot.is_none() {
                *slot = Some(Arc::new(Store::open(&state_for_read.plugin_task_database)?));
            }
            slot.as_ref().cloned().ok_or("task_store_unavailable")?
        };
        store.workspace_detail(
            &request.workspace_id,
            &request.task_ref,
            request.before_sequence,
        )
    })
    .await
    .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "task_store_unavailable"))?
    .map_err(|code| {
        rejected(
            if code == "task_not_found" {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            code,
        )
    })?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "operation": "plugin-tasks.workspace.detail",
        "detail": detail
    })))
}

pub(super) async fn workspace(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<WorkspaceRequest>,
) -> Result<Json<Value>, ApiError> {
    if !desktop_http_token_authorized(&headers, &state.desktop_token) {
        return Err(plugin_api_error(
            StatusCode::FORBIDDEN,
            "desktop_only",
            "Task overview is available to the Studio desktop only",
        ));
    }
    if request.schema_version != 1
        || request.workspace_id.len() > 64
        || uuid::Uuid::parse_str(&request.workspace_id).is_err()
    {
        return Err(rejected(StatusCode::BAD_REQUEST, "task_request_invalid"));
    }
    state
        .data
        .workspace_root_path(&request.workspace_id)
        .map_err(|_| rejected(StatusCode::CONFLICT, "task_workspace_unavailable"))?;

    let state_for_read = state.clone();
    let page = tokio::task::spawn_blocking(move || {
        let store = {
            let mut slot = state_for_read
                .plugin_task_store
                .lock()
                .map_err(|_| "task_store_unavailable")?;
            if slot.is_none() {
                *slot = Some(Arc::new(Store::open(&state_for_read.plugin_task_database)?));
            }
            slot.as_ref().cloned().ok_or("task_store_unavailable")?
        };
        store.list_workspace(
            &request.workspace_id,
            request.before.as_ref(),
            request.limit,
        )
    })
    .await
    .map_err(|_| rejected(StatusCode::SERVICE_UNAVAILABLE, "task_store_unavailable"))?
    .map_err(|code| {
        rejected(
            if code == "task_request_invalid" {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::SERVICE_UNAVAILABLE
            },
            code,
        )
    })?;
    Ok(Json(json!({
        "schemaVersion": 1,
        "operation": "plugin-tasks.workspace.list",
        "page": page
    })))
}

fn rejected(status: StatusCode, code: &'static str) -> ApiError {
    plugin_api_error(status, code, "Task overview request rejected")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_task_store::{Owner, State};

    #[tokio::test]
    async fn host_overview_requires_desktop_token_and_registered_workspace() {
        let scratch =
            std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("plugin-task-center-{}", uuid::Uuid::new_v4()));
        let public = root.join("public");
        let workspace_a = root.join("workspace-a");
        let workspace_b = root.join("workspace-b");
        for path in [&public, &workspace_a, &workspace_b] {
            std::fs::create_dir_all(path).unwrap();
        }
        std::fs::write(
            root.join("owner.json"),
            r#"{"purpose":"Studio plugin task overview Host acceptance","lifetime":"remove on success"}"#,
        )
        .unwrap();
        std::fs::write(public.join("index.html"), "test").unwrap();
        let metadata =
            crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start_with_mode(
            public,
            NativePiManager::new(16),
            auth,
            HashMap::new(),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        let id_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let id_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        host.register_workspace(id_a, workspace_a).unwrap();
        host.register_workspace(id_b, workspace_b).unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let url = format!("{}/v2/plugin-task-center/workspace", host.origin());
        let token = host.state.desktop_token.clone();
        let request = json!({"schemaVersion":1,"workspaceId":id_a,"limit":10});
        assert_eq!(
            client
                .post(&url)
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert!(!host.state.plugin_task_database.exists());
        let invalid = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":uuid::Uuid::new_v4(),"limit":10}))
            .send()
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::CONFLICT);
        assert!(!host.state.plugin_task_database.exists());
        let empty: Value = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(empty["page"]["tasks"].as_array().unwrap().len(), 0);
        assert!(host.state.plugin_task_database.exists());
        let store = host
            .state
            .plugin_task_store
            .lock()
            .unwrap()
            .as_ref()
            .cloned()
            .unwrap();
        let owner = Owner {
            workspace_id: id_a.into(),
            scene_id: "programming".into(),
            plugin_id: "com.example.tools".into(),
            package_version: "1.0.0".into(),
            profile_version: "1.0.0-preview.1".into(),
            operation_id: "service.inspect".into(),
        };
        let own = store
            .submit(&owner, "request_12345678", &json!({"secret":"hidden"}))
            .unwrap();
        let mut foreign = owner.clone();
        foreign.workspace_id = id_b.into();
        let other = store
            .submit(&foreign, "request_12345678", &json!({}))
            .unwrap();
        let response: Value = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["page"]["tasks"].as_array().unwrap().len(), 1);
        assert_eq!(response["page"]["tasks"][0]["taskRef"], own.task_ref);
        let text = response.to_string();
        assert!(!text.contains(&other.task_ref));
        assert!(!text.contains("hidden"));
        let detail_url = format!("{}/v2/plugin-task-center/detail", host.origin());
        let detail_body = json!({"schemaVersion":1,"workspaceId":id_a,"taskRef":own.task_ref});
        assert_eq!(
            client
                .post(&detail_url)
                .json(&detail_body)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        let detail: Value = client
            .post(&detail_url)
            .header("x-zicode-desktop-token", &token)
            .json(&detail_body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(detail["operation"], "plugin-tasks.workspace.detail");
        assert_eq!(detail["detail"]["snapshot"]["taskRef"], own.task_ref);
        assert_eq!(detail["detail"]["events"][0]["state"], "queued");
        assert!(!detail.to_string().contains("hidden"));
        for index in 0..66 {
            store
                .transition(
                    &owner,
                    &own.task_ref,
                    if index % 2 == 0 {
                        State::Running
                    } else {
                        State::AwaitingConfirmation
                    },
                )
                .unwrap();
        }
        let recent: Value = client
            .post(&detail_url)
            .header("x-zicode-desktop-token", &token)
            .json(&detail_body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let recent_events = recent["detail"]["events"].as_array().unwrap();
        assert_eq!(recent_events.len(), 64);
        assert_eq!(recent["detail"]["earlierEventsAvailable"], true);
        let first_sequence = recent_events[0]["sequence"].as_u64().unwrap();
        let earlier: Value = client
            .post(&detail_url)
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":id_a,
                "taskRef":own.task_ref,"beforeSequence":first_sequence}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(earlier["detail"]["events"][0]["state"], "queued");
        assert_eq!(earlier["detail"]["earlierEventsAvailable"], false);
        assert_eq!(
            earlier["detail"]["events"].as_array().unwrap().len(),
            usize::try_from(first_sequence - 1).unwrap()
        );
        let invalid_cursor = client
            .post(&detail_url)
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":id_a,
                "taskRef":own.task_ref,"beforeSequence":0}))
            .send()
            .await
            .unwrap();
        assert_eq!(invalid_cursor.status(), StatusCode::BAD_REQUEST);
        let foreign_detail = client
            .post(&detail_url)
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":id_b,"taskRef":own.task_ref}))
            .send()
            .await
            .unwrap();
        assert_eq!(foreign_detail.status(), StatusCode::NOT_FOUND);
        let spoofed = client
            .post(&url)
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"schemaVersion":1,"workspaceId":id_a,"limit":10,"pluginId":"other"}))
            .send()
            .await
            .unwrap();
        assert_eq!(spoofed.status(), StatusCode::UNPROCESSABLE_ENTITY);

        let source = root.join("revocation-plugin");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(
            source.join("plugin.json"),
            serde_json::to_vec(&json!({
                "schemaVersion":1,"id":"com.example.task-revoke","name":"Task revoke fixture",
                "description":"Host task revocation fixture","version":"1.0.0","publisher":"example",
                "permissions":{"required":[],"optional":[{"name":"storage.plugin","reason":"Fixture"}]},
                "contributes":{"commands":[{"id":"taskRevoke.run","title":"Run"}]}
            }))
            .unwrap(),
        )
        .unwrap();
        host.install_developer_plugin(&source).unwrap();
        let mut revocation_owner = owner.clone();
        revocation_owner.plugin_id = "com.example.task-revoke".into();
        let to_disable = store
            .submit(&revocation_owner, "request_disable", &json!({}))
            .unwrap();
        let mut other_scene = revocation_owner.clone();
        other_scene.scene_id = "research".into();
        let to_revoke_permission = store
            .submit(&other_scene, "request_permission", &json!({}))
            .unwrap();
        let disabled = client
            .post(format!("{}/v2/plugins/enablement", host.origin()))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"sceneId":"programming","pluginId":"com.example.task-revoke","enabled":false}))
            .send()
            .await
            .unwrap();
        assert_eq!(disabled.status(), StatusCode::OK);
        assert_eq!(
            store
                .snapshot(&revocation_owner, &to_disable.task_ref)
                .unwrap()
                .state,
            "revoked"
        );
        assert_eq!(
            store
                .snapshot(&other_scene, &to_revoke_permission.task_ref)
                .unwrap()
                .state,
            "queued"
        );
        let permission = client
            .post(format!("{}/v2/plugins/permission", host.origin()))
            .header("x-zicode-desktop-token", &token)
            .json(
                &json!({"sceneId":"research","pluginId":"com.example.task-revoke",
                "permission":"storage.plugin","granted":false}),
            )
            .send()
            .await
            .unwrap();
        assert_eq!(permission.status(), StatusCode::OK);
        assert_eq!(
            store
                .snapshot(&other_scene, &to_revoke_permission.task_ref)
                .unwrap()
                .state,
            "revoked"
        );
        let to_uninstall = store
            .submit(&revocation_owner, "request_uninstall", &json!({}))
            .unwrap();
        let uninstall = client
            .post(format!("{}/v2/plugins/uninstall", host.origin()))
            .header("x-zicode-desktop-token", &token)
            .json(&json!({"pluginId":"com.example.task-revoke"}))
            .send()
            .await
            .unwrap();
        assert_eq!(uninstall.status(), StatusCode::OK);
        assert_eq!(
            store
                .snapshot(&revocation_owner, &to_uninstall.task_ref)
                .unwrap()
                .state,
            "revoked"
        );
        assert_eq!(
            store.snapshot(&owner, &own.task_ref).unwrap().state,
            "awaiting_confirmation"
        );
        drop(spoofed);
        drop(client);
        drop(store);
        drop(host);
        let canonical = std::fs::canonicalize(&root).unwrap();
        assert!(canonical.starts_with(std::fs::canonicalize(&scratch).unwrap()));
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
            "isolated task center test directory remained in use"
        );
    }
}

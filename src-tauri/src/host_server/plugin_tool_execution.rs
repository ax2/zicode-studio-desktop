use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CancelRequest {
    schema_version: u32,
    runtime_id: String,
    session_id: String,
    tool_call_id: String,
}
fn call_error(code: &'static str) -> (StatusCode, Json<Value>) {
    plugin_api_error(
        if code == "plugin_call_in_progress" {
            StatusCode::CONFLICT
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        code,
        "Plugin call lifecycle rejected the request",
    )
}
pub(super) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CancelRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if request.schema_version != 1
        || request.tool_call_id.is_empty()
        || request.tool_call_id.len() > 256
    {
        return Err(plugin_api_error(
            StatusCode::BAD_REQUEST,
            "invalid_parameters",
            "Invalid cancellation request",
        ));
    }
    let record =
        plugin_tool_auth::authorize(&state, &headers, &request.runtime_id, &request.session_id)?;
    let call_target = plugin_tool_auth::call_target(&state, &record)?;
    let (status, execution_finished) = state
        .plugin_calls
        .cancel(
            &call_target.instance_id,
            &call_target.session_id,
            &request.tool_call_id,
        )
        .map_err(call_error)?;
    Ok(Json(
        json!({"schemaVersion":1,"status":status,"executionFinished":execution_finished}),
    ))
}
pub(super) async fn invoke(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PluginToolInvokeRequest>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    if request.tool_call_id.is_empty()
        || request.tool_call_id.len() > 256
        || request.runtime_id.is_empty()
        || request.session_id.is_empty()
    {
        return Err(plugin_api_error(
            StatusCode::BAD_REQUEST,
            "invalid_parameters",
            "runtimeId, sessionId, and toolCallId are required",
        ));
    }
    let record =
        plugin_tool_auth::authorize(&state, &headers, &request.runtime_id, &request.session_id)?;
    let call_target = plugin_tool_auth::call_target(&state, &record)?;
    let plugin_id = {
        let registry = state.plugins.lock().map_err(|_| {
            plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
        })?;
        plugin_tool_catalog::validate_invocation(
            &registry,
            &record.target.scene_id,
            &request.tool_name,
            request.tool_id.as_deref(),
            request.catalog_revision.as_deref(),
        )?;
        registry
            .pi_tools(&record.target.scene_id)
            .into_iter()
            .find(|tool| tool.name == request.tool_name)
            .map(|tool| tool.plugin_id)
            .ok_or_else(|| plugin_api_error(
                StatusCode::NOT_FOUND,
                "tool_unavailable",
                "The tool is missing, disabled, or not granted for this scene",
            ))?
    };
    let lease = state
        .plugin_calls
        .begin(
            &call_target.instance_id,
            &call_target.session_id,
            &request.tool_call_id,
            &plugin_id,
        )
        .map_err(call_error)?;
    let result = tokio::task::spawn_blocking(move || {
        // Lease survives disconnects and remains active until the synchronous call returns.
        let lease = lease;
        let record = plugin_tool_auth::authorize(
            &state,
            &headers,
            &request.runtime_id,
            &request.session_id,
        )?;
        if lease.flag.load(std::sync::atomic::Ordering::Acquire) {
            return Err(capability_api_error(CapabilityError {
                code: "worker_cancelled",
                message: "Plugin call cancelled before execution".into(),
            }));
        }
        let registry = state.plugins.lock().map_err(|_| {
            plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
        })?;
        plugin_tool_catalog::validate_invocation(
            &registry,
            &record.target.scene_id,
            &request.tool_name,
            request.tool_id.as_deref(),
            request.catalog_revision.as_deref(),
        )?;
        let tool = registry
            .pi_tools(&record.target.scene_id)
            .into_iter()
            .find(|tool| tool.name == request.tool_name)
            .ok_or_else(|| {
                plugin_api_error(
                    StatusCode::NOT_FOUND,
                    "tool_unavailable",
                    "The tool is missing, disabled, or not granted for this scene",
                )
            })?;
        if tool.plugin_id != plugin_id {
            return Err(plugin_api_error(
                StatusCode::CONFLICT,
                "catalog_revision_changed",
                "Search and load this tool again before invoking it",
            ));
        }
        let mut broker = state.capability_broker.lock().map_err(|_| {
            plugin_api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "capability_broker_unavailable",
                "",
            )
        })?;
        let dispatch = broker.prepare_worker_invocation(
            &registry,
            CapabilityInvocation {
                caller: "pi".into(),
                scene_id: record.target.scene_id.clone(),
                workspace_id: record.target.workspace_id.clone(),
                plugin_id: tool.plugin_id,
                capability_id: tool.capability,
                tool_call_id: Some(request.tool_call_id.clone()),
                idempotency_scope: Some(record.target.instance_id.clone()),
                input: request.input,
            },
            &lease.flag,
        );
        match dispatch {
            crate::plugin_capabilities::detached_worker::Dispatch::Complete(outcome) => {
                outcome.map_err(capability_api_error)
            }
            crate::plugin_capabilities::detached_worker::Dispatch::Worker(mut job) => {
                drop(broker);
                drop(registry);
                let mut outcome = job.execute(&lease.flag);
                let authorized = plugin_tool_auth::authorize(
                    &state,
                    &headers,
                    &request.runtime_id,
                    &request.session_id,
                );
                let registry = state.plugins.lock().map_err(|_| {
                    plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
                })?;
                let catalog_current = plugin_tool_catalog::validate_invocation(
                    &registry,
                    &record.target.scene_id,
                    &request.tool_name,
                    request.tool_id.as_deref(),
                    request.catalog_revision.as_deref(),
                );
                if authorized.is_err() || catalog_current.is_err() {
                    outcome = Err(CapabilityError {
                        code: "capability_unavailable",
                        message: "Authorization or catalog changed during execution".into(),
                    });
                }
                let mut broker = state.capability_broker.lock().map_err(|_| {
                    plugin_api_error(
                        StatusCode::SERVICE_UNAVAILABLE,
                        "capability_broker_unavailable",
                        "",
                    )
                })?;
                let outcome =
                    broker.finish_worker_invocation(&registry, *job, outcome, &lease.flag);
                authorized?;
                catalog_current?;
                outcome.map_err(capability_api_error)
            }
        }
    })
    .await
    .map_err(|_| {
        plugin_api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "plugin_execution_failed",
            "Plugin execution task failed",
        )
    })??;
    Ok(Json(json!({"result":result})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn real_http_cancel_is_authenticated_lock_independent_and_covers_late_invoke() {
        let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
        let root = scratch.join(format!("host-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("public")).unwrap();
        std::fs::write(
            root.join("owner.json"),
            r#"{"purpose":"real HTTP cancellation conformance; remove on success"}"#,
        )
        .unwrap();
        let metadata =
            crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let runtimes = NativePiManager::new(16);
        let issued = RuntimeTarget::new(
            "cancel-workspace",
            "temporary-cancel-session",
            "cancel-runtime",
        );
        let runtime = runtimes.register_in_memory(issued.clone()).unwrap();
        let host = HostServer::start_with_mode(
            root.join("public"),
            runtimes,
            auth,
            HashMap::new(),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        let token = "host-cancel-fixture-token";
        host.state.plugin_tokens.lock().unwrap().insert(
            issued.instance_id.clone(),
            RuntimePluginToken {
                token_hash: sha256_hex(token.as_bytes()),
                target: issued.clone(),
                expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
            },
        );
        // An active call registered before binding must keep the same cancellation owner.
        let lease = host
            .state
            .plugin_calls
            .begin(&issued.instance_id, &issued.session_id, "active", "fixture.plugin")
            .unwrap();
        let target = host
            .state
            .runtimes
            .bind_session_id(&issued, "cancel-session")
            .unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancel_url = format!("{}/v2/plugin-tools/cancel", host.origin());
        // Pi retains its launch session while the actual runtime is formally bound.
        let request = json!({"schemaVersion":1,"runtimeId":target.instance_id,"sessionId":target.session_id,"toolCallId":"active"});
        assert_eq!(
            client
                .post(&cancel_url)
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut foreign = request.clone();
        foreign["runtimeId"] = json!("foreign-runtime");
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&foreign)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        foreign = request.clone();
        foreign["sessionId"] = json!("temporary-foreign-session");
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&foreign)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let mut invalid = request.clone();
        invalid["schemaVersion"] = json!(2);
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&invalid)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::BAD_REQUEST
        );
        invalid = request.clone();
        invalid["workspaceId"] = json!("override");
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&invalid)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
        let state = host.state.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let holder = std::thread::spawn(move || {
            let _registry = state.plugins.lock().unwrap();
            let _broker = state.capability_broker.lock().unwrap();
            ready_tx.send(()).unwrap();
            let _ = release_rx.recv();
        });
        ready_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        let response = tokio::time::timeout(
            Duration::from_secs(2),
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&request)
                .send(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<Value>().await.unwrap(),
            json!({"schemaVersion":1,"status":"requested","executionFinished":false})
        );
        assert!(lease.flag.load(std::sync::atomic::Ordering::Acquire));
        release_tx.send(()).unwrap();
        holder.join().unwrap();
        drop(lease);
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&request)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["executionFinished"],
            true
        );
        let mut pending = request.clone();
        pending["toolCallId"] = json!("pending");
        pending["sessionId"] = json!(issued.session_id);
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&pending)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()["status"],
            "pending"
        );
        let invoke_url = format!("{}/v2/plugin-tools/invoke", host.origin());
        let mut invoke = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"toolCallId":"pending","toolName":"notes_search","input":{"query":"cancel-test"}});
        let refused = client
            .post(&invoke_url)
            .bearer_auth(token)
            .json(&invoke)
            .send()
            .await
            .unwrap();
        assert!(!refused.status().is_success());
        assert_eq!(
            refused.json::<Value>().await.unwrap()["error"]["code"],
            "worker_cancelled"
        );
        invoke["toolCallId"] = json!("next");
        invoke["sessionId"] = json!(issued.session_id);
        assert!(client
            .post(&invoke_url)
            .bearer_auth(token)
            .json(&invoke)
            .send()
            .await
            .unwrap()
            .status()
            .is_success());
        // Conversely, launch-session invokes must be visible to formal-session cancellation.
        let completed = json!({"schemaVersion":1,"runtimeId":target.instance_id,"sessionId":target.session_id,"toolCallId":"next"});
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&completed)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap(),
            json!({"schemaVersion":1,"status":"finished","executionFinished":true})
        );
        host.state.runtimes.stop(&target).unwrap();
        assert_eq!(
            client
                .post(&cancel_url)
                .bearer_auth(token)
                .json(&request)
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::GONE
        );
        drop(runtime);
        host.stop_and_wait().await.unwrap();
        assert!(root
            .canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap()));
        std::fs::remove_dir_all(root).unwrap();
    }
}

use super::*;
use crate::metadata_store::MetadataStore;

#[test]
fn model_result_capture_is_bound_to_profile_and_current_plugin_permissions() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("model-result-proof-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"model result profile and permission proof","remove on success":"true"}"#,
    )
    .unwrap();
    let mut registry = crate::plugin_registry::PluginRegistry::open(root.join("registry")).unwrap();
    let plugin = "com.zicode.devtools.agent-assist";
    registry
        .install_developer(&project.join("tests/fixtures/devtools-agent-assist-candidate03"))
        .unwrap();
    registry
        .set_permission("programming", plugin, "model.catalog.read", true)
        .unwrap();
    registry
        .set_permission("programming", plugin, "model.generate", true)
        .unwrap();
    registry.set_enabled("programming", plugin, true).unwrap();
    let scope = Scope {
        workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc".into(),
        scene_id: "programming".into(),
        plugin_id: plugin.into(),
        capability_id: "model.generate.v1".into(),
    };
    let (source_proof, version) = proof(&registry, &scope).unwrap();
    let mut store = Store::default();
    let reference = store
        .capture(
            scope.clone(),
            source_proof.clone(),
            version,
            &json!({"ok":true,"data":{"text":"model output"}}),
        )
        .unwrap();
    assert_eq!(
        store
            .record(&scope, reference["resultId"].as_str().unwrap())
            .unwrap()
            .text,
        "model output"
    );
    registry
        .set_permission("programming", plugin, "model.generate", false)
        .unwrap();
    assert!(proof(&registry, &scope).is_err());
    registry
        .set_permission("programming", plugin, "model.generate", true)
        .unwrap();
    registry.set_enabled("programming", plugin, true).unwrap();
    assert_ne!(proof(&registry, &scope).unwrap().0, source_proof);
    registry.set_enabled("programming", plugin, false).unwrap();
    assert!(proof(&registry, &scope).is_err());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn actual_http_save_requires_confirmation_scope_current_source_and_is_idempotent() {
    exercise_save(false).await;
}

#[tokio::test]
#[ignore = "requires ZICODE_TEST_WORKER_EXE; uses actual frozen DevTools WASI"]
async fn actual_worker_output_can_be_confirmed_and_saved_over_http() {
    exercise_save(true).await;
}

#[tokio::test]
async fn save_status_process_child() {
    let Some(root) = std::env::var_os("ZICODE_RESULT_SAVE_TEST_CHILD_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    let status_body: Value =
        serde_json::from_str(&std::env::var("ZICODE_RESULT_SAVE_TEST_STATUS").unwrap()).unwrap();
    let expected_id = std::env::var("ZICODE_RESULT_SAVE_TEST_ARTIFACT").unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(root.join("public"), NativePiManager::new(16), auth)
        .await
        .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let status: Value = client
        .post(format!("{}/v2/plugin-results/save-status", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&status_body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["status"], "saved");
    assert_eq!(status["artifactId"], expected_id);
    let commit = client
        .post(format!("{}/v2/plugin-results/commit-save", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({"scope":status_body["scope"],"grantId":status_body["grantId"],"confirmed":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(commit.status(), StatusCode::CONFLICT);
    let artifacts = host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(status_body["scope"]["workspaceId"].as_str().unwrap())
        .unwrap()
        .list("programming", None, None, None)
        .unwrap();
    assert_eq!(artifacts.artifacts.len(), 1);
    host.stop_and_wait().await.unwrap();
}

async fn exercise_save(real_worker: bool) {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("plugin-results-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(root.join("owner.json"),json!({"purpose":"result HTTP save boundary test","keep":"remove on success; keep failures"}).to_string()).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public.clone(), NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin = "com.zicode.devtools.text";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .install_developer(&project.join("tests/fixtures/devtools-text-dev57"))
            .unwrap();
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    // Capture uses the same authenticated invocation result path. This fixture
    // isolates HTTP consent/storage from Worker execution, covered separately.
    let request:CapabilityInvokeRequest=serde_json::from_value(json!({"workspaceId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","sceneId":"programming","pluginId":plugin,"capabilityId":"devtools.text.base64.encode","captureResult":true,"input":{"text":"hello"}})).unwrap();
    {
        let registry = host.state.plugins.lock().unwrap();
        let (entry, _) = registry
            .plugin_runtime_entry("programming", plugin)
            .unwrap();
        let module = module_snapshot::read(&entry).unwrap();
        assert_eq!(
            source_proof_from_module(&registry, &request, &module).unwrap(),
            source_proof(&registry, &request).unwrap()
        );
        for invalid in [Vec::new(), vec![0; module_snapshot::MAX_BYTES + 1]] {
            let (_, error) = source_proof_from_module(&registry, &request, &invalid).unwrap_err();
            assert_eq!(error.0["error"]["code"], "result_source_integrity");
        }
    }
    if real_worker {
        host.state
            .capability_broker
            .lock()
            .unwrap()
            .worker_executable = Some(PathBuf::from(
            std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap(),
        ));
    }
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let invoke = || {
        client.post(format!("{}/v2/plugin-capabilities/invoke",host.origin()))
        .header("x-zicode-desktop-token",host.desktop_token()).json(&json!({"workspaceId":request.workspace_id,"sceneId":request.scene_id,"pluginId":plugin,"capabilityId":request.capability_id,"captureResult":true,"input":{"text":"hello"}})).send()
    };
    let reference = if real_worker {
        let response: Value = invoke().await.unwrap().json().await.unwrap();
        assert_eq!(response["result"]["data"]["text"], "aGVsbG8=");
        response["resultRef"].clone()
    } else {
        let registry = host.state.plugins.lock().unwrap();
        let proof = source_proof(&registry, &request).unwrap();
        capture(
            &host.state,
            &registry,
            &request,
            &proof,
            &json!({"ok":true,"data":{"text":"aGVsbG8="}}),
        )
        .unwrap()
    };
    let scope = json!({"workspaceId":request.workspace_id,"sceneId":request.scene_id,"pluginId":plugin,"capabilityId":request.capability_id});
    // Unrelated plugin/scene changes and a no-op discovery must preserve this result.
    {
        let mut registry = host.state.plugins.lock().unwrap();
        let before = source_proof(&registry, &request).unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.artifacts",
                "storage.plugin",
                false,
            )
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.artifacts",
                "storage.plugin",
                true,
            )
            .unwrap();
        registry
            .set_enabled("programming", "com.zicode.artifacts", true)
            .unwrap();
        registry.set_enabled("other-scene", plugin, true).unwrap();
        registry.reload_developer_plugins().unwrap();
        assert_eq!(before, source_proof(&registry, &request).unwrap());
    }
    let prepare =
        json!({"scope":scope,"resultId":reference["resultId"],"title":"Saved plugin result"});
    let url = format!("{}/v2/plugin-results/prepare-save", host.origin());
    let missing = client.post(&url).json(&prepare).send().await.unwrap();
    assert!(!missing.status().is_success());
    let prepared: Value = client
        .post(&url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&prepare)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(prepared["preview"]["text"], "aGVsbG8=");
    assert!(host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(&request.workspace_id)
        .unwrap()
        .list("programming", None, None, None)
        .unwrap()
        .artifacts
        .is_empty());
    let commit_url = format!("{}/v2/plugin-results/commit-save", host.origin());
    let mut commit = json!({"scope":scope,"grantId":prepared["grantId"],"confirmed":false});
    let send = |body: Value| {
        client
            .post(&commit_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    assert_eq!(
        send(commit.clone()).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    commit["confirmed"] = json!(true);
    commit["scope"]["workspaceId"] = json!("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    assert_eq!(
        send(commit.clone()).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    commit["scope"] = scope;
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin, false)
        .unwrap();
    assert_eq!(
        send(commit.clone()).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin, true)
        .unwrap();
    assert_eq!(
        send(commit.clone()).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    let fresh = if real_worker {
        invoke().await.unwrap().json::<Value>().await.unwrap()["resultRef"].clone()
    } else {
        let registry = host.state.plugins.lock().unwrap();
        let proof = source_proof(&registry, &request).unwrap();
        capture(
            &host.state,
            &registry,
            &request,
            &proof,
            &json!({"ok":true,"data":{"text":"aGVsbG8="}}),
        )
        .unwrap()
    };
    let mut fresh_prepare = prepare;
    fresh_prepare["resultId"] = fresh["resultId"].clone();
    let fresh_grant: Value = client
        .post(&url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&fresh_prepare)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let status_url = format!("{}/v2/plugin-results/save-status", host.origin());
    let status_body = json!({"scope":commit["scope"],"grantId":fresh_grant["grantId"]});
    assert_eq!(
        client
            .post(&status_url)
            .json(&status_body)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let status_before: Value = client
        .post(&status_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&status_body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status_before["status"], "unknown");
    commit["grantId"] = fresh_grant["grantId"].clone();
    let saved: Value = send(commit.clone()).await.unwrap().json().await.unwrap();
    assert!(
        saved.get("artifact").is_some(),
        "save rejected: {}",
        saved["error"]["code"]
    );
    assert_eq!(saved["artifact"]["content"], "aGVsbG8=");
    assert_eq!(saved["replayed"], false);
    // Simulate a lost in-memory receipt after durable artifact publication.
    host.state
        .plugin_results
        .lock()
        .unwrap()
        .grant(fresh_grant["grantId"].as_str().unwrap())
        .unwrap()
        .artifact = None;
    let replay: Value = send(commit).await.unwrap().json().await.unwrap();
    assert_eq!(replay["artifact"]["id"], saved["artifact"]["id"]);
    assert_eq!(replay["replayed"], true);
    let status_saved: Value = client
        .post(&status_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&status_body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status_saved["artifactId"], saved["artifact"]["id"]);
    assert_eq!(status_saved["status"], "saved");
    let mut wrong_scope = status_body.clone();
    wrong_scope["scope"]["pluginId"] = json!("com.zicode.other");
    let wrong: Value = client
        .post(&status_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&wrong_scope)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(wrong["status"], "unknown");
    *host.state.plugin_results.lock().unwrap() = Store::default();
    let recovered: Value = client
        .post(&status_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&status_body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(recovered["artifactId"], saved["artifact"]["id"]);
    let snapshot = host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(&request.workspace_id)
        .unwrap()
        .list("programming", None, None, None)
        .unwrap();
    assert_eq!(snapshot.artifacts.len(), 1);
    let reopened = host
        .state
        .artifacts
        .lock()
        .unwrap()
        .clone()
        .scoped(&request.workspace_id)
        .unwrap()
        .get("programming", saved["artifact"]["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(reopened.content, "aGVsbG8=");
    host.close_workspace(&request.workspace_id).unwrap();
    let prepare_after_close: Value = client
        .post(&url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&fresh_prepare)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        prepare_after_close["error"]["code"],
        "result_workspace_closed"
    );
    let commit_after_close: Value = client
        .post(&commit_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({"scope":status_body["scope"],"grantId":fresh_grant["grantId"],"confirmed":true}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        commit_after_close["error"]["code"],
        "result_workspace_closed"
    );
    host.stop_and_wait().await.unwrap();

    // A new Host instance must recover the receipt from the same on-disk
    // artifact store; its in-memory result and save-grant stores are empty.
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let restarted = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let status_after_restart: Value = client
        .post(format!(
            "{}/v2/plugin-results/save-status",
            restarted.origin()
        ))
        .header("x-zicode-desktop-token", restarted.desktop_token())
        .json(&status_body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status_after_restart["status"], "saved");
    assert_eq!(status_after_restart["artifactId"], saved["artifact"]["id"]);
    let commit_after_restart = client
        .post(format!("{}/v2/plugin-results/commit-save", restarted.origin()))
        .header("x-zicode-desktop-token", restarted.desktop_token())
        .json(&json!({"scope":status_body["scope"],"grantId":status_body["grantId"],"confirmed":true}))
        .send()
        .await
        .unwrap();
    assert_eq!(commit_after_restart.status(), StatusCode::CONFLICT);
    let after_restart = restarted
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(&request.workspace_id)
        .unwrap()
        .list("programming", None, None, None)
        .unwrap();
    assert_eq!(after_restart.artifacts.len(), 1);
    restarted.stop_and_wait().await.unwrap();
    let output = crate::process_command::new_command(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "host_server::plugin_results::tests::save_status_process_child",
            "--nocapture",
        ])
        .env("ZICODE_RESULT_SAVE_TEST_CHILD_ROOT", &root)
        .env("ZICODE_RESULT_SAVE_TEST_STATUS", status_body.to_string())
        .env(
            "ZICODE_RESULT_SAVE_TEST_ARTIFACT",
            saved["artifact"]["id"].as_str().unwrap(),
        )
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "stdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&output.stdout)
            .contains("test host_server::plugin_results::tests::save_status_process_child ... ok"),
        "child test did not run: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    std::fs::remove_dir_all(root).unwrap();
}

use super::*;
use crate::metadata_store::MetadataStore;

#[tokio::test]
async fn actual_http_save_requires_confirmation_scope_current_source_and_is_idempotent() {
    exercise_save(false).await;
}

#[tokio::test]
#[ignore = "requires ZICODE_TEST_WORKER_EXE; uses actual frozen DevTools WASI"]
async fn actual_worker_output_can_be_confirmed_and_saved_over_http() {
    exercise_save(true).await;
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
    let host = HostServer::start(public, NativePiManager::new(16), auth)
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
        let (entry, _) = registry.plugin_runtime_entry("programming", plugin).unwrap();
        let module = module_snapshot::read(&entry).unwrap();
        assert_eq!(source_proof_from_module(&registry, &request, &module).unwrap(), source_proof(&registry, &request).unwrap());
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
        registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", false).unwrap();
        registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", true).unwrap();
        registry.set_enabled("programming", "com.zicode.artifacts", true).unwrap();
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
    commit["grantId"] = fresh_grant["grantId"].clone();
    let saved: Value = send(commit.clone()).await.unwrap().json().await.unwrap();
    assert!(
        saved.get("artifact").is_some(),
        "save rejected: {}",
        saved["error"]["code"]
    );
    assert_eq!(saved["artifact"]["content"], "aGVsbG8=");
    assert_eq!(saved["replayed"], false);
    let replay: Value = send(commit).await.unwrap().json().await.unwrap();
    assert_eq!(replay["artifact"]["id"], saved["artifact"]["id"]);
    assert_eq!(replay["replayed"], true);
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
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

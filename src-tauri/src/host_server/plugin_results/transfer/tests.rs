use super::*;
use crate::metadata_store::MetadataStore;

#[tokio::test]
#[ignore = "requires delivered WASI Worker; separate installed package identities"]
async fn actual_cross_package_text_transfer_is_scoped_confirmed_and_idempotent() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("result-transfer-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(root.join("owner.json"), json!({"purpose":"real cross-package WASI transfer boundary","lifetime":"remove on success; keep failures"}).to_string()).unwrap();
    // Derived receiver fixture with a distinct installed identity, not a second provider implementation.
    let source = project.join("tests/fixtures/devtools-text-dev57");
    let receiver = root.join("receiver");
    fixture::create_receiver(&source, &receiver);
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for package in [&source, &receiver] {
            let descriptor = registry.install_developer(package).unwrap();
            registry
                .set_enabled("programming", &descriptor, true)
                .unwrap();
        }
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap(),
    ));
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |path: &str, body: Value| {
        client
            .post(format!("{}{path}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let scope = json!({"workspaceId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","sceneId":"programming","pluginId":"com.zicode.devtools.text","capabilityId":"devtools.text.json.minify"});
    let mut invocation = scope.clone();
    invocation["input"] = json!({"text":" {\"b\":2,\"a\":1} "});
    invocation["captureResult"] = json!(true);
    let response: Value = post("/v2/plugin-capabilities/invoke", invocation)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["result"]["data"]["text"], "{\"a\":1,\"b\":2}");
    let search_body =
        json!({"scope":scope,"resultId":response["resultRef"]["resultId"],"query":"","offset":0});
    let found: Value = post("/v2/plugin-results/targets", search_body.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(found["total"], 10);
    assert_eq!(found["items"].as_array().unwrap().len(), 10);
    assert!(found["items"][0].get("inputSchema").is_none());
    let mut stale_search = search_body;
    stale_search["revision"] = json!("stale");
    assert_eq!(
        post("/v2/plugin-results/targets", stale_search)
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let mut prepare = json!({"scope":scope,"resultId":response["resultRef"]["resultId"],
        "target":{"pluginId":"com.zicode.devtools.echo","capabilityId":"devtools.text.base64.encode"},"field":"text"});
    prepare["field"] = json!("undeclared");
    assert_eq!(
        post("/v2/plugin-results/prepare-transfer", prepare.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    prepare["field"] = json!("text");
    let prepared: Value = post("/v2/plugin-results/prepare-transfer", prepare.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(prepared["preview"]["text"], "{\"a\":1,\"b\":2}");
    let mut commit = json!({"scope":scope,"grantId":prepared["grantId"],"confirmed":false});
    assert_eq!(
        post("/v2/plugin-results/commit-transfer", commit.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    commit["confirmed"] = json!(true);
    commit["scope"]["workspaceId"] = json!("ffffffff-ffff-4fff-8fff-ffffffffffff");
    assert_eq!(
        post("/v2/plugin-results/commit-transfer", commit.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    commit["scope"] = scope.clone();
    let sent: Value = post("/v2/plugin-results/commit-transfer", commit.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(sent["result"]["data"]["text"], "eyJhIjoxLCJiIjoyfQ==");
    let replay: Value = post("/v2/plugin-results/commit-transfer", commit.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replay["resultRef"], sent["resultRef"]);
    assert_eq!(replay["replayed"], true);
    // Receiver output becomes a scoped source for the next independently confirmed operation.
    let receiver_scope = json!({"workspaceId":scope["workspaceId"],"sceneId":"programming","pluginId":"com.zicode.devtools.echo","capabilityId":"devtools.text.base64.encode"});
    let next: Value = post("/v2/plugin-results/prepare-transfer", json!({"scope":receiver_scope,"resultId":sent["resultRef"]["resultId"],"target":{"pluginId":"com.zicode.devtools.text","capabilityId":"devtools.text.base64.decode"},"field":"text"})).await.unwrap().json().await.unwrap();
    let decoded: Value = post(
        "/v2/plugin-results/commit-transfer",
        json!({"scope":receiver_scope,"grantId":next["grantId"],"confirmed":true}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(decoded["result"]["data"]["text"], "{\"a\":1,\"b\":2}");
    for _ in 2..MAX_GRANTS {
        assert!(post("/v2/plugin-results/prepare-transfer", prepare.clone())
            .await
            .unwrap()
            .status()
            .is_success());
    }
    assert_eq!(
        post("/v2/plugin-results/prepare-transfer", prepare.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.echo", false)
            .unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.echo", true)
            .unwrap();
    }
    assert_eq!(
        post("/v2/plugin-results/commit-transfer", commit.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert_eq!(
        post("/v2/plugin-results/prepare-transfer", prepare.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let unauthorized = client
        .post(format!(
            "{}/v2/plugin-results/commit-transfer",
            host.origin()
        ))
        .json(&commit)
        .send()
        .await
        .unwrap();
    assert!(!unauthorized.status().is_success());
    assert!(host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(scope["workspaceId"].as_str().unwrap())
        .unwrap()
        .list("programming", None, None, None)
        .unwrap()
        .artifacts
        .is_empty());
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn transfer_expiration_removes_pending_grants() {
    let scope = Scope {
        workspace_id: "workspace".into(),
        scene_id: "programming".into(),
        plugin_id: "source".into(),
        capability_id: "text".into(),
    };
    let mut store = Transfers::default();
    store.grants.insert(
        "old".into(),
        Grant {
            scope: scope.clone(),
            result_id: "id".into(),
            source_proof: "proof".into(),
            target_scope: scope,
            target_proof: "proof".into(),
            field: "text".into(),
            inputs: serde_json::Map::new(),
            expires: Instant::now(),
            response: None,
        },
    );
    store.prune();
    assert!(store.grants.is_empty());
}

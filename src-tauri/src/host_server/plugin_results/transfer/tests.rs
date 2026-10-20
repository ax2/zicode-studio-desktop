use super::*;
use crate::metadata_store::MetadataStore;
use base64::Engine;

#[tokio::test]
#[ignore = "requires current ZICODE_TEST_WORKER_EXE; frozen Diagnostics 0.1.4 to Text result transfer"]
async fn diagnostics_report_transfers_to_text_and_saves_only_after_confirmation() {
    use sha2::{Digest, Sha256};

    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project.join(".cache/task-scratch").join(format!(
        "diagnostics-result-transfer-{}",
        uuid::Uuid::new_v4()
    ));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose":"frozen Diagnostics 0.1.4 real Worker result transfer and save",
            "retention":"keep compact isolated synthetic evidence for acceptance audit"})
        .to_string(),
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let source = "com.zicode.devtools.diagnostics";
    let receiver = "com.zicode.devtools.text";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (id, path) in [
            (source, "devtools-diagnostics-0.1.4-candidate-01"),
            (receiver, "devtools-text-dev57"),
        ] {
            assert_eq!(
                registry
                    .install_developer(&project.join("tests/fixtures").join(path))
                    .unwrap(),
                id
            );
            registry.set_enabled("programming", id, true).unwrap();
        }
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
    let workspace = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    let source_scope = json!({"workspaceId":workspace,"sceneId":"programming",
        "pluginId":source,"capabilityId":"devtools.diagnostics.java.threads"});
    let sample =
        "\"worker\" #1 nid=0x1\n java.lang.Thread.State: RUNNABLE\n at app.Main.run(Main.java:1)";
    let mut invoke = source_scope.clone();
    invoke["input"] = json!({"text":sample});
    invoke["captureResult"] = json!(true);
    let produced: Value = post("/v2/plugin-capabilities/invoke", invoke)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(produced["result"]["ok"], true, "{produced}");
    let report = produced["result"]["data"]["text"].as_str().unwrap();
    assert!(serde_json::from_str::<Value>(report).unwrap().is_object());
    let result_id = produced["resultRef"]["resultId"].as_str().unwrap();
    let prepared: Value = post(
        "/v2/plugin-results/prepare-transfer",
        json!({"scope":source_scope,"resultId":result_id,
            "target":{"pluginId":receiver,"capabilityId":"devtools.text.base64.encode"},
            "field":"text"}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(prepared["preview"]["text"], report);
    let transfer = json!({"scope":source_scope,"grantId":prepared["grantId"],"confirmed":false});
    assert_eq!(
        post("/v2/plugin-results/commit-transfer", transfer.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let mut confirmed_transfer = transfer;
    confirmed_transfer["confirmed"] = json!(true);
    let sent: Value = post("/v2/plugin-results/commit-transfer", confirmed_transfer)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let expected = base64::engine::general_purpose::STANDARD.encode(report);
    assert_eq!(sent["result"]["data"]["text"], expected, "{sent}");
    let receiver_scope = json!({"workspaceId":workspace,"sceneId":"programming",
        "pluginId":receiver,"capabilityId":"devtools.text.base64.encode"});
    let save: Value = post(
        "/v2/plugin-results/prepare-save",
        json!({"scope":receiver_scope,"resultId":sent["resultRef"]["resultId"],
            "title":"Synthetic Diagnostics Report"}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(save["preview"]["text"], expected);
    let mut commit = json!({"scope":receiver_scope,"grantId":save["grantId"],"confirmed":false});
    assert_eq!(
        post("/v2/plugin-results/commit-save", commit.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert!(host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(workspace)
        .unwrap()
        .list("programming", None, None, None)
        .unwrap()
        .artifacts
        .is_empty());
    commit["confirmed"] = json!(true);
    let saved: Value = post("/v2/plugin-results/commit-save", commit)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(saved["artifact"]["content"], expected, "{saved}");
    assert_eq!(
        host.state
            .artifacts
            .lock()
            .unwrap()
            .scoped(workspace)
            .unwrap()
            .list("programming", None, None, None)
            .unwrap()
            .artifacts
            .len(),
        1
    );
    let rejected: Value = post(
        "/v2/plugin-capabilities/invoke",
        json!({"workspaceId":workspace,"sceneId":"programming","pluginId":source,
            "capabilityId":"devtools.diagnostics.java.jfr_json",
            "captureResult":true,"input":{"text":"not-json"}}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(rejected["result"]["ok"], false, "{rejected}");
    assert_eq!(rejected["result"]["error"]["code"], "INVALID_REPORT");
    assert!(rejected.get("resultRef").is_none());
    let control: Value = post(
        "/v2/plugin-capabilities/invoke",
        json!({"workspaceId":workspace,"sceneId":"programming","pluginId":receiver,
            "capabilityId":"devtools.text.base64.encode","input":{"text":"still available"}}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(control["result"]["data"]["text"], "c3RpbGwgYXZhaWxhYmxl");
    std::fs::write(
        root.join("receipt.json"),
        serde_json::to_vec_pretty(&json!({"source":source,"receiver":receiver,
            "realWorker":true,"reportSha256":format!("{:x}",Sha256::digest(report.as_bytes())),
            "previewMatched":true,"transferRequiredConfirmation":true,
            "savedOnlyAfterConfirmation":true,"artifactId":saved["artifact"]["id"],
            "invalidReportDidNotCapture":true,"independentToolAfterError":true,
            "nativeUiVerified":false,"crossPlatformVerified":false}))
        .unwrap(),
    )
    .unwrap();
    host.stop_and_wait().await.unwrap();
    eprintln!("Diagnostics result transfer evidence: {}", root.display());
}

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
        post(
            "/v2/plugin-results/transfer-status",
            json!({"scope":scope,"grantId":commit["grantId"]})
        )
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
            in_progress: false,
            cancelled: Arc::new(AtomicBool::new(false)),
            response: None,
        },
    );
    store.prune();
    assert!(store.grants.is_empty());
}

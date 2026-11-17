//! Exercises the provider's frozen file digest module and the built-in receiving tool.
use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a receipt-verified Files candidate and retained production Worker"]
async fn file_digest_report_handoff_requires_confirmation_and_all_original_grants() {
    let env_path = |name: &str| PathBuf::from(std::env::var_os(name).expect(name));
    let package = env_path("ZICODE_TEST_FILES_PACKAGE");
    let executable = env_path("ZICODE_TEST_RESOURCE_WORKER_EXE");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("file-report-http-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"File digest report transfer integration test"}"#,
    )
    .unwrap();
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
    let target = RuntimeTarget::new(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "file-report-session",
        "file-report-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    const FILES: &str = "com.zicode.devtools.files";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), FILES);
        registry
            .set_permission("programming", FILES, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", FILES, true).unwrap();
    }
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let sender = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":FILES,"capabilityId":"devtools.files.hash"});
    let receiver = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":"com.zicode.text-inspector","capabilityId":"text.inspect"});
    let first = output_http::material(&host, &client, &sender, b"abc").await;
    let second = output_http::material(&host, &client, &sender, b"modified").await;
    let post = |route, request| output_http::post(&host, &client, route, request);
    let request = json!({"schemaVersion":1,"access":first,"additionalAccesses":[second],"input":{
        "expected":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    }});
    let response = post("prepare-call", request.clone()).await;
    let status = response.status();
    let ticket: Value = response.json().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{ticket}");
    let response = post(
        "invoke-call",
        json!({"access":first,"additionalAccesses":[second],"callId":ticket["callId"],
            "hostInstanceId":ticket["hostInstanceId"],"input":request["input"]}),
    )
    .await;
    let status = response.status();
    let operation: Value = response.json().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{operation}");
    let report = &operation["reportResource"];
    assert_eq!(report["profile"], "resource.host.file-digest-report.draft1");
    assert_eq!(
        report["derivedFromAll"][0]["resourceId"],
        first["resourceId"]
    );
    assert_eq!(
        report["derivedFromAll"][1]["resourceId"],
        second["resourceId"]
    );
    assert_eq!(operation["result"]["files"][0]["matches"], true);
    assert_eq!(operation["result"]["files"][1]["matches"], false);
    let source = json!({"schemaVersion":1,"owner":sender,"resourceId":report["resourceId"],"contentVersion":report["contentVersion"]});
    let prepare = post(
        "prepare-transfer",
        json!({"schemaVersion":1,"source":source,"target":receiver}),
    )
    .await;
    let status = prepare.status();
    let prompt: Value = prepare.json().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{prompt}");
    assert_eq!(prompt["requiresConfirmation"], true);
    assert_eq!(prompt["mimeType"], "application/json");
    let commit = |confirmed| {
        post(
            "commit-transfer",
            json!({"schemaVersion":1,"source":source,"grantId":prompt["grantId"],"confirmed":confirmed}),
        )
    };
    let denied = commit(false).await;
    assert_eq!(
        denied.json::<Value>().await.unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    let events_before = host
        .state
        .plugin_resource_workers
        .events
        .lock()
        .unwrap()
        .len();
    let confirmed = commit(true).await;
    let status = confirmed.status();
    let transfer: Value = confirmed.json().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{transfer}");
    assert_eq!(
        host.state
            .plugin_resource_workers
            .events
            .lock()
            .unwrap()
            .len(),
        events_before
    );
    let access = json!({"schemaVersion":1,"owner":receiver,"resourceId":transfer["reference"]["resourceId"],"contentVersion":transfer["reference"]["contentVersion"]});
    let invoke = || {
        post(
            "invoke-view",
            json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
        )
    };
    let response = invoke().await;
    let status = response.status();
    let received: Value = response.json().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{received}");
    assert_eq!(received["result"]["mimeType"], "application/json");
    let report_text = received["result"]["text"].as_str().unwrap();
    assert_eq!(sha256_hex(report_text.as_bytes()), report["contentVersion"]);
    let material: Value = serde_json::from_str(report_text).unwrap();
    assert_eq!(material, operation["result"]);
    assert_eq!(
        post("revoke", second.clone()).await.status(),
        StatusCode::OK
    );
    assert_ne!(invoke().await.status(), StatusCode::OK);
    assert_eq!(
        post("read-view", json!({"access":first,"offset":0,"length":1}))
            .await
            .status(),
        StatusCode::OK
    );
    host.stop_and_wait().await.unwrap();
}

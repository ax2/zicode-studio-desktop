//! Real Host HTTP authorization path for the cross-platform text receiver.
use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn text_resource_requires_confirmed_transfer_and_executes_in_host() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("host-text-http-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"Studio text resource Host HTTP test"}"#,
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "ffffeeee-dddd-4ddd-8ddd-eeeeffffffff",
        "text-resource-test",
        "text-resource-instance",
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
    host.state.plugin_tokens.lock().unwrap().insert(
        issued.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(b"text-resource-test-credential"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "text-resource-session")
        .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let source_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":"com.zicode.resource-inspector","capabilityId":"image.inspect"});
    let receiver_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":"com.zicode.text-inspector","capabilityId":"text.inspect"});
    let source = output_http::material_with_mime(
        &host,
        &client,
        &source_owner,
        "text/plain",
        b"ZiCode OCR test 2026",
    )
    .await;
    let incompatible =
        output_http::material_with_mime(&host, &client, &source_owner, "text/html", b"<p>text</p>")
            .await;
    let rejected = output_http::post(
        &host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":incompatible,"target":receiver_owner}),
    )
    .await;
    assert_ne!(rejected.status(), StatusCode::OK);
    let prepared = output_http::post(
        &host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":source,"target":receiver_owner}),
    )
    .await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared = prepared.json::<Value>().await.unwrap();
    assert_eq!(prepared["requiresConfirmation"], true);
    let denied = output_http::post(
        &host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":false}),
    )
    .await;
    assert_ne!(denied.status(), StatusCode::OK);
    let committed = output_http::post(
        &host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":true}),
    )
    .await;
    assert_eq!(committed.status(), StatusCode::OK);
    let committed = committed.json::<Value>().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":receiver_owner,
        "resourceId":committed["reference"]["resourceId"],
        "contentVersion":committed["reference"]["contentVersion"]});
    let response = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let result = response.json::<Value>().await.unwrap();
    assert_eq!(result["source"]["profile"], "resource.host.text-input.v1");
    assert_eq!(result["result"]["text"], "ZiCode OCR test 2026");
    assert_eq!(result["result"]["charCount"], 20);
    assert_eq!(result["result"]["truncated"], false);
    assert!(result.get("resources").is_none());
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

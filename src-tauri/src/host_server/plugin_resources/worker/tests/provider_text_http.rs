//! Frozen ZiDevTools text receiver through the real Studio Host and Worker.
use super::*;
use sha2::{Digest, Sha256};

#[test]
fn frozen_devtools_url_text_010_is_rejected_for_missing_profiles() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("url-text-legacy-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"legacy URL text package profile rejection","lifetime":"remove on success"}"#,
    )
    .unwrap();
    let mut registry = crate::plugin_registry::PluginRegistry::open(root.join("registry")).unwrap();
    let error = registry
        .install_developer(&project.join("tests/fixtures/devtools-url-text-resource-candidate02"))
        .unwrap_err();
    assert!(error.contains("Missing requiredProfiles declarations"));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_RESOURCE_WORKER_EXE from the current Studio build"]
async fn frozen_devtools_url_text_011_receiver_runs_after_explicit_transfer() {
    run_frozen_devtools_url_text_receiver(
        "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/url-text-resource-0.1.1-candidate-01",
        "tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/url-text-resource-0.1.1-candidate-01-verification.json",
    )
    .await;
}

async fn run_frozen_devtools_url_text_receiver(fixture_path: &str, receipt_path: &str) {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    assert!(executable.is_file());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let fixture = project.join(fixture_path);
    let receipt: Value =
        serde_json::from_slice(&std::fs::read(project.join(receipt_path)).unwrap()).unwrap();
    let mut pending = vec![fixture.clone()];
    let mut count = 0;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            let kind = entry.file_type().unwrap();
            assert!(!kind.is_symlink());
            if kind.is_dir() {
                pending.push(entry.path());
            } else {
                count += 1;
            }
        }
    }
    assert_eq!(count, receipt["files"].as_array().unwrap().len());
    for file in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(fixture.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["size"].as_u64().unwrap());
        assert_eq!(format!("{:x}", Sha256::digest(bytes)), file["sha256"]);
    }

    let root = project
        .join(".cache/task-scratch")
        .join(format!("url-text-provider-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"frozen DevTools text receiver Host/Worker HTTP acceptance","lifetime":"remove on success; keep on failure"}"#,
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "ffffeeee-dddd-4ddd-8ddd-eeeeffffffff",
        "url-text-provider-test",
        "url-text-provider-instance",
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
            token_hash: sha256_hex(b"url-text-provider-credential"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "url-text-provider-session")
        .unwrap();
    let plugin = "com.zicode.devtools.url-text-resource";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&fixture).unwrap(), plugin);
        registry
            .set_permission("programming", plugin, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let source_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":"com.zicode.resource-inspector","capabilityId":"image.inspect"});
    let receiver_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":plugin,"capabilityId":"devtools.transforms.url.encode"});
    let source = output_http::material_with_mime(
        &host,
        &client,
        &source_owner,
        "text/plain",
        b"ZiCode OCR test 2026",
    )
    .await;
    let html =
        output_http::material_with_mime(&host, &client, &source_owner, "text/html", b"<p>text</p>")
            .await;
    let wrong_mime = output_http::post(
        &host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":html,"target":receiver_owner}),
    )
    .await;
    assert_ne!(wrong_mime.status(), StatusCode::OK);
    let prepared = output_http::post(
        &host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":source,"target":receiver_owner}),
    )
    .await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared: Value = prepared.json().await.unwrap();
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
    let committed: Value = committed.json().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":receiver_owner,
        "resourceId":committed["reference"]["resourceId"],
        "contentVersion":committed["reference"]["contentVersion"]});
    let before = host.state.plugin_resources.lock().unwrap().record_count();
    let response = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let result = response.json::<Value>().await.unwrap();
    assert_eq!(result["source"]["profile"], "resource.wasi.input.draft2");
    assert_eq!(
        result["result"]["encodedText"],
        "ZiCode%20OCR%20test%202026"
    );
    assert_eq!(result["result"]["sourceByteCount"], 20);
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

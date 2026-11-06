//! Frozen independent production metadata package through real Host HTTP and Worker.
use super::*;
use sha2::{Digest, Sha256};
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires current Worker executable and generated metadata conformance fixture directory"]
async fn metadata_frozen_provider_real_http_large_save_library_and_authority() {
    let fixture_path = "tests/fixtures/devtools-image-metadata-0.1.0-candidate-01";
    let receipt_path =
        "tests/fixtures/devtools-image-metadata-0.1.0-candidate-01-verification.json";
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
        .join(format!("image-metadata-provider-{}", uuid::Uuid::new_v4()));
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
        "image-metadata-provider-test",
        "image-metadata-provider-instance",
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
            token_hash: sha256_hex(b"image-metadata-provider-credential"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "image-metadata-provider-session")
        .unwrap();
    let plugin = "com.zicode.devtools.image.metadata";
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

    let vectors =
        PathBuf::from(std::env::var_os("ZICODE_TEST_METADATA_FIXTURE_DIRECTORY").unwrap());
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", "com.zicode.artifacts", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.artifacts",
                "storage.plugin",
                true,
            )
            .unwrap();
    }
    let request = |path: &'static str, body: Value| output_http::post(&host, &client, path, body);
    let mut receipt = Vec::new();
    for (name, expected, capability) in [
        (
            "metadata-png-6.png",
            "0e3b103bd63eaeb23c424c94e675ad9a96ca5790fcf7ca1f63d7bd2814386fc0",
            "devtools.image.metadata.inspect",
        ),
        (
            "palette-16m-pixels.png",
            "812407beeac08fa1ececd09f605ab8ef4df18b6acea6adfea1f48eb7c687e811",
            "devtools.image.metadata.clean",
        ),
    ] {
        let bytes = std::fs::read(vectors.join(name)).unwrap();
        assert_eq!(sha256_hex(&bytes), expected);
        let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin,"capabilityId":capability});
        let source =
            output_http::material_with_mime(&host, &client, &owner, "image/png", &bytes).await;
        let before = host.state.plugin_resources.lock().unwrap().record_count();
        let input = if capability.ends_with("clean") {
            json!({"quality":85})
        } else {
            json!({})
        };
        let response = request(
            "invoke-view",
            json!({"access":source,"toolCallId":uuid::Uuid::new_v4(),"input":input}),
        )
        .await;
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{}",
            response.text().await.unwrap()
        );
        let value = response.json::<Value>().await.unwrap();
        assert_eq!(value["result"]["ok"], true, "{value}");
        assert_eq!(value["outputProfile"], "resource.wasi.output.draft2");
        let outputs = value["resources"].as_array().unwrap();
        assert_eq!(
            outputs.len(),
            if capability.ends_with("clean") { 2 } else { 1 }
        );
        if capability.ends_with("inspect") {
            assert_eq!(value["result"]["report"]["source"]["displayWidth"], 7);
            assert_eq!(value["result"]["report"]["source"]["displayHeight"], 12);
        }
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            before + outputs.len()
        );
        let full = &outputs[0];
        let derived = json!({"schemaVersion":1,"owner":owner,"resourceId":full["resourceId"],"contentVersion":full["contentVersion"]});
        let mut wrong = derived.clone();
        wrong["owner"]["sessionId"] = json!("another-session");
        assert!(
            !request("read-view", json!({"access":wrong,"offset":0,"length":32}))
                .await
                .status()
                .is_success()
        );
        let mut readback = Vec::new();
        for offset in (0..full["byteLength"].as_u64().unwrap()).step_by(32768) {
            let response = request(
                "read-view",
                json!({"access":derived,"offset":offset,"length":32768}),
            )
            .await;
            assert_eq!(response.status(), StatusCode::OK);
            let chunk = response.json::<Value>().await.unwrap();
            readback.extend(
                base64::engine::general_purpose::STANDARD
                    .decode(chunk["dataBase64"].as_str().unwrap())
                    .unwrap(),
            );
        }
        assert_eq!(sha256_hex(&readback), full["contentVersion"]);
        if capability.ends_with("clean") {
            assert_eq!(readback.len(), 48007728);
            let prepared =
                request("prepare-save", json!({"schemaVersion":1,"source":derived})).await;
            assert_eq!(prepared.status(), StatusCode::OK);
            let prepared = prepared.json::<Value>().await.unwrap();
            let path = workspace.join(prepared["preview"]["relativePath"].as_str().unwrap());
            assert!(!path.exists());
            let mut commit = json!({"schemaVersion":1,"source":derived,"grantId":prepared["grantId"],"confirmed":false});
            assert!(!request("commit-save", commit.clone())
                .await
                .status()
                .is_success());
            assert!(!path.exists());
            commit["confirmed"] = json!(true);
            let saved = request("commit-save", commit.clone()).await;
            assert_eq!(saved.status(), StatusCode::OK);
            let saved = saved.json::<Value>().await.unwrap();
            assert_eq!(
                saved["receipt"]["profile"],
                "resource.save.image-metadata.v1"
            );
            assert_eq!(std::fs::read(&path).unwrap(), readback);
            let replay = request("commit-save", commit.clone())
                .await
                .json::<Value>()
                .await
                .unwrap();
            assert_eq!(replay["replayed"], true);
            let get = |route: &str| {
                client
                    .get(format!("{}/v2/plugin-resources/{route}", host.origin()))
                    .header("x-zicode-desktop-token", host.desktop_token())
                    .query(&[
                        ("schemaVersion", "1"),
                        ("sceneId", "programming"),
                        ("workspaceId", target.workspace_id.as_str()),
                    ])
            };
            let list = get("saved-outputs")
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap();
            let item = list["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|item| item["receipt"]["saveId"] == saved["receipt"]["saveId"])
                .unwrap();
            let download = get("saved-output")
                .query(&[
                    ("saveId", item["receipt"]["saveId"].as_str().unwrap()),
                    ("receiptVersion", item["receiptVersion"].as_str().unwrap()),
                ])
                .send()
                .await
                .unwrap();
            assert_eq!(download.status(), StatusCode::OK);
            assert_eq!(download.bytes().await.unwrap().as_ref(), readback);
            std::fs::write(&path, b"fixture user edit preserved").unwrap();
            assert!(!request("commit-save", commit).await.status().is_success());
            assert_eq!(
                std::fs::read(&path).unwrap(),
                b"fixture user edit preserved"
            );
            assert!(!get("saved-output")
                .query(&[
                    ("saveId", item["receipt"]["saveId"].as_str().unwrap()),
                    ("receiptVersion", item["receiptVersion"].as_str().unwrap())
                ])
                .send()
                .await
                .unwrap()
                .status()
                .is_success());
        }
        assert_eq!(
            request("revoke", source.clone()).await.status(),
            StatusCode::OK
        );
        assert!(!request(
            "read-view",
            json!({"access":derived,"offset":0,"length":32})
        )
        .await
        .status()
        .is_success());
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            before - 1
        );
        receipt.push(
            json!({"fixture":name,"operation":capability,"bytes":readback.len(),"passed":true}),
        );
    }
    // A permission loss is checked before running even an otherwise valid input.
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin,"capabilityId":"devtools.image.metadata.inspect"});
    let bytes = std::fs::read(vectors.join("metadata-png-6.png")).unwrap();
    let source = output_http::material_with_mime(&host, &client, &owner, "image/png", &bytes).await;
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", plugin, "resource.read", false)
        .unwrap();
    assert!(!request(
        "invoke-view",
        json!({"access":source,"toolCallId":uuid::Uuid::new_v4(),"input":{}})
    )
    .await
    .status()
    .is_success());
    println!(
        "metadata Host HTTP acceptance: {}",
        json!({"passed":true,"vectors":receipt,"explicitSave":true,"libraryDigestReadback":true,"noOverwrite":true,"identityAndPermission":true,"ancestorRevocation":true,"userDataUsed":false})
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    let canonical = root.canonicalize().unwrap();
    assert!(canonical.starts_with(project.join(".cache/task-scratch").canonicalize().unwrap()));
    std::fs::remove_dir_all(canonical).unwrap();
}

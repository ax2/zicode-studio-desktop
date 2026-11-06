//! Frozen independent Markdown bytes through the real HTTP Host and production Worker.
use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires frozen Markdown candidate, generated fixtures/proof and current production Worker"]
async fn markdown_frozen_real_http_full_html_save_and_authority() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let vectors = PathBuf::from(std::env::var_os("ZICODE_TEST_MARKDOWN_FIXTURES").unwrap());
    let proof_bytes =
        std::fs::read(std::env::var_os("ZICODE_TEST_MARKDOWN_PROOF").unwrap()).unwrap();
    let proof: Value = serde_json::from_slice(&proof_bytes).unwrap();
    assert_eq!(proof["passed"], true);
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let fixture = project.join("tests/fixtures/devtools-markdown-0.1.0-candidate-01");
    let receipt: Value = serde_json::from_slice(
        &std::fs::read(
            project.join("tests/fixtures/devtools-markdown-0.1.0-candidate-01-verification.json"),
        )
        .unwrap(),
    )
    .unwrap();
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
    assert_eq!(count, receipt["fileCount"].as_u64().unwrap());
    for item in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(fixture.join(item["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, item["size"].as_u64().unwrap());
        assert_eq!(sha256_hex(&bytes), item["sha256"]);
    }
    let module = std::fs::read(fixture.join("runtime/tools.wasm")).unwrap();
    let provenance: Value =
        serde_json::from_slice(&std::fs::read(fixture.join("provenance.json")).unwrap()).unwrap();
    assert_eq!(proof["module"]["sha256"], sha256_hex(&module));
    assert_eq!(provenance["preFreezeProofSha256"], sha256_hex(&proof_bytes));

    let root = project
        .join(".cache/task-scratch")
        .join(format!("markdown-host-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), br#"{"purpose":"Markdown Host HTTP acceptance","lifetime":"retain failure; remove on success"}"#).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "ffffeeee-dddd-4ddd-8ddd-eeeeffffffff",
        "markdown-host-test",
        "markdown-host-instance",
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
            token_hash: sha256_hex(b"generated-markdown-test-only-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "markdown-host-session")
        .unwrap();
    let plugin = "com.zicode.devtools.markdown";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&fixture).unwrap(), plugin);
        registry
            .set_permission("programming", plugin, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", plugin, true).unwrap();
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
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin,"capabilityId":"devtools.markdown.render"});
    let request = |path: &'static str, body: Value| output_http::post(&host, &client, path, body);
    let mut checked = Vec::new();
    for (name, mime) in [
        ("empty.md", "text/plain"),
        ("structures.md", "application/octet-stream"),
        ("expanded-2m.md", "text/html"),
    ] {
        let bytes = std::fs::read(vectors.join(name)).unwrap();
        let source = output_http::material_with_mime(&host, &client, &owner, mime, &bytes).await;
        let before = host.state.plugin_resources.lock().unwrap().record_count();
        let response = request(
            "invoke-view",
            json!({"access":source,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
        )
        .await;
        let status = response.status();
        let value = response.json::<Value>().await.unwrap();
        assert_eq!(status, StatusCode::OK, "{value}");
        assert_eq!(value["result"]["ok"], true, "{value}");
        assert_eq!(value["outputProfile"], "resource.wasi.output.draft1");
        let outputs = value["resources"].as_array().unwrap();
        assert_eq!(outputs.len(), 1);
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            before + 1
        );
        let output = &outputs[0];
        let expected = proof["rows"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["fixture"] == name)
            .unwrap();
        assert_eq!(expected["nativeWasiByteIdentical"], true);
        assert_eq!(output["contentVersion"], expected["htmlSha256"]);
        assert_eq!(output["mimeType"], "text/html");
        let derived = json!({"schemaVersion":1,"owner":owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
        let mut wrong = derived.clone();
        wrong["owner"]["sessionId"] = json!("another-session");
        assert!(
            !request("read-view", json!({"access":wrong,"offset":0,"length":32}))
                .await
                .status()
                .is_success()
        );
        let mut readback = Vec::new();
        for offset in (0..output["byteLength"].as_u64().unwrap()).step_by(32768) {
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
        assert_eq!(sha256_hex(&readback), expected["htmlSha256"]);
        assert_eq!(
            readback.len() as u64,
            output["byteLength"].as_u64().unwrap()
        );
        if name == "expanded-2m.md" {
            assert!(readback.len() > 10 * 1024 * 1024);
            let prepared =
                request("prepare-save", json!({"schemaVersion":1,"source":derived})).await;
            assert_eq!(prepared.status(), StatusCode::OK);
            let prepared = prepared.json::<Value>().await.unwrap();
            let relative = prepared["preview"]["relativePath"].as_str().unwrap();
            assert!(relative.ends_with(".html"));
            let path = workspace.join(relative);
            assert!(!path.exists());
            let mut commit = json!({"schemaVersion":1,"source":derived,"grantId":prepared["grantId"],"confirmed":false});
            assert!(!request("commit-save", commit.clone())
                .await
                .status()
                .is_success());
            assert!(!path.exists());
            commit["confirmed"] = json!(true);
            let response = request("commit-save", commit.clone()).await;
            let status = response.status();
            let saved = response.json::<Value>().await.unwrap();
            assert_eq!(status, StatusCode::OK, "{saved}");
            assert_eq!(saved["receipt"]["profile"], "resource.save.draft1");
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
            std::fs::write(&path, b"generated user-edit fixture: keep me").unwrap();
            assert!(!request("commit-save", commit).await.status().is_success());
            assert_eq!(
                std::fs::read(&path).unwrap(),
                b"generated user-edit fixture: keep me"
            );
        }
        assert_eq!(std::fs::read(vectors.join(name)).unwrap(), bytes);
        assert_eq!(request("revoke", source).await.status(), StatusCode::OK);
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
        checked.push(json!({"fixture":name,"bytes":readback.len(),"nativeHtmlDigestMatched":true,"passed":true}));
    }
    // Invalid encoding is a bounded business failure; no partial HTML is admitted.
    let source =
        output_http::material_with_mime(&host, &client, &owner, "application/octet-stream", &[255])
            .await;
    let before = host.state.plugin_resources.lock().unwrap().record_count();
    let response = request(
        "invoke-view",
        json!({"access":source,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let value = response.json::<Value>().await.unwrap();
    assert_eq!(value["result"]["ok"], false);
    assert_eq!(value["result"]["error"]["code"], "MARKDOWN_FAILED");
    assert!(value.get("resources").is_none());
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before
    );
    assert_eq!(request("revoke", source).await.status(), StatusCode::OK);

    // Cancel after the real process starts; the observer only synchronizes timing.
    let source = output_http::material_with_mime(
        &host,
        &client,
        &owner,
        "text/plain",
        b"# cancellation fixture",
    )
    .await;
    let before = host.state.plugin_resources.lock().unwrap().record_count();
    let (events_tx, events_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    *host.state.plugin_resource_workers.observer.lock().unwrap() =
        Some(Arc::new(move |event, pid| {
            events_tx.send((event, pid)).unwrap();
            if event == "started" {
                release_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(10))
                    .unwrap();
            }
        }));
    let call = uuid::Uuid::new_v4();
    let builder = client
        .post(format!("{}/v2/plugin-resources/invoke-view", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({"access":source,"toolCallId":call,"input":{}}));
    let task = tokio::spawn(async move { builder.send().await.unwrap() });
    let started = events_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(started.0, "started");
    assert_eq!(
        request(
            "cancel-view",
            json!({"schemaVersion":1,"owner":owner,"toolCallId":call})
        )
        .await
        .status(),
        StatusCode::OK
    );
    release_tx.send(()).unwrap();
    let response = task.await.unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"]["code"],
        "worker_cancelled"
    );
    let events = events_rx.try_iter().collect::<Vec<_>>();
    for event in ["cancel_live", "reaped", "pipes_closed"] {
        assert!(events.contains(&(event, started.1)));
    }
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before
    );
    *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
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
        "markdown Host acceptance: {}",
        json!({"passed":true,"vectors":checked,"businessFailureNoOutputs":true,"explicitSave":true,"libraryDownloadExact":true,"replayNoOverwrite":true,"identityAndPermission":true,"ancestorRevocation":true,"realProcessCancellationReaped":true,"userDataUsed":false})
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    let canonical = root.canonicalize().unwrap();
    assert!(canonical.starts_with(project.join(".cache/task-scratch").canonicalize().unwrap()));
    std::fs::remove_dir_all(canonical).unwrap();
}

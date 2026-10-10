use super::*;
use sha2::{Digest, Sha256};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a frozen Studio Worker executable; uses isolated real DevTools WASI and HTTP"]
async fn real_wasi_worker_is_alive_at_cancel_reaped_and_next_tool_succeeds() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let delivery = executable.parent().unwrap();
    let build: Value =
        serde_json::from_slice(&std::fs::read(delivery.join("RUNTIME_HASHES.json")).unwrap())
            .unwrap();
    let record = build["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "ZiCode Studio Desktop.exe")
        .unwrap();
    assert_eq!(
        format!("{:x}", Sha256::digest(std::fs::read(&executable).unwrap())),
        record["sha256"].as_str().unwrap()
    );
    assert_eq!(
        record["sha256"],
        "e2e85f8fc120c083c833fe7fc3af895ae3e0ba90cd6cdcd5973dd4b31d3ba70d"
    );
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let source = project.join("tests/fixtures/devtools-text-dev57");
    let acceptance: Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-text-dev57.acceptance.json")).unwrap(),
    )
    .unwrap();
    for file in acceptance["files"].as_array().unwrap() {
        let bytes = std::fs::read(source.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["bytes"].as_u64().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            file["sha256"].as_str().unwrap()
        );
    }
    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("wasi-live-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"real WASI process cancellation; remove on success; retain failure"}"#,
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let target = RuntimeTarget::new("wasi-workspace", "temporary-wasi-session", "wasi-runtime");
    let runtime = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start_with_mode(
        root.join("public"),
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.text", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.devtools.text",
                "pi.tools.register",
                true,
            )
            .unwrap();
    }
    let (events_tx, events_rx) = std::sync::mpsc::channel();
    {
        let mut broker = host.state.capability_broker.lock().unwrap();
        broker.worker_executable = Some(executable);
        broker.worker_observer = Some(Arc::new(move |event, pid| {
            let _ = events_tx.send((event, pid));
        }));
    }
    let token = "isolated-wasi-cancel-token";
    host.state.plugin_tokens.lock().unwrap().insert(
        target.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(token.as_bytes()),
            target: target.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let invoke_url = format!("{}/v2/plugin-tools/invoke", host.origin());
    let cancel_url = format!("{}/v2/plugin-tools/cancel", host.origin());
    let input = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"toolCallId":"live","toolName":"devtools_text_json_format","input":{"text":"{\"a\":1}"}});
    let request_client = client.clone();
    let request_url = invoke_url.clone();
    let task = tokio::spawn(async move {
        request_client
            .post(request_url)
            .bearer_auth(token)
            .json(&input)
            .send()
            .await
            .unwrap()
    });
    let (first, events_rx) = tokio::task::spawn_blocking(move || {
        let first = events_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        (first, events_rx)
    })
    .await
    .unwrap();
    assert_eq!(first.0, "started");
    let pid = first.1;
    // Probe actual HTTP surfaces while the first Worker is still in flight.
    // Keep responses until after cancellation/cleanup, so failures retain evidence.
    let probe_started = std::time::Instant::now();
    let search_probe = client
        .post(format!("{}/v2/plugin-tools/catalog/search", host.origin()))
        .bearer_auth(token)
        .timeout(Duration::from_secs(1))
        .json(&json!({"schemaVersion":1,"runtimeId":target.instance_id,
            "sessionId":target.session_id,"query":"base64"}))
        .send();
    let independent_probe = client
        .post(&invoke_url)
        .bearer_auth(token)
        .timeout(Duration::from_secs(1))
        .json(&json!({"runtimeId":target.instance_id,
            "sessionId":target.session_id,"toolCallId":"concurrent-notes",
            "toolName":"notes_search","input":{"query":"nonexistent-isolation-probe","limit":1}}))
        .send();
    let (search_probe, independent_probe) = tokio::join!(search_probe, independent_probe);
    let probe_ms = probe_started.elapsed().as_millis();
    let search_ok = search_probe
        .as_ref()
        .is_ok_and(|response| response.status() == StatusCode::OK);
    let independent_status_ok = independent_probe
        .as_ref()
        .is_ok_and(|response| response.status() == StatusCode::OK);
    let independent_body = match independent_probe {
        Ok(response) => response.json::<Value>().await.unwrap_or(Value::Null),
        Err(_) => Value::Null,
    };
    let independent_ok =
        independent_status_ok && independent_body["result"]["matches"] == json!([]);
    // Bind the actual runtime only after its launch-session invocation started a Worker.
    let target = host
        .state
        .runtimes
        .bind_session_id(&target, "wasi-session")
        .unwrap();
    let started = std::time::Instant::now();
    let cancellation = json!({"schemaVersion":1,"runtimeId":target.instance_id,"sessionId":target.session_id,"toolCallId":"live"});
    let accepted: Value = client
        .post(&cancel_url)
        .bearer_auth(token)
        .json(&cancellation)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(accepted["status"], "requested");
    assert_eq!(accepted["executionFinished"], false);
    let response = task.await.unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"]["code"],
        "worker_cancelled"
    );
    assert!(started.elapsed() < Duration::from_secs(2));
    let events: Vec<_> = events_rx.try_iter().collect();
    for event in ["cancel_live", "reaped", "pipes_closed"] {
        assert!(
            events.contains(&(event, pid)),
            "Required real process event missing: {event}"
        );
    }
    let completed: Value = client
        .post(&cancel_url)
        .bearer_auth(token)
        .json(&cancellation)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(completed["executionFinished"], true);
    let next = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"toolCallId":"next","toolName":"devtools_text_base64_encode","input":{"text":"hello"}});
    let response = client
        .post(&invoke_url)
        .bearer_auth(token)
        .json(&next)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.json::<Value>().await.unwrap()["result"]["data"]["text"],
        "aGVsbG8="
    );
    if let Some(path) = std::env::var_os("ZICODE_TEST_CANCEL_EVIDENCE") {
        std::fs::write(path, serde_json::to_vec_pretty(&json!({
            "passed":search_ok && independent_ok,"surface":"real HTTP + source Host + frozen Studio Worker + real dev57 WASI module",
            "cancelledPid":pid,"liveAtCancellation":true,"processReaped":true,"pipesClosed":true,
            "executionFinished":true,"nextToolPassed":true,
            "sessionBoundAfterWorkerStarted":true,"cancelUsesFormalSession":true,
            "phaseBoundary":"Worker startup/compilation/compute phase not distinguished; no instruction-level interruption claim",
            "concurrentCatalogSearchPassed":search_ok,"concurrentIndependentNotesPassed":independent_ok,
            "concurrentProbeDurationMs":probe_ms,"concurrentProbeDeadlineMs":1000,
        })).unwrap()).unwrap();
    }
    assert!(
        search_ok,
        "Catalog search was blocked by the active plugin Worker"
    );
    assert!(
        independent_ok,
        "Independent Host tool was blocked by the active plugin Worker"
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

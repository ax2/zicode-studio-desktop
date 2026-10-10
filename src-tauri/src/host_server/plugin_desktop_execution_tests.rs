use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires the frozen Studio Worker executable; real HTTP/process concurrency"]
async fn native_worker_keeps_directory_and_independent_tool_live_and_rejects_changed_authority() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    assert_eq!(
        sha256_hex(&std::fs::read(&executable).unwrap()),
        "e2e85f8fc120c083c833fe7fc3af895ae3e0ba90cd6cdcd5973dd4b31d3ba70d"
    );
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("native-worker-isolation-{}", uuid::Uuid::new_v4()));
    let source = root.join("source");
    std::fs::create_dir_all(source.join("runtime")).unwrap();
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"),
        r#"{"purpose":"Studio synthetic native Worker isolation acceptance; retain on failure, remove on pass"}"#).unwrap();
    let capabilities: Vec<_> = ["wait", "echo", "timeout"].iter().map(|name| json!({
        "id":format!("fixture.{name}"),"title":name,
        "inputSchema":{"type":"object","properties":{"text":{"type":"string","maxLength":64}},
            "required":["text"],"additionalProperties":false}
    })).collect();
    std::fs::write(source.join("plugin.json"), serde_json::to_vec(&json!({
        "schemaVersion":1,"id":"com.zicode.native-isolation","name":"Studio native isolation fixture",
        "description":"Studio-owned synthetic plugin, not a DevTools delivery","version":"0.1.0",
        "publisher":"zicode","runtime":{"worker":"runtime/worker.js"},
        "contributes":{"capabilities":capabilities},"permissions":{"required":[],"optional":[]}
    })).unwrap()).unwrap();
    std::fs::write(
        source.join("runtime/worker.js"),
        r#"
zicode.capabilities.register("fixture.wait", input => {
  const started = Date.now(); while (Date.now() - started < 2500) {}
  return { text: input.text };
});
zicode.capabilities.register("fixture.echo", input => ({ text: input.text }));
zicode.capabilities.register("fixture.timeout", () => { while (true) {} });
"#,
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
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
            .set_enabled("programming", "com.zicode.native-isolation", true)
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
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let url = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let token = host.state.desktop_token.clone();
    let workspace_id = uuid::Uuid::new_v4().to_string();
    let request = |capability: &str, capture: bool| {
        json!({"sceneId":"programming","workspaceId":workspace_id,
        "pluginId":"com.zicode.native-isolation","capabilityId":format!("fixture.{capability}"),
        "input":{"text":"studio-isolation"},"captureResult":capture})
    };
    let unauthorized = client
        .post(&url)
        .json(&request("echo", false))
        .send()
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::FORBIDDEN);
    assert!(events_rx.try_recv().is_err());
    let slow = client
        .post(&url)
        .header("x-zicode-desktop-token", &token)
        .json(&request("wait", false));
    let slow_task = tokio::spawn(async move { slow.send().await.unwrap() });
    let wait_started = tokio::task::spawn_blocking(move || {
        let event = events_rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(event.0, "started");
        (event.1, events_rx)
    })
    .await
    .unwrap();
    let (slow_pid, events_rx) = wait_started;
    let probes_started = std::time::Instant::now();
    let directory = client
        .get(format!(
            "{}/v2/plugin-capabilities?sceneId=programming",
            host.origin()
        ))
        .header("x-zicode-desktop-token", &token)
        .timeout(Duration::from_secs(1))
        .send();
    let independent = client
        .post(&url)
        .header("x-zicode-desktop-token", &token)
        .timeout(Duration::from_secs(1))
        .json(&request("echo", true))
        .send();
    let (directory, independent) = tokio::join!(directory, independent);
    let directory = directory.unwrap();
    assert_eq!(directory.status(), StatusCode::OK);
    let directory: Value = directory.json().await.unwrap();
    assert!(directory["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .any(|cap| cap["id"] == "fixture.echo"));
    let independent = independent.unwrap();
    assert_eq!(independent.status(), StatusCode::OK);
    let independent: Value = independent.json().await.unwrap();
    assert_eq!(independent["result"]["text"], "studio-isolation");
    assert!(independent.get("resultRef").is_none());
    assert_eq!(
        independent["resultCaptureError"]["code"],
        "result_profile_unsupported"
    );
    let probe_ms = probes_started.elapsed().as_millis();
    assert!(
        !slow_task.is_finished(),
        "Slow Worker must still be active at the concurrent probes"
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", "com.zicode.native-isolation", false)
            .unwrap();
        registry
            .set_enabled("programming", "com.zicode.native-isolation", true)
            .unwrap();
    }
    let slow_response: Value = slow_task.await.unwrap().json().await.unwrap();
    assert_eq!(slow_response["error"]["code"], "capability_changed");
    assert!(slow_response.get("result").is_none());
    let timeout_response = client
        .post(&url)
        .header("x-zicode-desktop-token", &token)
        .timeout(Duration::from_secs(8))
        .json(&request("timeout", false))
        .send()
        .await
        .unwrap();
    let timeout_response: Value = timeout_response.json().await.unwrap();
    assert_eq!(timeout_response["error"]["code"], "worker_timeout");
    let recovered = client
        .post(&url)
        .header("x-zicode-desktop-token", &token)
        .timeout(Duration::from_secs(1))
        .json(&request("echo", false))
        .send()
        .await
        .unwrap();
    assert_eq!(recovered.status(), StatusCode::OK);
    assert_eq!(
        recovered.json::<Value>().await.unwrap()["result"]["text"],
        "studio-isolation"
    );
    let events: Vec<_> = events_rx.try_iter().collect();
    let mut pids = vec![slow_pid];
    pids.extend(
        events
            .iter()
            .filter(|event| event.0 == "started")
            .map(|event| event.1),
    );
    assert_eq!(pids.len(), 4);
    for pid in &pids {
        for phase in ["reaped", "pipes_closed"] {
            assert!(
                events.contains(&(phase, *pid)),
                "Worker {pid} missing {phase}; events: {events:?}"
            );
        }
    }
    host.stop_and_wait().await.unwrap();
    if let Some(path) = std::env::var_os("ZICODE_TEST_NATIVE_ISOLATION_EVIDENCE") {
        std::fs::write(path, serde_json::to_vec_pretty(&json!({
            "passed":true,"surface":"real HTTP/current source Host/frozen production Worker/Studio synthetic JS guest",
            "directoryWhileWorkerActive":true,"independentExternalWorkerPassed":true,
            "probeDurationMs":probe_ms,"eachProbeDeadlineMs":1000,"revokedAndRegrantedResultRejected":true,
            "unauthorizedCallRejectedBeforeWorker":true,"unsupportedResultCaptureExplicit":true,
            "timeoutRejected":true,"nextToolRecovered":true,"pids":pids,
            "workerCount":4,"reapedCount":4,"pipesClosedCount":4,"fullToolsAccepted":0,
            "notVerified":"DevTools algorithms, WASI compilation, Pi, Tauri UI, result saving, native cancellation"
        })).unwrap()).unwrap();
    }
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

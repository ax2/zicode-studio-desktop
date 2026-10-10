use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "real HTTP and retained production Worker executable"]
async fn manual_call_native_cancel_reaps_worker_and_preserves_other_plugins() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let digest = sha256_hex(&std::fs::read(&executable).unwrap());
    assert_eq!(
        digest,
        "303fd49a486b126aa363a299178b432d1bf134bcb626a5dc4f8318fb0ab98d18"
    );
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("manual-cancel-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), r#"{"purpose":"Studio manual cancellation HTTP/process verification; preserve failures, remove on pass"}"#).unwrap();
    for (name, body) in [
        ("slow", "while (true) {}"),
        ("echo", "return {text: input.text};"),
    ] {
        let source = root.join(name);
        std::fs::create_dir_all(source.join("runtime")).unwrap();
        std::fs::write(source.join("plugin.json"), serde_json::to_vec(&json!({
            "schemaVersion":1,"id":format!("com.zicode.cancel-{name}"),"name":format!("Studio {name} fixture"),
            "description":"Studio synthetic test, not DevTools delivery","version":"0.1.0","publisher":"zicode",
            "runtime":{"worker":"runtime/worker.js"},"permissions":{"required":[],"optional":[]},
            "contributes":{"capabilities":[{"id":"fixture.run","title":"Run",
            "inputSchema":{"type":"object","properties":{"text":{"type":"string","maxLength":64}},"required":["text"],"additionalProperties":false}}]}
        })).unwrap()).unwrap();
        std::fs::write(
            source.join("runtime/worker.js"),
            format!("zicode.capabilities.register('fixture.run', input => {{ {body} }});"),
        )
        .unwrap();
    }
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::from([("workspace-a".into(), root.clone())]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for name in ["slow", "echo"] {
            registry.install_developer(&root.join(name)).unwrap();
            registry
                .set_enabled("programming", &format!("com.zicode.cancel-{name}"), true)
                .unwrap();
        }
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let process_log = Mutex::new(std::fs::File::create(root.join("process-events.jsonl")).unwrap());
    {
        let mut broker = host.state.capability_broker.lock().unwrap();
        broker.worker_executable = Some(executable);
        broker.worker_observer = Some(Arc::new(move |event, pid| {
            use std::io::Write;
            if let Ok(mut file) = process_log.lock() {
                let _ = writeln!(
                    file,
                    "{}",
                    json!({"event":event,"pid":pid,"timestampMs":SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis()})
                );
            }
            let _ = tx.send((event, pid));
        }));
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap();
    let base = format!("{}/v2/plugin-capabilities", host.origin());
    let token = &host.state.desktop_token;
    let protocol_url = format!("{base}/call-protocol");
    assert_eq!(
        client.get(&protocol_url).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let protocol: Value = client
        .get(&protocol_url)
        .header("x-zicode-desktop-token", token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(protocol["profile"], "manual.tool.call.v1");
    assert_eq!(protocol["reconcileProfile"], "manual.tool.reconcile.v1");
    let directory_url = format!(
        "{}/v2/plugin-tool-directory?sceneId=programming",
        host.origin()
    );
    let directory: Value = client
        .get(&directory_url)
        .header("x-zicode-desktop-token", token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let revision = directory["revision"].as_str().unwrap();
    let request = |name: &str| {
        json!({"sceneId":"programming","workspaceId":"workspace-a",
        "pluginId":format!("com.zicode.cancel-{name}"),"capabilityId":"fixture.run",
        "catalogRevision":revision,"input":{"text":"independent"},"captureResult":false})
    };
    let prepared: Value = client
        .post(format!("{base}/prepare-call"))
        .header("x-zicode-desktop-token", token)
        .json(&request("slow"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = prepared["callId"]
        .as_str()
        .expect("Host issued call handle");
    assert!(rx.try_recv().is_err(), "prepare must not execute");
    let control = json!({"schemaVersion":1,"callId":id,"scope":{"sceneId":"programming","workspaceId":"workspace-a",
        "pluginId":"com.zicode.cancel-slow","capabilityId":"fixture.run"}});
    let mut reconcile_control = control.clone();
    reconcile_control["hostInstanceId"] = prepared["hostInstanceId"].clone();
    let reconcile_url = format!("{base}/reconcile-call");
    assert_eq!(
        client
            .post(&reconcile_url)
            .json(&reconcile_control)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let mut changed_host = reconcile_control.clone();
    changed_host["hostInstanceId"] = json!(uuid::Uuid::new_v4().to_string());
    let rejected_host: Value = client
        .post(&reconcile_url)
        .header("x-zicode-desktop-token", token)
        .json(&changed_host)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rejected_host["error"]["code"], "manual_call_host_changed");
    let early: Value = client
        .post(format!("{base}/prepare-call"))
        .header("x-zicode-desktop-token", token)
        .json(&request("slow"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut early_control = control.clone();
    early_control["callId"] = early["callId"].clone();
    for _ in 0..2 {
        let ack: Value = client
            .post(format!("{base}/cancel-call"))
            .header("x-zicode-desktop-token", token)
            .json(&early_control)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(ack["status"], "cancel_requested");
        assert_eq!(ack["executionFinished"], false);
    }
    let mut early_invoke = request("slow");
    early_invoke["callId"] = early["callId"].clone();
    let early_result: Value = client
        .post(format!("{base}/invoke"))
        .header("x-zicode-desktop-token", token)
        .json(&early_invoke)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(early_result["error"]["code"], "worker_cancelled");
    assert!(
        rx.try_recv().is_err(),
        "early cancellation must not spawn a Worker"
    );
    let sealed: Value = client
        .post(format!("{base}/prepare-call"))
        .header("x-zicode-desktop-token", token)
        .json(&request("slow"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut seal_control = reconcile_control.clone();
    seal_control["callId"] = sealed["callId"].clone();
    let proof: Value = client
        .post(&reconcile_url)
        .header("x-zicode-desktop-token", token)
        .json(&seal_control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(proof["outcome"], "manual_call_not_started");
    assert_eq!(proof["executionFinished"], true);
    let mut sealed_invoke = request("slow");
    sealed_invoke["callId"] = sealed["callId"].clone();
    assert_eq!(
        client
            .post(format!("{base}/invoke"))
            .header("x-zicode-desktop-token", token)
            .json(&sealed_invoke)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert!(
        rx.try_recv().is_err(),
        "sealed handle must not start a Worker"
    );
    let mut invoke = request("slow");
    invoke["callId"] = json!(id);
    let pending = client
        .post(format!("{base}/invoke"))
        .header("x-zicode-desktop-token", token)
        .json(&invoke);
    let running =
        tokio::spawn(async move { pending.send().await.unwrap().json::<Value>().await.unwrap() });
    let (slow_pid, rx) = tokio::task::spawn_blocking(move || {
        let (phase, pid) = rx.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(phase, "started");
        (pid, rx)
    })
    .await
    .unwrap();
    let started = Instant::now();
    assert_eq!(
        client
            .get(&directory_url)
            .header("x-zicode-desktop-token", token)
            .timeout(Duration::from_secs(1))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let echo: Value = client
        .post(format!("{base}/invoke"))
        .header("x-zicode-desktop-token", token)
        .timeout(Duration::from_secs(1))
        .json(&request("echo"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(echo["result"]["text"], "independent");
    assert!(!running.is_finished());
    let probe_ms = started.elapsed().as_millis();
    let mut wrong = control.clone();
    wrong["scope"]["workspaceId"] = json!("workspace-b");
    assert_eq!(
        client
            .post(format!("{base}/cancel-call"))
            .header("x-zicode-desktop-token", token)
            .json(&wrong)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    assert!(!running.is_finished());
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.cancel-slow", false)
        .unwrap();
    let cancel_started = Instant::now();
    let ack: Value = client
        .post(&reconcile_url)
        .header("x-zicode-desktop-token", token)
        .json(&reconcile_control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(ack["profile"], "manual.tool.reconcile.v1");
    assert_eq!(ack["callId"], prepared["callId"]);
    assert_eq!(ack["hostInstanceId"], prepared["hostInstanceId"]);
    assert_eq!(ack["status"], "cancel_requested");
    assert_eq!(ack["executionFinished"], false);
    let outcome = running.await.unwrap();
    assert_eq!(outcome["error"]["code"], "worker_cancelled");
    assert!(outcome.get("result").is_none());
    let cancel_ms = cancel_started.elapsed().as_millis();
    let terminal: Value = client
        .post(format!("{base}/call-status"))
        .header("x-zicode-desktop-token", token)
        .json(&control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(terminal["status"], "finished");
    assert_eq!(terminal["outcome"], "worker_cancelled");
    let late: Value = client
        .post(format!("{base}/cancel-call"))
        .header("x-zicode-desktop-token", token)
        .json(&control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(late, terminal);
    host.state
        .manual_tool_calls
        .0
        .lock()
        .unwrap()
        .get_mut(id)
        .unwrap()
        .changed = Instant::now() - RETENTION;
    let expired: Value = client
        .post(format!("{base}/call-status"))
        .header("x-zicode-desktop-token", token)
        .json(&control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(expired["error"]["code"], "manual_call_unavailable");
    let retired: Value = client
        .post(&reconcile_url)
        .header("x-zicode-desktop-token", token)
        .json(&reconcile_control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(retired["executionFinished"], true);
    assert_eq!(retired["outcome"], "manual_call_retired");
    assert_eq!(
        client
            .post(format!("{base}/invoke"))
            .header("x-zicode-desktop-token", token)
            .json(&invoke)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let fresh: Value = client
        .get(&directory_url)
        .header("x-zicode-desktop-token", token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut recovery = request("echo");
    recovery["catalogRevision"] = fresh["revision"].clone();
    let handle: Value = client
        .post(format!("{base}/prepare-call"))
        .header("x-zicode-desktop-token", token)
        .json(&recovery)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    recovery["callId"] = handle["callId"].clone();
    assert!(recovery["callId"].is_string());
    let recovered: Value = client
        .post(format!("{base}/invoke"))
        .header("x-zicode-desktop-token", token)
        .json(&recovery)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(recovered["result"]["text"], "independent");
    let events: Vec<_> = rx.try_iter().collect();
    let pids: Vec<_> = std::iter::once(slow_pid)
        .chain(events.iter().filter(|e| e.0 == "started").map(|e| e.1))
        .collect();
    assert_eq!(pids.len(), 3);
    for pid in &pids {
        for phase in ["reaped", "pipes_closed"] {
            assert!(events.contains(&(phase, *pid)), "{events:?}");
        }
    }
    host.stop_and_wait().await.unwrap();
    let evidence = json!({"passed":true,"profile":"manual.tool.call.v1","workerSha256":digest,
        "surface":"current source Host/real HTTP/retained production Worker/Studio synthetic guests",
        "prepareDidNotExecute":true,"unauthorizedRejected":true,"foreignScopeRejected":true,
        "duplicateInvokeRejected":true,"cancelAcknowledgementNonterminal":true,"terminalOutcome":"worker_cancelled",
        "directoryAndIndependentPluginLive":true,"probeDurationMs":probe_ms,"cancelDurationMs":cancel_ms,
        "cancelAfterDisable":true,"newHandleRecovered":true,"earlyCancelNoWorker":true,
        "duplicateCancelIdempotent":true,"terminalCancelUnchanged":true,
        "reconcileProfile":"manual.tool.reconcile.v1","reconcileUnauthorizedRejected":true,
        "changedHostRejected":true,"preparedSealedNoWorker":true,"activeReconcileNonterminal":true,
        "retiredHandleRecovered":true,"retiredHandleCannotInvoke":true,"expiryAdvancedInTest":true,
        "pids":pids,"reapedCount":3,"pipesClosedCount":3,"fullToolsAccepted":0,
        "notVerified":["native UI cancellation","new production executable","WASI cancellation","DevTools algorithms","other operating systems"]});
    if let Some(path) = std::env::var_os("ZICODE_TEST_MANUAL_CANCEL_EVIDENCE") {
        std::fs::write(path, serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
    }
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

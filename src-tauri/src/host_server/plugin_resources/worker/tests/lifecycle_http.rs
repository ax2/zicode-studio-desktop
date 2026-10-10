use super::*;

async fn post(
    host: &HostServer,
    client: &reqwest::Client,
    route: &str,
    body: Value,
) -> reqwest::Response {
    client
        .post(format!("{}/v2/plugin-resources/{route}", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&body)
        .send()
        .await
        .unwrap()
}

async fn material(host: &HostServer, client: &reqwest::Client, owner: &Value) -> Value {
    let mut bytes = vec![173; 300000];
    bytes[299992..].copy_from_slice(b"resource");
    let version = sha256_hex(&bytes);
    let prepared = post(host, client, "prepare", json!({"schemaVersion":1,"owner":owner,"mimeType":"application/octet-stream","byteLength":bytes.len(),"contentVersion":version})).await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared: Value = prepared.json().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":owner,"resourceId":prepared["resourceId"],"contentVersion":version});
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        assert_eq!(post(host, client, "append", json!({"access":access,"offset":index*MAX_CHUNK,"dataBase64":base64::engine::general_purpose::STANDARD.encode(chunk)})).await.status(),StatusCode::OK);
    }
    assert_eq!(
        post(
            host,
            client,
            "commit",
            json!({"access":access,"confirmed":true})
        )
        .await
        .status(),
        StatusCode::OK
    );
    access
}

async fn lost(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
    target: &RuntimeTarget,
    cause: &str,
) -> Value {
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
    let request = client
        .post(format!("{}/v2/plugin-resources/invoke-view", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}));
    let task = tokio::spawn(async move { request.send().await.unwrap() });
    let started = events_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(started.0, "started");
    let credential = host
        .state
        .plugin_tokens
        .lock()
        .unwrap()
        .get(&target.instance_id)
        .cloned()
        .unwrap();
    let module = if matches!(cause, "module" | "module_oversize") {
        let (path, _) = host
            .state
            .plugins
            .lock()
            .unwrap()
            .plugin_runtime_entry("programming", "com.zicode.studio.resource-fixture")
            .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        Some((path, bytes))
    } else {
        None
    };
    let changed = Instant::now();
    if cause == "unrelated" {
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", false).unwrap();
            registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", true).unwrap();
            registry.set_enabled("programming", "com.zicode.artifacts", true).unwrap();
            registry.set_enabled("other-scene", "com.zicode.studio.resource-fixture", true).unwrap();
            registry.reload_developer_plugins().unwrap();
        }
        // Keep the Worker suspended across several watcher intervals. Any cancellation
        // event is a failure; elapsed time alone is not evidence of successful execution.
        assert!(matches!(events_rx.recv_timeout(Duration::from_millis(350)), Err(mpsc::RecvTimeoutError::Timeout)));
        release_tx.send(()).unwrap();
        let response = tokio::time::timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = response.json().await.unwrap();
        assert_eq!(body["result"]["text"], "resource");
        let events: Vec<_> = events_rx.try_iter().collect();
        for name in ["reaped", "pipes_closed"] { assert!(events.contains(&(name, started.1))); }
        assert!(!events.iter().any(|event| matches!(event.0, "cancel_live" | "authorization_lost")));
        assert_eq!(host.state.plugin_resource_workers.slots.available_permits(), WORKERS);
        *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
        return json!({"cause":cause,"pid":started.1,"automaticCancellation":false,"resultPreserved":true,"reapedPipesClosed":true,"slotsReleased":true});
    }
    match cause {
        "permission" => host
            .state
            .plugins
            .lock()
            .unwrap()
            .set_permission(
                "programming",
                "com.zicode.studio.resource-fixture",
                "resource.read",
                false,
            )
            .unwrap(),
        "disabled" => host
            .state
            .plugins
            .lock()
            .unwrap()
            .set_enabled("programming", "com.zicode.studio.resource-fixture", false)
            .unwrap(),
        "credential" => {
            host.state
                .plugin_tokens
                .lock()
                .unwrap()
                .get_mut(&target.instance_id)
                .unwrap()
                .token_hash = sha256_hex(b"replacement-credential");
        }
        "resource" => {
            assert_eq!(
                post(host, client, "revoke", access.clone()).await.status(),
                StatusCode::OK
            );
        }
        "runtime" => host.state.runtimes.stop(target).unwrap(),
        "module" => {
            let (path, bytes) = module.as_ref().unwrap();
            let mut changed = bytes.clone();
            changed.extend_from_slice(b"\n ");
            std::fs::write(path, changed).unwrap();
        }
        "module_oversize" => {
            let (path, bytes) = module.as_ref().unwrap();
            let mut changed = bytes.clone();
            changed.resize(plugin_results::module_snapshot::MAX_BYTES + 1, 0);
            std::fs::write(path, changed).unwrap();
        }
        _ => panic!("unknown lifecycle case"),
    }
    // This probe is emitted only after the automatic watcher sets the cancellation flag.
    assert_eq!(
        events_rx.recv_timeout(Duration::from_secs(5)).unwrap(),
        ("authorization_lost", 0)
    );
    let detection_ms = changed.elapsed().as_millis();
    release_tx.send(()).unwrap();
    let response = tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap();
    assert!(!response.status().is_success());
    let response: Value = response.json().await.unwrap();
    assert!(response.get("result").is_none());
    let events: Vec<_> = events_rx.try_iter().collect();
    for name in ["cancel_live", "reaped", "pipes_closed"] {
        assert!(
            events.contains(&(name, started.1)),
            "missing {name} for {}",
            started.1
        );
    }
    assert_eq!(
        host.state.plugin_resource_workers.slots.available_permits(),
        WORKERS
    );
    *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
    if let Some((path, bytes)) = module {
        std::fs::write(path, bytes).unwrap();
    }
    match cause {
        "permission" => host
            .state
            .plugins
            .lock()
            .unwrap()
            .set_permission(
                "programming",
                "com.zicode.studio.resource-fixture",
                "resource.read",
                true,
            )
            .unwrap(),
        "disabled" => host
            .state
            .plugins
            .lock()
            .unwrap()
            .set_enabled("programming", "com.zicode.studio.resource-fixture", true)
            .unwrap(),
        "credential" => {
            host.state
                .plugin_tokens
                .lock()
                .unwrap()
                .insert(target.instance_id.clone(), credential);
        }
        _ => {}
    }
    json!({"cause":cause,"pid":started.1,"automaticCancellation":true,"cancelLiveReapedPipesClosed":true,"noResult":true,"slotsReleased":true,"detectionMs":detection_ms,"errorCode":response["error"]["code"],"explicitCancelRequested":false})
}

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    original: &Value,
    target: &RuntimeTarget,
) -> Value {
    let mut rows = Vec::new();
    for cause in [
        "unrelated",
        "permission",
        "disabled",
        "credential",
        "module",
        "module_oversize",
        "resource",
    ] {
        let access = material(host, client, &original["owner"]).await;
        rows.push(lost(host, client, &access, target, cause).await);
        assert_eq!(
            post(host, client, "revoke", access).await.status(),
            StatusCode::OK
        );
        let fresh = material(host, client, &original["owner"]).await;
        let response = post(
            host,
            client,
            "invoke-view",
            json!({"access":fresh,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<Value>().await.unwrap()["result"],
            json!({"text":"resource"})
        );
        assert_eq!(
            post(host, client, "revoke", fresh).await.status(),
            StatusCode::OK
        );
    }
    Value::Array(rows)
}

pub(super) async fn verify_stop(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    target: &RuntimeTarget,
) -> Value {
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.studio.resource-fixture",
            "resource.read",
            true,
        )
        .unwrap();
    let access = material(host, client, owner).await;
    lost(host, client, &access, target, "runtime").await
}

use super::*;

#[test]
fn strict_requests_reject_unknown_fields_and_version() {
    let owner = json!({"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"});
    let mut read = json!({"access":{"schemaVersion":1,"owner":owner,"resourceId":uuid::Uuid::new_v4(),"contentVersion":"hash"},"offset":0,"length":1});
    assert!(serde_json::from_value::<Read>(read.clone()).is_ok());
    read["access"]["path"] = json!("forbidden");
    assert!(serde_json::from_value::<Read>(read).is_err());
    let access: Access = serde_json::from_value(json!({"schemaVersion":2,"owner":owner,"resourceId":uuid::Uuid::new_v4(),"contentVersion":"hash"})).unwrap();
    assert!(validate(&access).is_err());
}

#[tokio::test]
async fn http_resource_upload_confirmation_read_revoke_and_permission_boundaries() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("resource-input-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), r#"{"purpose":"Host resource HTTP boundary; derived fixture, no algorithm execution","lifetime":"remove on success, retain failure"}"#).unwrap();
    let package = root.join("receiver");
    plugin_results::transfer::fixture::create_receiver(
        &project.join("tests/fixtures/devtools-text-dev57"),
        &package,
    );
    let manifest_path = package.join("plugin.json");
    let mut manifest: Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["permissions"]["optional"]
        .as_array_mut()
        .unwrap()
        .push(json!({"name":"resource.read","reason":"Selected test resource only"}));
    std::fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let mut target = RuntimeTarget::new(
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "temporary-resource-session",
        "resource-runtime",
    );
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
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.echo", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.devtools.echo",
                "resource.read",
                true,
            )
            .unwrap();
    }
    let token = "resource-http-test-only";
    host.state.plugin_tokens.lock().unwrap().insert(
        target.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(token.as_bytes()),
            target: target.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let issued = target.clone();
    target = host
        .state
        .runtimes
        .bind_session_id(&issued, "resource-session")
        .unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    for session_id in [&issued.session_id, &target.session_id] {
        let authorized =
            plugin_tool_auth::authorize(&host.state, &headers, &target.instance_id, session_id)
                .unwrap();
        assert_eq!(authorized.target, target);
    }
    assert!(plugin_tool_auth::authorize(
        &host.state,
        &headers,
        &target.instance_id,
        "foreign-session"
    )
    .is_err());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let desktop_post = |path: &str, body: Value| {
        client
            .post(format!("{}/v2/plugin-resources/{path}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let broker_post = |body: Value| {
        client
            .post(format!("{}/v2/plugin-resources/read", host.origin()))
            .bearer_auth(token)
            .json(&body)
            .send()
    };
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":"com.zicode.devtools.echo","capabilityId":"devtools.text.base64.encode"});
    let bytes = b"\x00\xffresource\x00data";
    let version = sha256_hex(bytes);
    let prepare = json!({"schemaVersion":1,"owner":owner,"mimeType":"application/octet-stream","byteLength":bytes.len(),"contentVersion":version});
    assert_eq!(
        client
            .post(format!("{}/v2/plugin-resources/prepare", host.origin()))
            .bearer_auth(token)
            .json(&prepare)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let prepared = desktop_post("prepare", prepare).await.unwrap();
    assert!(prepared.status().is_success());
    let prepared: Value = prepared.json().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":owner,"resourceId":prepared["resourceId"],"contentVersion":version});
    let read = json!({"access":access,"offset":0,"length":MAX_CHUNK});
    assert_eq!(
        broker_post(read.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    let uploaded = desktop_post("append", json!({"access":access,"offset":0,"dataBase64":base64::engine::general_purpose::STANDARD.encode(bytes)})).await.unwrap();
    assert!(uploaded.status().is_success());
    assert_eq!(
        uploaded.json::<Value>().await.unwrap()["uploadedBytes"],
        bytes.len()
    );
    assert_eq!(
        desktop_post("commit", json!({"access":access,"confirmed":false}))
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    assert!(
        desktop_post("commit", json!({"access":access,"confirmed":true}))
            .await
            .unwrap()
            .status()
            .is_success()
    );
    let result: Value = broker_post(read.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        result["dataBase64"],
        base64::engine::general_purpose::STANDARD.encode(bytes)
    );
    assert_eq!(result["eof"], true);
    let mut view_read = read.clone();
    view_read["length"] = json!(32 * 1024);
    assert_eq!(
        client
            .post(format!("{}/v2/plugin-resources/read-view", host.origin()))
            .bearer_auth(token)
            .json(&view_read)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let view_result: Value = desktop_post("read-view", view_read.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view_result["dataBase64"], result["dataBase64"]);
    view_probe::run(&host, &target, &access, &root).await;
    assert_eq!(
        desktop_post("read-view", read.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_chunk_too_large"
    );
    http_concurrency::check(&host, &client, token, &read, &access).await;
    // Same runtime IDs with a new credential must not inherit this grant.
    let rotated = "resource-http-rotated-test-only";
    host.state
        .plugin_tokens
        .lock()
        .unwrap()
        .get_mut(&target.instance_id)
        .unwrap()
        .token_hash = sha256_hex(rotated.as_bytes());
    let rotated_read: Value = client
        .post(format!("{}/v2/plugin-resources/read", host.origin()))
        .bearer_auth(rotated)
        .json(&read)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rotated_read["error"]["code"], "resource_unavailable");
    // Restore this deterministic fixture credential for subsequent boundary cases.
    host.state
        .plugin_tokens
        .lock()
        .unwrap()
        .get_mut(&target.instance_id)
        .unwrap()
        .token_hash = sha256_hex(token.as_bytes());
    let mut foreign = read.clone();
    foreign["access"]["owner"]["sessionId"] = json!("other");
    assert_eq!(
        broker_post(foreign).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let mut stale = read.clone();
    stale["access"]["contentVersion"] = json!(sha256_hex(b"changed"));
    assert_eq!(
        broker_post(stale)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_unavailable"
    );
    {
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_permission(
                "programming",
                "com.zicode.devtools.echo",
                "resource.read",
                false,
            )
            .unwrap();
    }
    assert_eq!(
        broker_post(read.clone()).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.devtools.echo",
            "resource.read",
            true,
        )
        .unwrap();
    assert_eq!(
        broker_post(read.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_unavailable"
    );
    let cursor_binding = crate::plugin_archive_cursor::Binding {
        plugin_id: "com.zicode.devtools.echo".into(),
        package_version: "1.0.0".into(),
        capability_id: "devtools.text.base64.encode".into(),
        scene_id: "programming".into(),
        runtime_id: target.instance_id.clone(),
        session_id: target.session_id.clone(),
        resource_id: access["resourceId"].as_str().unwrap().into(),
        content_version: version.clone(),
        query: String::new(),
        page_size: 20,
    };
    let page = host
        .state
        .archive_page_cursors
        .seal(cursor_binding.clone(), "abcdefghijklmnop")
        .unwrap();
    assert!(desktop_post("revoke", access.clone())
        .await
        .unwrap()
        .status()
        .is_success());
    assert_eq!(
        host.state.archive_page_cursors.take(&page, &cursor_binding),
        Err("archive_cursor_invalid")
    );
    assert!(desktop_post("revoke", access.clone())
        .await
        .unwrap()
        .status()
        .is_success());
    assert_eq!(
        broker_post(read.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_unavailable"
    );
    host.state.runtimes.stop(&target).unwrap();
    assert_eq!(broker_post(read).await.unwrap().status(), StatusCode::GONE);
    assert!(desktop_post("revoke", access)
        .await
        .unwrap()
        .status()
        .is_success());
    let _ = runtime;
    drop(client);
    host.stop();
    let canonical_root = root.canonicalize().unwrap();
    assert!(canonical_root.starts_with(project.join(".cache/task-scratch").canonicalize().unwrap()));
    // Host shutdown is asynchronous; let its own SQLite owners release handles.
    for attempt in 0..100 {
        match std::fs::remove_dir_all(&canonical_root) {
            Ok(()) => break,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) if error.raw_os_error() == Some(32) && attempt < 99 => {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            Err(error) => panic!("Own resource test cleanup failed: {error}"),
        }
    }
}

#[path = "http_concurrency.rs"]
mod http_concurrency;
#[path = "view_probe.rs"]
mod view_probe;

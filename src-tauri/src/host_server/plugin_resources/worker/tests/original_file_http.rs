//! The original-file transfer checks the current Windows file before sharing and upon execution.
use super::*;

#[path = "encoding_full_http.rs"]
mod encoding_full_http;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Files and Encoding candidates and the production Worker"]
async fn original_file_handoff_rechecks_identity_and_runs_encoding_only_on_request() {
    let env_path = |name: &str| PathBuf::from(std::env::var_os(name).expect(name));
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("original-file-http-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    let workspace = root.join("workspace");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::create_dir_all(workspace.join("检测样本")).unwrap();
    std::fs::create_dir(root.join("outside-first")).unwrap();
    std::fs::create_dir(root.join("outside-second")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"Original file handoff acceptance"}"#,
    )
    .unwrap();
    let original_name = "样本.txt";
    let relative = format!("检测样本/{original_name}");
    let original_path = workspace.join(&relative);
    let sample = "\u{feff}原文件\n".as_bytes();
    std::fs::write(&original_path, sample).unwrap();
    std::fs::write(
        workspace.join("large.txt"),
        vec![b'x'; file_reference::MAX_BYTES + 1],
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
        "file-origin-session",
        "file-origin-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace);
    const SENDER: &str = "com.zicode.devtools.files";
    const RECEIVER: &str = "com.zicode.devtools.encoding";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (id, key) in [
            (SENDER, "ZICODE_TEST_FILES_PACKAGE"),
            (RECEIVER, "ZICODE_TEST_ENCODING_PACKAGE"),
        ] {
            assert_eq!(registry.install_developer(&env_path(key)).unwrap(), id);
            registry
                .set_permission("programming", id, "resource.read", true)
                .unwrap();
            registry.set_enabled("programming", id, true).unwrap();
        }
    }
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(env_path("ZICODE_TEST_RESOURCE_WORKER_EXE"));
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |route, request| output_http::post(&host, &client, route, request);
    let sender = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":SENDER,"capabilityId":"devtools.files.hash"});
    let receiver = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":RECEIVER,"capabilityId":"devtools.encoding.inspect"});

    let shared = import(&host, &client, &sender, &relative).await;
    assert_eq!(
        shared["originalFile"],
        json!({"name":original_name,"byteLength":sample.len()})
    );
    assert!(!shared.to_string().contains("检测样本"));
    let source = shared["access"].clone();
    let request =
        |source| json!({"schemaVersion":1,"source":source,"target":receiver,"originalFile":true});
    let prepare = || post("prepare-transfer", request(source.clone()));
    assert_eq!(
        response(prepare().await).await.1["error"]["code"],
        "resource_file_reference_unavailable"
    );
    let (status, hashes) = invoke(&host, &client, &source).await;
    assert_eq!(status, StatusCode::OK, "{hashes}");
    assert_eq!(hashes["result"]["files"][0]["sha256"], sha256_hex(sample));

    let browser = output_http::material(&host, &client, &sender, sample).await;
    assert_eq!(invoke(&host, &client, &browser).await.0, StatusCode::OK);
    assert_eq!(
        response(post("prepare-transfer", request(browser)).await)
            .await
            .1["error"]["code"],
        "resource_file_reference_unavailable"
    );
    let large = import(&host, &client, &sender, "large.txt").await;
    assert!(large.get("originalFile").is_none());
    assert_eq!(
        invoke(&host, &client, &large["access"]).await.0,
        StatusCode::OK
    );
    assert_eq!(
        response(post("prepare-transfer", request(large["access"].clone())).await)
            .await
            .1["error"]["code"],
        "resource_input_too_large"
    );

    let (status, prompt) = response(prepare().await).await;
    assert_eq!(status, StatusCode::OK, "{prompt}");
    assert_eq!(prompt["fileName"], original_name);
    assert_eq!(prompt["byteLength"], sample.len());
    assert_eq!(prompt["contentRead"], false);
    assert_eq!(prompt["profile"], "resource.transfer.original-file.draft1");
    assert!(!prompt.to_string().contains("检测样本"));
    let commit = |confirmed| {
        post(
            "commit-transfer",
            json!({"schemaVersion":1,"source":source,"grantId":prompt["grantId"],"confirmed":confirmed}),
        )
    };
    assert_eq!(
        response(commit(false).await).await.1["error"]["code"],
        "resource_confirmation_required"
    );
    let before = host
        .state
        .plugin_resource_workers
        .events
        .lock()
        .unwrap()
        .len();
    let (status, receipt) = response(commit(true).await).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    assert_eq!(receipt["contentRead"], false);
    assert_eq!(
        host.state
            .plugin_resource_workers
            .events
            .lock()
            .unwrap()
            .len(),
        before
    );
    let access = json!({"schemaVersion":1,"owner":receiver,"resourceId":receipt["reference"]["resourceId"],"contentVersion":receipt["reference"]["contentVersion"]});
    let status_probe = |length| {
        post(
            "read-view",
            json!({"access":access,"offset":0,"length":length}),
        )
    };
    assert_eq!(
        response(status_probe(0).await).await.1["contentRead"],
        false
    );
    assert_eq!(
        response(status_probe(1).await).await.1["error"]["code"],
        "resource_file_reference_requires_run"
    );
    let (status, inspected) = invoke(&host, &client, &access).await;
    assert_eq!(status, StatusCode::OK, "{inspected}");
    assert_eq!(inspected["result"]["ok"], true, "{inspected}");
    assert!(
        inspected["result"].to_string().contains("UTF-8"),
        "{inspected}"
    );
    assert_eq!(std::fs::read(&original_path).unwrap(), sample);

    let moved = original_path.with_extension("before");
    std::fs::rename(&original_path, &moved).unwrap();
    assert_ne!(invoke(&host, &client, &access).await.0, StatusCode::OK);
    std::fs::write(&original_path, sample).unwrap();
    assert_eq!(
        response(commit(true).await).await.1["error"]["code"],
        "resource_file_changed"
    );
    assert_eq!(
        invoke(&host, &client, &access).await.1["error"]["code"],
        "resource_file_changed"
    );
    assert_eq!(
        post("revoke", source.clone()).await.status(),
        StatusCode::OK
    );
    assert_ne!(status_probe(0).await.status(), StatusCode::OK);
    external_selection(
        &host,
        &client,
        &sender,
        &receiver,
        &root,
        &target.workspace_id,
    )
    .await;
    if std::env::var_os("ZICODE_TEST_ENCODING_FULL_INSPECT").is_some() {
        encoding_full_http::verify(
            &host,
            &client,
            &sender,
            &receiver,
            &root,
            &target.workspace_id,
        )
        .await;
    }
    host.stop_and_wait().await.unwrap();
}

async fn response(value: reqwest::Response) -> (StatusCode, Value) {
    let status = value.status();
    (status, value.json().await.unwrap())
}

async fn import(host: &HostServer, client: &reqwest::Client, sender: &Value, path: &str) -> Value {
    let (status, preview) = response(
        output_http::post(
            host,
            client,
            "prepare-local-file",
            json!({"schemaVersion":1,"owner":sender,"relativePath":path}),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(preview["contentRead"], false);
    let (status, shared) = response(
        output_http::post(
            host,
            client,
            "commit-local-file",
            json!({"schemaVersion":1,"owner":sender,"grantId":preview["grantId"],"confirmed":true}),
        )
        .await,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{shared}");
    shared
}

async fn invoke(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
) -> (StatusCode, Value) {
    invoke_inputs(host, client, access, &[]).await
}

async fn invoke_inputs(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
    additional: &[Value],
) -> (StatusCode, Value) {
    let (status, ticket) = response(
        output_http::post(
            host,
            client,
            "prepare-call",
            json!({"schemaVersion":1,"access":access,"additionalAccesses":additional,"input":{}}),
        )
        .await,
    )
    .await;
    if status != StatusCode::OK {
        return (status, ticket);
    }
    response(output_http::post(host, client, "invoke-call", json!({"access":access,"additionalAccesses":additional,"callId":ticket["callId"],"hostInstanceId":ticket["hostInstanceId"],"input":{}})).await).await
}

async fn external_selection(
    host: &HostServer,
    client: &reqwest::Client,
    sender: &Value,
    receiver: &Value,
    root: &std::path::Path,
    workspace: &str,
) {
    let first_directory = root.join("outside-first").canonicalize().unwrap();
    let second_directory = root.join("outside-second").canonicalize().unwrap();
    let first = first_directory.join("外部.txt");
    let second = second_directory.join("empty.txt");
    let outside_contents = "\u{feff}工作空间之外".as_bytes();
    std::fs::write(&first, outside_contents).unwrap();
    std::fs::write(&second, []).unwrap();
    let context = export::Context {
        window: "native-workspace-a".into(),
        workspace: workspace.into(),
        route: "/workspace".into(),
    };
    let wrong_window = export::Context {
        window: "native-workspace-b".into(),
        ..context.clone()
    };
    let wrong_route = export::Context {
        route: "/other".into(),
        ..context.clone()
    };
    let wrong_workspace = export::Context {
        workspace: "different".into(),
        ..context.clone()
    };
    let prepare = |context, paths| host.prepare_native_digest_files(context, sender.clone(), paths);
    assert_eq!(
        prepare(wrong_workspace, vec![first.clone()])
            .await
            .unwrap_err(),
        "resource_authorization_changed"
    );
    assert_eq!(
        prepare(context.clone(), vec![first.clone(); 2])
            .await
            .unwrap_err(),
        "resource_file_selection_invalid"
    );
    assert_eq!(
        prepare(context.clone(), vec![first.clone(); 5])
            .await
            .unwrap_err(),
        "resource_file_selection_invalid"
    );
    let large = |directory: &std::path::Path| {
        let path = directory.join("large.bin");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(17 * 1024 * 1024)
            .unwrap();
        path
    };
    assert_eq!(
        prepare(
            context.clone(),
            vec![large(&first_directory), large(&second_directory)]
        )
        .await
        .unwrap_err(),
        "resource_input_too_large"
    );
    let result = prepare(context.clone(), vec![first.clone(), second.clone()])
        .await
        .unwrap();
    assert_eq!(
        result["profile"],
        "resource.local-file.native-selection.draft1"
    );
    assert_eq!(result["contentRead"], false);
    assert_eq!(result["files"][0]["name"], "外部.txt");
    assert_eq!(result["files"][0]["byteLength"], outside_contents.len());
    assert_eq!(result["files"][1]["name"], "empty.txt");
    assert_eq!(result["files"][1]["byteLength"], 0);
    assert!(!result.to_string().contains("outside-"));
    let grant = |index: usize| {
        result["files"][index]["grantId"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let commit = |context, index, confirmed| {
        host.commit_native_digest_file(context, sender.clone(), grant(index), confirmed)
    };
    assert_eq!(
        commit(context.clone(), 0, false).await.unwrap_err(),
        "resource_confirmation_required"
    );
    assert_eq!(
        commit(wrong_window.clone(), 0, true).await.unwrap_err(),
        "resource_file_grant_unavailable"
    );
    assert_eq!(
        host.cancel_native_digest_file(&wrong_route, sender.clone(), grant(0))
            .unwrap_err(),
        "resource_file_grant_unavailable"
    );
    for route in [
        "commit-local-file",
        "cancel-local-file",
        "status-local-file",
    ] {
        let (status, denied) = response(
            output_http::post(
                host,
                client,
                route,
                json!({"schemaVersion":1,"owner":sender,"grantId":grant(0),"confirmed":true}),
            )
            .await,
        )
        .await;
        assert_ne!(status, StatusCode::OK);
        assert_eq!(denied["error"]["code"], "resource_file_grant_unavailable");
    }
    let a = commit(context.clone(), 0, true).await.unwrap();
    assert_eq!(a["originalFile"]["name"], "外部.txt");
    assert!(!a.to_string().contains("outside-first"));
    assert_eq!(
        commit(context.clone(), 0, true).await.unwrap_err(),
        "resource_file_grant_unavailable"
    );
    let b = commit(context.clone(), 1, true).await.unwrap();
    let (status, hashes) = invoke_inputs(host, client, &a["access"], &[b["access"].clone()]).await;
    assert_eq!(status, StatusCode::OK, "{hashes}");
    assert_eq!(
        hashes["result"]["files"][0]["sha256"],
        sha256_hex(outside_contents)
    );
    assert_eq!(hashes["result"]["files"][1]["sha256"], sha256_hex(b""));
    let prompt = response(
        output_http::post(
            host,
            client,
            "prepare-transfer",
            json!({
                "schemaVersion":1,"source":a["access"],"target":receiver,"originalFile":true,
            }),
        )
        .await,
    )
    .await;
    assert_eq!(prompt.0, StatusCode::OK, "{}", prompt.1);
    let receipt = response(output_http::post(host, client, "commit-transfer", json!({
        "schemaVersion":1,"source":a["access"],"grantId":prompt.1["grantId"],"confirmed":true,
    })).await).await;
    assert_eq!(receipt.0, StatusCode::OK, "{}", receipt.1);
    assert_eq!(receipt.1["contentRead"], false);
    let access = json!({"schemaVersion":1,"owner":receiver,"resourceId":receipt.1["reference"]["resourceId"],"contentVersion":receipt.1["reference"]["contentVersion"]});
    let (status, inspected) = invoke(host, client, &access).await;
    assert_eq!(status, StatusCode::OK, "{inspected}");
    assert_eq!(inspected["result"]["ok"], true);
    assert_eq!(std::fs::read(&first).unwrap(), outside_contents);
    let next = prepare(context.clone(), vec![first.clone(), second.clone()])
        .await
        .unwrap();
    let cancel = next["files"][0]["grantId"].as_str().unwrap().to_owned();
    let changed = next["files"][1]["grantId"].as_str().unwrap().to_owned();
    assert_eq!(
        host.cancel_native_digest_file(&context, sender.clone(), cancel.clone())
            .unwrap()["contentRead"],
        false
    );
    assert_eq!(
        host.commit_native_digest_file(context.clone(), sender.clone(), cancel, true)
            .await
            .unwrap_err(),
        "resource_file_grant_unavailable"
    );
    std::fs::rename(&second, second.with_extension("original")).unwrap();
    std::fs::write(&second, []).unwrap();
    assert_eq!(
        host.commit_native_digest_file(context, sender.clone(), changed, true)
            .await
            .unwrap_err(),
        "resource_file_changed"
    );
}

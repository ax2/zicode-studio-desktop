use super::*;
use std::sync::mpsc;
mod lifecycle_http;
mod output_http;
mod output_admission_http;
mod preview_browser;
mod admission_http;
mod archive_save_http;

#[test]
fn strict_invocation_cancellation_and_scope_reject_unknown_fields() {
    let access = json!({"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"p","capabilityId":"c"},"resourceId":uuid::Uuid::new_v4(),"contentVersion":"0".repeat(64)});
    let mut input = json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}});
    assert!(serde_json::from_value::<Invoke>(input.clone()).is_ok());
    input["additionalAccesses"] = json!([access]);
    assert!(serde_json::from_value::<Invoke>(input.clone()).is_err());
    input.as_object_mut().unwrap().remove("additionalAccesses");
    input["workerPath"] = json!("forbidden");
    assert!(serde_json::from_value::<Invoke>(input).is_err());
    let mut cancel =
        json!({"schemaVersion":1,"owner":access["owner"],"toolCallId":uuid::Uuid::new_v4()});
    assert!(serde_json::from_value::<Cancel>(cancel.clone()).is_ok());
    cancel["token"] = json!("forbidden");
    assert!(serde_json::from_value::<Cancel>(cancel).is_err());
    let mut status = json!({"schemaVersion":1,"owner":access["owner"],"toolCallId":uuid::Uuid::new_v4()});
    assert!(serde_json::from_value::<Status>(status.clone()).is_ok());
    status["input"] = json!({});
    assert!(serde_json::from_value::<Status>(status).is_err());
}

#[test]
fn host_status_identity_is_fresh_and_not_a_disk_record() {
    let first = Workers::default();
    let second = Workers::default();
    assert!(uuid::Uuid::parse_str(&first.instance_id).is_ok());
    assert_ne!(first.instance_id, second.instance_id);
    assert!(first.events.lock().unwrap().is_empty());
}

#[test]
fn audit_records_remain_bounded_without_disk_writes() {
    let workers = Workers::default();
    for index in 0..300 {
        workers.record(json!({"index":index}));
    }
    let records = workers.events.lock().unwrap();
    assert_eq!(records.len(), 128);
    assert_eq!(records.front().unwrap()["index"], 172);
    assert_eq!(records.back().unwrap()["index"], 299);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires current Studio draft2 Worker executable; real Host HTTP resource computation"]
async fn actual_http_authorized_resource_worker_cancel_quota_disconnect_and_recovery() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("host-resource-worker-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"actual Host resource Worker conformance; retain failure"}"#,
    )
    .unwrap();
    let package = root.join("package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    let mut manifest: Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-text-dev57/plugin.json")).unwrap(),
    )
    .unwrap();
    manifest["id"] = json!("com.zicode.studio.resource-fixture");
    manifest["name"] = json!("Studio Resource Fixture");
    manifest["displayName"] = json!("Studio资源契约验收");
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
    manifest["runtime"] = json!({"wasi":"runtime/tools.wasm","resourceInputProfile":PROFILE});
    manifest["activationEvents"] = json!(["onCapability:resource.inspect"]);
    manifest["contributes"] = json!({"activities":[],"views":[],"commands":[],"piTools":[],"capabilities":[{
        "id":"resource.inspect","title":"Resource fixture","resourceInputMax":2,
        "inputSchema":{"type":"object","properties":{},"additionalProperties":false},
        "outputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false}
    }]});
    manifest["permissions"] = json!({"required":[],"optional":[{"name":"resource.read","reason":"Confirmed fixture input only"}]});
    std::fs::write(
        package.join("plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let module = r#"(module
        (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
        (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
        (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
        (memory (export "memory") 1)
        (data (i32.const 64) "{\22text\22:\22XXXXXXXX\22}")
        (func (export "_start")
            i32.const 0 call $size i64.const 300000 i64.ne if unreachable end
            i32.const 0 i64.const 299992 i32.const 73 i32.const 8 call $read
            i32.const 8 i32.ne if unreachable end
            i32.const 1 call $size i64.const -1 i64.ne if
                i32.const 1 call $size i64.const 8 i64.ne if unreachable end
                i32.const 1 i64.const 0 i32.const 128 i32.const 8 call $read
                i32.const 8 i32.ne if unreachable end
                i32.const 128 i32.load i32.const 0x6f636573 i32.ne if unreachable end
                i32.const 132 i32.load i32.const 0x2121646e i32.ne if unreachable end
            end
            i32.const 0 i32.const 64 i32.store i32.const 4 i32.const 19 i32.store
            i32.const 1 i32.const 0 i32.const 1 i32.const 24 call $write drop))"#;
    std::fs::write(package.join("runtime/tools.wasm"), module).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "temporary-resource-worker",
        "resource-worker-instance",
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
            token_hash: sha256_hex(b"fixture-resource-credential"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "resource-worker-session")
        .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled("programming", "com.zicode.studio.resource-fixture", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.studio.resource-fixture",
                "resource.read",
                true,
            )
            .unwrap();
    }
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable.clone());
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |path: &str, body: Value| {
        client
            .post(format!("{}/v2/plugin-resources/{path}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":"com.zicode.studio.resource-fixture","capabilityId":"resource.inspect"});
    let catalog_revision = {
        let mut registry = host.state.plugins.lock().unwrap();
        let revision = registry.manual_catalog(&crate::plugin_registry::manual_catalog::CatalogQuery { scene_id: "programming".into(), ..Default::default() }).unwrap()["revision"].clone();
        registry.set_permission("programming", "com.zicode.studio.resource-fixture", "resource.read", false).unwrap();
        registry.set_permission("programming", "com.zicode.studio.resource-fixture", "resource.read", true).unwrap();
        revision
    };
    let stale = post("prepare", json!({"schemaVersion":1,"owner":owner,"mimeType":"text/plain","byteLength":0,"contentVersion":sha256_hex(b""),"catalogRevision":catalog_revision})).await.unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(stale.json::<Value>().await.unwrap()["error"]["code"], "catalog_changed");
    assert_eq!(host.state.plugin_resources.lock().unwrap().record_count(), 0);
    let mut bytes = vec![173; 300000];
    bytes[299992..].copy_from_slice(b"resource");
    let version = sha256_hex(&bytes);
    let prepared=post("prepare",json!({"schemaVersion":1,"owner":owner,"mimeType":"application/octet-stream","byteLength":bytes.len(),"contentVersion":version})).await.unwrap();
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared: Value = prepared.json().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":owner,"resourceId":prepared["resourceId"],"contentVersion":version});
    let invocation = json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}});
    assert_eq!(
        post("invoke-view", invocation.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        assert_eq!(post("append",json!({"access":access,"offset":index*MAX_CHUNK,"dataBase64":base64::engine::general_purpose::STANDARD.encode(chunk)})).await.unwrap().status(),StatusCode::OK);
    }
    assert_eq!(
        post("commit", json!({"access":access,"confirmed":true}))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let response = post("invoke-view", invocation.clone()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.json::<Value>().await.unwrap()["result"],
        json!({"text":"resource"})
    );
    let installed = host.state.plugins.lock().unwrap()
        .plugin_runtime_entry("programming", "com.zicode.studio.resource-fixture").unwrap().0;
    std::fs::write(&installed, module.replace(r#"\22text\22"#, r#"\22oops\22"#)).unwrap();
    let invalid_prepared = post("prepare", json!({"schemaVersion":1,"owner":owner,"mimeType":"application/octet-stream",
        "byteLength":bytes.len(),"contentVersion":version})).await.unwrap();
    assert_eq!(invalid_prepared.status(), StatusCode::OK);
    let invalid_prepared: Value = invalid_prepared.json().await.unwrap();
    let invalid_access = json!({"schemaVersion":1,"owner":owner,"resourceId":invalid_prepared["resourceId"],"contentVersion":version});
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        assert_eq!(post("append", json!({"access":invalid_access,"offset":index*MAX_CHUNK,
            "dataBase64":base64::engine::general_purpose::STANDARD.encode(chunk)})).await.unwrap().status(), StatusCode::OK);
    }
    assert_eq!(post("commit", json!({"access":invalid_access,"confirmed":true})).await.unwrap().status(), StatusCode::OK);
    let invalid = post("invoke-view", json!({"access":invalid_access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}))
        .await.unwrap();
    assert_eq!(invalid.status(), StatusCode::CONFLICT);
    assert_eq!(invalid.json::<Value>().await.unwrap()["error"]["code"], "invalid_output");
    assert_eq!(post("revoke", invalid_access).await.unwrap().status(), StatusCode::OK);
    std::fs::write(installed, module).unwrap();
    // Once the execution response has been consumed/discarded, query lifetime
    // independently without re-uploading, cancelling or running the Worker again.
    let status_request = json!({"schemaVersion":1,"owner":owner,"toolCallId":invocation["toolCallId"]});
    let status = post("call-status", status_request.clone()).await.unwrap();
    assert_eq!(status.status(), StatusCode::OK);
    let status: Value = status.json().await.unwrap();
    assert_eq!(status["profile"], "resource.call.status.draft1");
    assert_eq!(status["phase"], "finished");
    assert_eq!(status["executionFinished"], true);
    assert_eq!(status["resultAvailable"], false);
    assert_eq!(status["persistent"], false);
    let mut expected = status_request.clone();
    expected["hostInstanceId"] = status["hostInstanceId"].clone();
    assert_eq!(post("call-status", expected.clone()).await.unwrap().status(), StatusCode::OK);
    expected["hostInstanceId"] = json!(uuid::Uuid::new_v4());
    assert_eq!(post("call-status", expected).await.unwrap().json::<Value>().await.unwrap()["error"]["code"], "resource_call_host_changed");
    let mut fenced = invocation.clone();
    fenced["toolCallId"] = json!(uuid::Uuid::new_v4());
    fenced["hostInstanceId"] = json!(uuid::Uuid::new_v4());
    assert_eq!(post("invoke-view", fenced.clone()).await.unwrap().json::<Value>().await.unwrap()["error"]["code"], "resource_call_host_changed");
    fenced["hostInstanceId"] = status["hostInstanceId"].clone();
    assert_eq!(post("invoke-view", fenced).await.unwrap().status(), StatusCode::OK);
    let mut unknown = status_request.clone();
    unknown["toolCallId"] = json!(uuid::Uuid::new_v4());
    let unknown: Value = post("call-status", unknown).await.unwrap().json().await.unwrap();
    assert_eq!(unknown["phase"], "unknown");
    assert_eq!(unknown["executionFinished"], false);
    let mut wrong_scope = status_request.clone();
    wrong_scope["owner"]["capabilityId"] = json!("other");
    assert_eq!(post("call-status", wrong_scope).await.unwrap().json::<Value>().await.unwrap()["phase"], "unknown");
    assert_eq!(client.post(format!("{}/v2/plugin-resources/call-status", host.origin()))
        .bearer_auth("fixture-resource-credential").json(&status_request).send().await.unwrap().status(), StatusCode::FORBIDDEN);
    let mut invalid_status = status_request;
    invalid_status["input"] = json!({});
    assert_eq!(post("call-status", invalid_status).await.unwrap().status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        client
            .post(format!("{}/v2/plugin-resources/invoke-view", host.origin()))
            .bearer_auth("fixture-resource-credential")
            .json(&invocation)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let mut invalid = invocation.clone();
    invalid["input"] = json!({"path":"forbidden"});
    assert_eq!(
        post("invoke-view", invalid)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "invalid_parameters"
    );

    let (event_tx, event_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    *host.state.plugin_resource_workers.observer.lock().unwrap() =
        Some(Arc::new(move |event, pid| {
            let _ = event_tx.send((event, pid));
            if event == "started" {
                let _ = release_rx
                    .lock()
                    .unwrap()
                    .recv_timeout(Duration::from_secs(15));
            }
        }));
    let call_one = uuid::Uuid::new_v4().to_string();
    let call_two = uuid::Uuid::new_v4().to_string();
    let invoke_url = format!("{}/v2/plugin-resources/invoke-view", host.origin());
    let token = host.desktop_token().to_string();
    let first_body = json!({"access":access,"toolCallId":call_one,"input":{}});
    let second_body = json!({"access":access,"toolCallId":call_two,"input":{}});
    let spawn = |body: Value| {
        let client = client.clone();
        let url = invoke_url.clone();
        let token = token.clone();
        tokio::spawn(async move {
            client
                .post(url)
                .header("x-zicode-desktop-token", token)
                .json(&body)
                .send()
                .await
                .unwrap()
        })
    };
    let first = spawn(first_body);
    let first_event = event_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(first_event.0, "started");
    let second = spawn(second_body);
    let second_event = event_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(second_event.0, "started");
    second.abort(); // Actual work must retain its permit after the HTTP waiter disappears.
    assert_eq!(
        post(
            "invoke-view",
            json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}})
        )
        .await
        .unwrap()
        .status(),
        StatusCode::TOO_MANY_REQUESTS
    );
    assert!(host.state.plugins.try_lock().is_ok());
    assert!(host.state.capability_broker.try_lock().is_ok());
    assert_eq!(
        tokio::time::timeout(
            Duration::from_secs(2),
            client
                .get(format!("{}/v2/bootstrap", host.origin()))
                .query(&[
                    ("workspaceId", &target.workspace_id),
                    ("sessionId", &target.session_id),
                ])
                .send()
        )
        .await
        .unwrap()
        .unwrap()
        .status(),
        StatusCode::OK
    );
    let cancellation = json!({"schemaVersion":1,"owner":owner,"toolCallId":call_one});
    let active_status: Value = post("call-status", cancellation.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(active_status["phase"], "active");
    assert_eq!(active_status["executionFinished"], false);
    assert_eq!(active_status["cancellationRequested"], false);
    assert_eq!(
        post("cancel-view", cancellation.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["status"],
        "requested"
    );
    let cancelling: Value = post("call-status", cancellation.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(cancelling["phase"], "active");
    assert_eq!(cancelling["executionFinished"], false);
    assert_eq!(cancelling["cancellationRequested"], true);
    release_tx.send(()).unwrap();
    release_tx.send(()).unwrap();
    let cancelled = first.await.unwrap();
    let finished: Value = post("call-status", cancellation.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(finished["phase"], "finished");
    assert_eq!(finished["executionFinished"], true);
    assert_eq!(cancelled.status(), StatusCode::CONFLICT);
    assert_eq!(
        cancelled.json::<Value>().await.unwrap()["error"]["code"],
        "worker_cancelled"
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while host.state.plugin_resource_workers.slots.available_permits() != WORKERS
        && Instant::now() < deadline
    {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(
        host.state.plugin_resource_workers.slots.available_permits(),
        WORKERS
    );
    let events = event_rx.try_iter().collect::<Vec<_>>();
    for event in ["cancel_live", "reaped", "pipes_closed"] {
        assert!(events.contains(&(event, first_event.1)));
    }
    assert!(events.contains(&("pipes_closed", second_event.1)));
    *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
    assert_eq!(
        post(
            "invoke-view",
            json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}})
        )
        .await
        .unwrap()
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post("cancel-view", cancellation)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["executionFinished"],
        true
    );
    let automatic_lifecycle = lifecycle_http::verify(&host, &client, &access, &target).await;
    let binary_output=output_http::verify(&host,&client,&root,&target,&manifest).await;
    let archive_output=archive_save_http::verify(&host,&client,&root,&target,&manifest).await;
    let resource_transfer = super::super::transfer::tests::verify(&host, &root, &target, &manifest).await;
    let resource_save = super::super::save::tests::http::verify(&host, &root, &target).await;
    let saved_library = super::super::library::tests::http::verify(&host, &root, &target).await;
    let browser_preview = preview_browser::verify(&host, &root, &target, &manifest).await;
    // This conformance case deliberately revokes/regrants permission. Give it a
    // fresh input after the existing lifecycle cases; never reuse invalid grants.
    let admission_access = lifecycle_http::material(&host,&client,&owner).await;
    let call_admission = admission_http::verify(&host,&client,&admission_access).await;
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.studio.resource-fixture",
            "resource.read",
            false,
        )
        .unwrap();
    assert_eq!(
        post("invoke-view", invocation.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post("revoke", access.clone()).await.unwrap().status(),
        StatusCode::OK
    );
    assert_eq!(
        post(
            "cancel-view",
            json!({"schemaVersion":1,"owner":owner,"toolCallId":call_two})
        )
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap()["executionFinished"],
        true
    );
    let audit = post("worker-audit-view", json!({}))
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(audit["persistent"], false);
    assert!(audit["records"].as_array().unwrap().len() <= 128);
    let audit_text = serde_json::to_string(&audit).unwrap();
    assert!(!audit_text.contains("fixture-resource-credential"));
    assert!(!audit_text.contains("dataBase64"));
    assert!(!audit_text.contains("workerPath"));
    let automatic_stop = lifecycle_http::verify_stop(&host, &client, &owner, &target).await;
    if let Some(path) = std::env::var_os("ZICODE_TEST_HOST_RESOURCE_EVIDENCE") {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(file,&json!({"passed":true,"surface":"real HTTP Host + current Studio EXE + Studio-owned WASI fixture",
            "resourceBytes":300000,"confirmedSnapshotExecuted":true,"unconfirmedRejected":true,"schemaAndDesktopAuthEnforced":true,"staleCatalogPrepareRejectedWithoutAllocation":true,
            "workers":WORKERS,"busyRejected":true,"disconnectKeptPermit":true,"bootstrapWhileBusy":true,"registryAndBrokerLocksReleased":true,"callAdmission":call_admission,
            "cancelledPid":first_event.1,"cancelLiveReapedPipesClosed":true,"secondPid":second_event.1,"secondPipesClosed":true,
            "nextInvocationRecovered":true,"nonBinaryInvalidOutputRejected":true,"revokedPermissionRejected":true,"cancelAfterRevoke":true,"boundedVolatileAudit":true,
            "automaticLifecycle":automatic_lifecycle,"automaticRuntimeStop":automatic_stop,"binaryOutput":binary_output,"archiveOutput":archive_output,"resourceTransfer":resource_transfer,"resourceSave":resource_save,"savedLibrary":saved_library,"browserPreview":browser_preview,"devtoolsImageAlgorithm":false,"nativeUi":false,"phaseBoundary":"Workers held at startup by test observer; not instruction-level interruption"})).unwrap();
    }
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

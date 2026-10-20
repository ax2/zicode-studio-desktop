use super::*;
use std::sync::mpsc;
mod admission_http;
mod archive_save_http;
mod cross_plugin_http;
mod host_text_http;
mod lifecycle_http;
mod output_admission_http;
mod output_http;
mod preview_browser;
mod provider_text_http;
mod typed_output_http;

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
    let mut status =
        json!({"schemaVersion":1,"owner":access["owner"],"toolCallId":uuid::Uuid::new_v4()});
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
        let revision = registry
            .manual_catalog(&crate::plugin_registry::manual_catalog::CatalogQuery {
                scene_id: "programming".into(),
                ..Default::default()
            })
            .unwrap()["revision"]
            .clone();
        registry
            .set_permission(
                "programming",
                "com.zicode.studio.resource-fixture",
                "resource.read",
                false,
            )
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.studio.resource-fixture",
                "resource.read",
                true,
            )
            .unwrap();
        revision
    };
    let stale = post("prepare", json!({"schemaVersion":1,"owner":owner,"mimeType":"text/plain","byteLength":0,"contentVersion":sha256_hex(b""),"catalogRevision":catalog_revision})).await.unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        stale.json::<Value>().await.unwrap()["error"]["code"],
        "catalog_changed"
    );
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        0
    );
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
    let installed = host
        .state
        .plugins
        .lock()
        .unwrap()
        .plugin_runtime_entry("programming", "com.zicode.studio.resource-fixture")
        .unwrap()
        .0;
    std::fs::write(&installed, module.replace(r#"\22text\22"#, r#"\22oops\22"#)).unwrap();
    let invalid_prepared = post(
        "prepare",
        json!({"schemaVersion":1,"owner":owner,"mimeType":"application/octet-stream",
        "byteLength":bytes.len(),"contentVersion":version}),
    )
    .await
    .unwrap();
    assert_eq!(invalid_prepared.status(), StatusCode::OK);
    let invalid_prepared: Value = invalid_prepared.json().await.unwrap();
    let invalid_access = json!({"schemaVersion":1,"owner":owner,"resourceId":invalid_prepared["resourceId"],"contentVersion":version});
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        assert_eq!(
            post(
                "append",
                json!({"access":invalid_access,"offset":index*MAX_CHUNK,
            "dataBase64":base64::engine::general_purpose::STANDARD.encode(chunk)})
            )
            .await
            .unwrap()
            .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        post("commit", json!({"access":invalid_access,"confirmed":true}))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let invalid = post(
        "invoke-view",
        json!({"access":invalid_access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await
    .unwrap();
    assert_eq!(invalid.status(), StatusCode::CONFLICT);
    assert_eq!(
        invalid.json::<Value>().await.unwrap()["error"]["code"],
        "invalid_output"
    );
    assert_eq!(
        post("revoke", invalid_access).await.unwrap().status(),
        StatusCode::OK
    );
    std::fs::write(installed, module).unwrap();
    // Once the execution response has been consumed/discarded, query lifetime
    // independently without re-uploading, cancelling or running the Worker again.
    let status_request =
        json!({"schemaVersion":1,"owner":owner,"toolCallId":invocation["toolCallId"]});
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
    assert_eq!(
        post("call-status", expected.clone())
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    expected["hostInstanceId"] = json!(uuid::Uuid::new_v4());
    assert_eq!(
        post("call-status", expected)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_call_host_changed"
    );
    let mut fenced = invocation.clone();
    fenced["toolCallId"] = json!(uuid::Uuid::new_v4());
    fenced["hostInstanceId"] = json!(uuid::Uuid::new_v4());
    assert_eq!(
        post("invoke-view", fenced.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_call_host_changed"
    );
    fenced["hostInstanceId"] = status["hostInstanceId"].clone();
    assert_eq!(
        post("invoke-view", fenced).await.unwrap().status(),
        StatusCode::OK
    );
    let mut unknown = status_request.clone();
    unknown["toolCallId"] = json!(uuid::Uuid::new_v4());
    let unknown: Value = post("call-status", unknown)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unknown["phase"], "unknown");
    assert_eq!(unknown["executionFinished"], false);
    let mut wrong_scope = status_request.clone();
    wrong_scope["owner"]["capabilityId"] = json!("other");
    assert_eq!(
        post("call-status", wrong_scope)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["phase"],
        "unknown"
    );
    assert_eq!(
        client
            .post(format!("{}/v2/plugin-resources/call-status", host.origin()))
            .bearer_auth("fixture-resource-credential")
            .json(&status_request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let mut invalid_status = status_request;
    invalid_status["input"] = json!({});
    assert_eq!(
        post("call-status", invalid_status).await.unwrap().status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
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

    let independent_access = cross_plugin_http::confirmed_input(
        &host, &client, &root, &target, &manifest, module, &bytes,
    )
    .await;

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
    let independent = spawn(json!({"access":independent_access,
        "toolCallId":uuid::Uuid::new_v4(),"input":{}}));
    let independent_event = event_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(independent_event.0, "started");
    assert_ne!(independent_event.1, first_event.1);
    assert_ne!(independent_event.1, second_event.1);
    assert_eq!(
        host.state.plugin_resource_workers.slots.available_permits(),
        0
    );
    // An unrelated Host request may hold either lock for a moment. Prove that
    // active Workers do not retain them, rather than sampling one instant.
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if host.state.plugins.try_lock().is_ok()
                && host.state.capability_broker.try_lock().is_ok()
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("active Workers retained the registry or broker lock");
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
    let active_status: Value = post("call-status", cancellation.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
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
    let cancelling: Value = post("call-status", cancellation.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cancelling["phase"], "active");
    assert_eq!(cancelling["executionFinished"], false);
    assert_eq!(cancelling["cancellationRequested"], true);
    release_tx.send(()).unwrap();
    release_tx.send(()).unwrap();
    release_tx.send(()).unwrap();
    let cancelled = first.await.unwrap();
    let independent_response = independent.await.unwrap();
    assert_eq!(independent_response.status(), StatusCode::OK);
    assert_eq!(
        independent_response.json::<Value>().await.unwrap()["result"],
        json!({"text":"resource"})
    );
    let finished: Value = post("call-status", cancellation.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
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
    assert!(events.contains(&("pipes_closed", independent_event.1)));
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
    let binary_output = output_http::verify(&host, &client, &root, &target, &manifest).await;
    let archive_output = archive_save_http::verify(&host, &client, &root, &target, &manifest).await;
    let typed_output = typed_output_http::verify(&host, &client, &root, &target, &manifest).await;
    let resource_transfer =
        super::super::transfer::tests::verify(&host, &root, &target, &manifest).await;
    let resource_save = super::super::save::tests::http::verify(&host, &root, &target).await;
    let saved_library = super::super::library::tests::http::verify(&host, &root, &target).await;
    let browser_preview = preview_browser::verify(&host, &root, &target, &manifest).await;
    // This conformance case deliberately revokes/regrants permission. Give it a
    // fresh input after the existing lifecycle cases; never reuse invalid grants.
    let admission_access = lifecycle_http::material(&host, &client, &owner).await;
    let call_admission = admission_http::verify(&host, &client, &admission_access).await;
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
            "workers":WORKERS,"busyRejected":true,"independentPluginStartedWithTwoBusyAndCompleted":true,"disconnectKeptPermit":true,"bootstrapWhileBusy":true,"registryAndBrokerLocksReleased":true,"callAdmission":call_admission,
            "cancelledPid":first_event.1,"cancelLiveReapedPipesClosed":true,"secondPid":second_event.1,"secondPipesClosed":true,
            "nextInvocationRecovered":true,"nonBinaryInvalidOutputRejected":true,"revokedPermissionRejected":true,"cancelAfterRevoke":true,"boundedVolatileAudit":true,
            "automaticLifecycle":automatic_lifecycle,"automaticRuntimeStop":automatic_stop,"binaryOutput":binary_output,"archiveOutput":archive_output,"typedOutput":typed_output,"resourceTransfer":resource_transfer,"resourceSave":resource_save,"savedLibrary":saved_library,"browserPreview":browser_preview,"devtoolsImageAlgorithm":false,"nativeUi":false,"phaseBoundary":"Workers held at startup by test observer; not instruction-level interruption"})).unwrap();
    }
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires a freshly built Studio executable for the real WASI Worker process"]
async fn actual_http_devtools_image_resize_candidate_host_flow() {
    use image::ImageEncoder;

    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("host-image-resize-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"real Studio Host HTTP acceptance for DevTools image resize candidate"}"#,
    )
    .unwrap();

    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "temporary-image-resize-worker",
        "image-resize-instance",
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
            token_hash: sha256_hex(b"image-resize-fixture-credential"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "image-resize-session")
        .unwrap();
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable.clone());

    let candidate = std::env::var_os("ZICODE_TEST_IMAGE_CANDIDATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| project.join("tests/fixtures/devtools-image-resize-candidate02"));
    let receiver_id = "com.zicode.devtools.image-receiver-fixture";
    let receiver_package = root.join("image-resize-receiver-package");
    std::fs::create_dir_all(receiver_package.join("runtime")).unwrap();
    let mut receiver_manifest: Value =
        serde_json::from_slice(&std::fs::read(candidate.join("plugin.json")).unwrap()).unwrap();
    let numeric_image_inputs = receiver_manifest["contributes"]["capabilities"][0]
        ["inputSchema"]["properties"]["maxWidth"]["type"]
        == "integer";
    receiver_manifest["id"] = json!(receiver_id);
    receiver_manifest["name"] = json!("ZiDevTools Image Resize Receiver Fixture");
    receiver_manifest["displayName"] = json!("ZiDevTools 图片缩放接收器验收夹具");
    receiver_manifest["requiredProfiles"] = json!({
        "output.schema.v1":"=1.0.0-rc.1",
        "resource.input.types.v1":"=1.0.0-preview.1"
    });
    receiver_manifest["runtime"] = json!({
        "wasi":"runtime/tools.wasm",
        "resourceInputProfile":"resource.wasi.input.draft2"
    });
    receiver_manifest["activationEvents"] = json!(["onCapability:resource.receive"]);
    receiver_manifest["contributes"]["capabilities"] = json!([{
        "id":"resource.receive",
        "title":"接收 PNG 图片",
        "resourceInputMax":2,
        "resourceInputMimeTypes":["image/png"],
        "inputSchema":{"type":"object","additionalProperties":false},
        "outputSchema":{"type":"object","properties":{"text":{"type":"string"}},
            "required":["text"],"additionalProperties":false}
    }]);
    receiver_manifest["permissions"] = json!({"required":[],"optional":[{
        "name":"resource.read","reason":"只读取用户已确认转交的单张图片。"
    }]});
    std::fs::write(
        receiver_package.join("plugin.json"),
        serde_json::to_vec(&receiver_manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(
        receiver_package.join("runtime/tools.wasm"),
        r#"(module
          (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
          (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
          (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
          (memory (export "memory") 1)
          (data (i32.const 1024) "{\22text\22:\22PNG received\22}")
          (func (export "_start")
            i32.const 0 call $size i64.const 8 i64.lt_u if unreachable end
            i32.const 0 i64.const 0 i32.const 0 i32.const 8 call $read
            i32.const 8 i32.ne if unreachable end
            i32.const 0 i32.load i32.const 0x474e5089 i32.ne if unreachable end
            i32.const 4 i32.load i32.const 0x0a1a0a0d i32.ne if unreachable end
            i32.const 2048 i32.const 1024 i32.store
            i32.const 2052 i32.const 23 i32.store
            i32.const 1 i32.const 2048 i32.const 1 i32.const 2060 call $json drop))"#,
    )
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&candidate).unwrap();
        registry.install_developer(&receiver_package).unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.devtools.image",
                "resource.read",
                true,
            )
            .unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.image", true)
            .unwrap();
        registry
            .set_permission("programming", receiver_id, "resource.read", true)
            .unwrap();
        registry
            .set_enabled("programming", receiver_id, true)
            .unwrap();
        let catalog = registry
            .manual_catalog(&crate::plugin_registry::manual_catalog::CatalogQuery {
                scene_id: "programming".into(),
                ..Default::default()
            })
            .unwrap();
        assert!(catalog.to_string().contains("devtools.image.resize"));
    }

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let owner = json!({
        "runtimeId":target.instance_id,
        "sessionId":target.session_id,
        "pluginId":"com.zicode.devtools.image",
        "capabilityId":"devtools.image.resize"
    });
    let mut pixels = Vec::new();
    for rgba in [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 0, 255],
        [255, 0, 255, 255],
        [0, 255, 255, 255],
        [64, 64, 64, 255],
        [192, 192, 192, 255],
    ] {
        pixels.extend_from_slice(&rgba);
    }
    let mut input_png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut input_png)
        .write_image(&pixels, 4, 2, image::ExtendedColorType::Rgba8)
        .unwrap();
    let access =
        output_http::material_with_mime(&host, &client, &owner, "image/png", &input_png).await;
    let response = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({
            "access":access,
            "toolCallId":uuid::Uuid::new_v4(),
            "input":{"maxWidth":if numeric_image_inputs { json!(2) } else { json!("2") },
                "format":"png","quality":if numeric_image_inputs { json!(82) } else { json!("82") }}
        }),
    )
    .await;
    if response.status() != StatusCode::OK {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        panic!("image resize invoke returned {status}: {body}");
    }
    let response = response.json::<Value>().await.unwrap();
    assert_eq!(response["result"]["ok"], true);
    assert_eq!(response["result"]["sourceWidth"], 4);
    assert_eq!(response["result"]["sourceHeight"], 2);
    assert_eq!(response["result"]["width"], 2);
    assert_eq!(response["result"]["height"], 1);
    assert_eq!(response["result"]["mimeType"], "image/png");
    assert_eq!(response["resources"].as_array().unwrap().len(), 1);
    let output = &response["resources"][0];
    assert_eq!(output["saved"], false);
    assert_eq!(output["derivedFrom"]["resourceId"], access["resourceId"]);
    let output_access = json!({
        "schemaVersion":1,
        "owner":owner,
        "resourceId":output["resourceId"],
        "contentVersion":output["contentVersion"]
    });
    let mut output_png = Vec::new();
    for offset in (0..output["byteLength"].as_u64().unwrap() as usize).step_by(32768) {
        let chunk = output_http::post(
            &host,
            &client,
            "read-view",
            json!({"access":output_access,"offset":offset,"length":32768}),
        )
        .await;
        assert_eq!(chunk.status(), StatusCode::OK);
        let chunk = chunk.json::<Value>().await.unwrap();
        output_png.extend(
            base64::engine::general_purpose::STANDARD
                .decode(chunk["dataBase64"].as_str().unwrap())
                .unwrap(),
        );
    }
    assert_eq!(sha256_hex(&output_png), output["contentVersion"]);
    let decoded = image::load_from_memory(&output_png).unwrap();
    assert_eq!((decoded.width(), decoded.height()), (2, 1));

    // Route the real image-resize output into a separately installed WASI tool,
    // require desktop confirmation, and invoke that receiver on the transferred
    // bytes to prove the plugin-to-plugin image pipeline end to end.
    let plugin_receiver_owner = json!({
        "runtimeId":target.instance_id,
        "sessionId":target.session_id,
        "pluginId":receiver_id,
        "capabilityId":"resource.receive"
    });
    let plugin_transfer = output_http::post(
        &host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":output_access,"target":plugin_receiver_owner}),
    )
    .await;
    if plugin_transfer.status() != StatusCode::OK {
        let status = plugin_transfer.status();
        let body = plugin_transfer.text().await.unwrap_or_default();
        panic!("image resize prepare-transfer returned {status}: {body}");
    }
    let plugin_transfer = plugin_transfer.json::<Value>().await.unwrap();
    assert_eq!(plugin_transfer["target"]["pluginId"], receiver_id);
    assert_eq!(plugin_transfer["requiresConfirmation"], true);
    let unconfirmed = output_http::post(
        &host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":output_access,
            "grantId":plugin_transfer["grantId"],"confirmed":false}),
    )
    .await;
    assert_ne!(unconfirmed.status(), StatusCode::OK);
    let plugin_transferred = output_http::post(
        &host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":output_access,
            "grantId":plugin_transfer["grantId"],"confirmed":true}),
    )
    .await;
    assert_eq!(plugin_transferred.status(), StatusCode::OK);
    let plugin_transferred = plugin_transferred.json::<Value>().await.unwrap();
    assert_eq!(
        plugin_transferred["reference"]["contentVersion"],
        output["contentVersion"]
    );
    let plugin_receiver_access = json!({
        "schemaVersion":1,
        "owner":plugin_receiver_owner,
        "resourceId":plugin_transferred["reference"]["resourceId"],
        "contentVersion":plugin_transferred["reference"]["contentVersion"]
    });
    let plugin_received = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({"access":plugin_receiver_access,
            "toolCallId":uuid::Uuid::new_v4(),
            "input":{}}),
    )
    .await;
    if plugin_received.status() != StatusCode::OK {
        let status = plugin_received.status();
        let body = plugin_received.text().await.unwrap_or_default();
        panic!("plugin image receiver returned {status}: {body}");
    }
    let plugin_received = plugin_received.json::<Value>().await.unwrap();
    assert_eq!(
        plugin_received["result"]["text"], "PNG received",
        "WASI receiver did not accept the transferred PNG: {}",
        plugin_received["result"]
    );
    assert!(plugin_received.get("resources").is_none());

    // The real WASI-produced resource can cross the Host boundary only after
    // explicit desktop confirmation, then run through the built-in Host-only
    // image receiver without exposing its capability to ordinary tool search.
    let receiver_owner = json!({
        "runtimeId":target.instance_id,
        "sessionId":target.session_id,
        "pluginId":"com.zicode.resource-inspector",
        "capabilityId":"image.inspect"
    });
    let catalog = host
        .state
        .plugins
        .lock()
        .unwrap()
        .manual_catalog(&crate::plugin_registry::manual_catalog::CatalogQuery {
            scene_id: "programming".into(),
            ..Default::default()
        })
        .unwrap();
    assert!(!catalog
        .to_string()
        .contains("com.zicode.resource-inspector"));
    let prepared = output_http::post(
        &host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":output_access,"target":receiver_owner}),
    )
    .await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared = prepared.json::<Value>().await.unwrap();
    assert_eq!(
        prepared["target"]["pluginId"],
        "com.zicode.resource-inspector"
    );
    assert_eq!(prepared["target"]["capabilityId"], "image.inspect");
    assert_eq!(prepared["requiresConfirmation"], true);

    let commit = json!({"schemaVersion":1,"source":output_access,
        "grantId":prepared["grantId"],"confirmed":false});
    let rejected = output_http::post(&host, &client, "commit-transfer", commit).await;
    assert_ne!(rejected.status(), StatusCode::OK);

    let transferred = output_http::post(
        &host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":output_access,
            "grantId":prepared["grantId"],"confirmed":true}),
    )
    .await;
    assert_eq!(transferred.status(), StatusCode::OK);
    let transferred = transferred.json::<Value>().await.unwrap();
    let receiver_access = json!({"schemaVersion":1,"owner":receiver_owner,
        "resourceId":transferred["reference"]["resourceId"],
        "contentVersion":transferred["reference"]["contentVersion"]});
    let inspected = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({"access":receiver_access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(inspected.status(), StatusCode::OK);
    let inspected = inspected.json::<Value>().await.unwrap();
    assert_eq!(inspected["result"]["ok"], true);
    assert_eq!(
        inspected["source"]["profile"],
        "resource.host.image-input.v1"
    );
    assert_eq!(inspected["result"]["format"], "png");
    assert_eq!(inspected["result"]["mimeType"], "image/png");
    assert_eq!(inspected["result"]["width"], 2);
    assert_eq!(inspected["result"]["height"], 1);
    assert_eq!(inspected["result"]["byteLength"], output["byteLength"]);
    assert!(inspected.get("resources").is_none());

    let bad_access =
        output_http::material_with_mime(&host, &client, &owner, "image/png", b"not a PNG").await;
    let records_before = host
        .state
        .plugin_resource_workers
        .events
        .lock()
        .unwrap()
        .len();
    let failed = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({
            "access":bad_access,
            "toolCallId":uuid::Uuid::new_v4(),
            "input":{"maxWidth":if numeric_image_inputs { json!(2) } else { json!("2") },
                "format":"png","quality":if numeric_image_inputs { json!(82) } else { json!("82") }}
        }),
    )
    .await;
    assert_eq!(failed.status(), StatusCode::OK);
    let failed = failed.json::<Value>().await.unwrap();
    assert_eq!(failed["result"]["ok"], false);
    assert_eq!(failed["result"]["error"]["code"], "INVALID_IMAGE");
    assert!(failed.get("resources").is_none());
    {
        let records = host.state.plugin_resource_workers.events.lock().unwrap();
        let failure_record = records.get(records_before).unwrap();
        assert_eq!(failure_record["ok"], false);
        assert_eq!(failure_record["errorCode"], "INVALID_IMAGE");
    }
    // A failed producer invocation must not poison a separate healthy tool.
    let sibling_after_failure = output_http::post(
        &host,
        &client,
        "invoke-view",
        json!({"access":plugin_receiver_access,
            "toolCallId":uuid::Uuid::new_v4(),
            "input":{}}),
    )
    .await;
    assert_eq!(sibling_after_failure.status(), StatusCode::OK);
    let sibling_after_failure = sibling_after_failure.json::<Value>().await.unwrap();
    assert_eq!(sibling_after_failure["result"]["text"], "PNG received");
    host.stop_and_wait().await.unwrap();
    drop(runtime);
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

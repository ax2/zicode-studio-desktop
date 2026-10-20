use super::*;
use crate::metadata_store::MetadataStore;

#[tokio::test]
async fn structured_result_host_http_keeps_object_through_preview_mapping_and_save() {
    exercise_structured_result_host_http(false).await;
}

#[tokio::test]
#[ignore = "requires ZICODE_TEST_WORKER_EXE; invokes a derived WASI package"]
async fn structured_result_real_worker_preserves_object_for_host_actions() {
    exercise_structured_result_host_http(true).await;
}

async fn exercise_structured_result_host_http(real_worker: bool) {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("json-result-http-{}", uuid::Uuid::new_v4()));
    let package = root.join("candidate");
    transfer::fixture::create_receiver(
        &project.join("tests/fixtures/devtools-text-dev57"),
        &package,
    );
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Studio JSON result Host HTTP test","removeOnSuccess":true}"#,
    )
    .unwrap();
    let manifest_path = package.join("plugin.json");
    let mut manifest: Value =
        serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({
        "output.schema.v1":"=1.0.0-rc.1",
        "result.json.v1":"=1.0.0-preview.1"
    });
    for capability in manifest["contributes"]["capabilities"]
        .as_array_mut()
        .unwrap()
    {
        match capability["id"].as_str().unwrap() {
            "devtools.text.base64.encode" => {
                capability["resultCaptureMimeType"] = json!("application/json");
                capability["outputSchema"] = json!({
                    "type":"object",
                    "properties":{
                        "contractVersion":{"type":"string","const":"1.0.0-rc.1"},
                        "ok":{"type":"boolean","const":true},
                        "data":{"type":"object","properties":{"text":{"type":"string"}},
                            "required":["text"],"additionalProperties":false},
                        "error":{"type":"null"}
                    },
                    "required":["contractVersion","ok","data","error"],"additionalProperties":false
                });
            }
            "devtools.text.json.format" => {
                capability["inputSchema"] = json!({
                    "type":"object",
                    "properties":{"document":{"type":"object","properties":{"text":{"type":"string"}},
                        "required":["text"],"additionalProperties":false}},
                    "required":["document"],"additionalProperties":false
                });
            }
            _ => {}
        }
    }
    std::fs::write(&manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin = "com.zicode.devtools.echo";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    if real_worker {
        host.state
            .capability_broker
            .lock()
            .unwrap()
            .worker_executable = Some(PathBuf::from(
            std::env::var_os("ZICODE_TEST_WORKER_EXE").expect("ZICODE_TEST_WORKER_EXE required"),
        ));
    }
    let request: CapabilityInvokeRequest = serde_json::from_value(json!({
        "workspaceId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "sceneId":"programming","pluginId":plugin,
        "capabilityId":"devtools.text.base64.encode",
        "captureResult":true,"input":{"text":"hello"}
    }))
    .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let token = host.desktop_token();
    let reference = if real_worker {
        let response: Value = client
            .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
            .header("x-zicode-desktop-token", token)
            .json(
                &json!({"workspaceId":request.workspace_id,"sceneId":request.scene_id,
                "pluginId":plugin,"capabilityId":request.capability_id,"captureResult":true,
                "input":{"text":"hello"}}),
            )
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["result"]["data"]["text"], "aGVsbG8=", "{response}");
        response["resultRef"].clone()
    } else {
        let registry = host.state.plugins.lock().unwrap();
        let expected = source_proof(&registry, &request).unwrap();
        capture(
            &host.state,
            &registry,
            &request,
            &expected,
            &json!({"contractVersion":"1.0.0-rc.1","ok":true,
                "data":{"text":"aGVsbG8="},"error":null}),
        )
        .unwrap()
    };
    assert_eq!(reference["schemaVersion"], 2);
    assert_eq!(reference["mimeType"], "application/json");
    let scope = json!({"workspaceId":request.workspace_id,"sceneId":request.scene_id,
        "pluginId":plugin,"capabilityId":request.capability_id});
    let targets: Value = client
        .post(format!("{}/v2/plugin-results/targets", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({"scope":scope,"resultId":reference["resultId"],"query":"json"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(targets["schemaVersion"], 2, "{targets}");
    assert!(targets["items"].as_array().unwrap().iter().any(|item| {
        item["capabilityId"] == "devtools.text.json.format"
            && item["field"] == "document"
            && item["inputMimeType"] == "application/json"
    }));
    let prepared_transfer: Value = client
        .post(format!(
            "{}/v2/plugin-results/prepare-transfer",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&json!({"scope":scope,"resultId":reference["resultId"],
            "target":{"pluginId":plugin,"capabilityId":"devtools.text.json.format"},
            "field":"document","inputs":{}}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(prepared_transfer["schemaVersion"], 2, "{prepared_transfer}");
    assert_eq!(prepared_transfer["preview"]["mimeType"], "application/json");
    let unconfirmed: Value = client
        .post(format!(
            "{}/v2/plugin-results/commit-transfer",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&json!({"scope":scope,"grantId":prepared_transfer["grantId"],"confirmed":false}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(unconfirmed["error"]["code"], "result_confirmation_required");
    let prepared_save: Value = client
        .post(format!("{}/v2/plugin-results/prepare-save", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({"scope":scope,"resultId":reference["resultId"],"title":"Structured result"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(prepared_save["preview"]["mimeType"], "application/json");
    assert_eq!(prepared_save["preview"]["text"], r#"{"text":"aGVsbG8="}"#);
    let saved: Value = client
        .post(format!("{}/v2/plugin-results/commit-save", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({"scope":scope,"grantId":prepared_save["grantId"],"confirmed":true}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(saved["artifact"]["mimeType"], "application/json", "{saved}");
    assert_eq!(saved["artifact"]["content"], json!({"text":"aGVsbG8="}));
    let reopened = host
        .state
        .artifacts
        .lock()
        .unwrap()
        .scoped(&request.workspace_id)
        .unwrap()
        .get("programming", saved["artifact"]["id"].as_str().unwrap())
        .unwrap();
    assert_eq!(reopened.descriptor.mime_type, "application/json");
    assert_eq!(reopened.content, json!({"text":"aGVsbG8="}));
    let replayed: Value = client
        .post(format!("{}/v2/plugin-results/commit-save", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({"scope":scope,"grantId":prepared_save["grantId"],"confirmed":true}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(replayed["replayed"], true);
    assert_eq!(replayed["artifact"]["id"], saved["artifact"]["id"]);
    host.stop_and_wait().await.unwrap();
    let canonical_scratch = scratch.canonicalize().unwrap();
    let canonical_root = root.canonicalize().unwrap();
    assert!(canonical_root.starts_with(canonical_scratch));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
#[ignore = "requires ZICODE_TEST_JSON_DIR, ZICODE_TEST_JSON_RECEIPT and ZICODE_TEST_WORKER_EXE; run alone"]
async fn delivered_json_candidate_runs_confirmed_object_transfer_and_save() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let candidate = PathBuf::from(std::env::var_os("ZICODE_TEST_JSON_DIR").unwrap())
        .canonicalize()
        .unwrap();
    let receipt = PathBuf::from(std::env::var_os("ZICODE_TEST_JSON_RECEIPT").unwrap())
        .canonicalize()
        .unwrap();
    let worker = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap())
        .canonicalize()
        .unwrap();
    let verify_receipt = |package: &std::path::Path| {
        let output = crate::process_command::new_command("bun")
            .current_dir(&project)
            .arg("run")
            .arg("verify:devtools-package")
            .arg(package)
            .arg(&receipt)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "JSON candidate receipt failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        let checked: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(checked["verified"], true);
        assert_eq!(checked["signatureVerified"], false);
        checked
    };
    let verified = verify_receipt(&candidate);

    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("json-provider-host-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Studio independent JSON provider Host/Worker acceptance","removeOnSuccess":true}"#,
    )
    .unwrap();
    crate::desktop_profile::initialize([
        std::ffi::OsString::from("--isolated-profile"),
        root.join("profile").into_os_string(),
    ])
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin = "com.zicode.devtools.json-object";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&candidate).unwrap(), plugin);
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    let installed = verify_receipt(&root.join("test-plugin-registry/developer").join(plugin));
    assert_eq!(installed["indexSha256"], verified["indexSha256"]);
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(worker.clone());

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let post = |path: &str, body: Value| {
        client
            .post(format!("{}{path}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let scope = json!({"workspaceId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "sceneId":"programming","pluginId":plugin,
        "capabilityId":"devtools.json.object.inspect"});
    let input = json!({"value":{"name":"Zi","enabled":true}});
    let mut invocation = scope.clone();
    invocation["input"] = input;
    invocation["captureResult"] = json!(true);
    let source: Value = post("/v2/plugin-capabilities/invoke", invocation)
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(source["result"]["ok"], true, "{source}");
    assert_eq!(
        source["result"]["data"]["value"],
        json!({"name":"Zi","enabled":true})
    );
    assert_eq!(source["resultRef"]["schemaVersion"], 2, "{source}");
    assert_eq!(source["resultRef"]["mimeType"], "application/json");
    let result_id = source["resultRef"]["resultId"].clone();

    let targets: Value = post(
        "/v2/plugin-results/targets",
        json!({"scope":scope,"resultId":result_id,"query":""}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert!(
        targets["items"].as_array().unwrap().iter().any(|item| {
            item["capabilityId"] == "devtools.json.object.receive"
                && item["field"] == "value"
                && item["inputMimeType"] == "application/json"
        }),
        "{targets}"
    );
    let prepared: Value = post(
        "/v2/plugin-results/prepare-transfer",
        json!({"scope":scope,"resultId":result_id,
            "target":{"pluginId":plugin,"capabilityId":"devtools.json.object.receive"},
            "field":"value","inputs":{}}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(prepared["schemaVersion"], 2, "{prepared}");
    assert_eq!(prepared["preview"]["mimeType"], "application/json");
    let unconfirmed = post(
        "/v2/plugin-results/commit-transfer",
        json!({"scope":scope,"grantId":prepared["grantId"],"confirmed":false}),
    )
    .await
    .unwrap();
    assert_eq!(unconfirmed.status(), StatusCode::CONFLICT);
    let transferred: Value = post(
        "/v2/plugin-results/commit-transfer",
        json!({"scope":scope,"grantId":prepared["grantId"],"confirmed":true}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(transferred["result"]["ok"], true, "{transferred}");
    assert_eq!(
        transferred["result"]["data"]["receivedValue"],
        source["result"]["data"]
    );
    assert_eq!(
        transferred["resultRef"]["schemaVersion"], 2,
        "{transferred}"
    );

    let save: Value = post(
        "/v2/plugin-results/prepare-save",
        json!({"scope":scope,"resultId":result_id,"title":"JSON object acceptance"}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(save["preview"]["mimeType"], "application/json");
    let saved: Value = post(
        "/v2/plugin-results/commit-save",
        json!({"scope":scope,"grantId":save["grantId"],"confirmed":true}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(saved["artifact"]["mimeType"], "application/json", "{saved}");
    assert_eq!(saved["artifact"]["content"], source["result"]["data"]);
    host.stop_and_wait().await.unwrap();
    let canonical_root = root.canonicalize().unwrap();
    assert!(canonical_root.starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
    if let Some(path) = std::env::var_os("ZICODE_TEST_JSON_HOST_RECEIPT") {
        let evidence = json!({
            "passed":true,
            "mechanismPassed":true,
            "candidateFamily":"json-object",
            "candidateIndexSha256":verified["indexSha256"],
            "fileCount":verified["fileCount"],
            "sourceAndReceiverExecuted":true,
            "unconfirmedRejected":true,
            "jsonSaved":true,
            "fullCandidateAccepted":false,
            "workerSha256":sha256_hex(&std::fs::read(worker).unwrap())
        });
        std::fs::write(path, serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
    }
}

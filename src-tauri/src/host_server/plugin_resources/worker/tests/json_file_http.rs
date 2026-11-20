//! Frozen JSON file provider through the HTTP Host and production Worker.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

const PLUGIN: &str = crate::plugin_resource_execution::json_compare::PLUGIN;
const MAX_FILE: usize = crate::plugin_resource_execution::json_compare::MAX_FILE;
const PATH: &str = "devtools.compare.json-file.path";
const ORDERED: &str = "devtools.compare.json-file.diff.ordered";
const UNORDERED: &str = "devtools.compare.json-file.diff.unordered";

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires immutable JSON file provider package and current Windows Studio Worker"]
async fn json_file_compare_frozen_host_http_and_explicit_export() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_JSON_FILE_PACKAGE").unwrap());
    let receipt_path = package.with_file_name(format!(
        "{}-verification.json",
        package.file_name().unwrap().to_string_lossy()
    ));
    let receipt: Value = serde_json::from_slice(&std::fs::read(receipt_path).unwrap()).unwrap();
    for entry in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(package.join(entry["path"].as_str().unwrap())).unwrap();
        assert_eq!(entry["size"], bytes.len());
        assert_eq!(entry["sha256"], sha256_hex(&bytes));
    }
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    std::fs::create_dir_all(&scratch).unwrap();
    let scratch = scratch.canonicalize().unwrap();
    let root = scratch.join(format!("json-file-http-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    std::fs::write(
        root.join("owner.json"),
        br#"{"purpose":"isolated JSON file test","lifetime":"remove on success"}"#,
    )
    .unwrap();
    let workspace = root.join("workspace");
    std::fs::create_dir(&workspace).unwrap();
    std::fs::create_dir(root.join("public")).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "ffffeeee-dddd-4ddd-8ddd-eeeeffffffff",
        "json-file-test",
        "json-file-instance",
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
            token_hash: sha256_hex(b"generated-json-file-test-only-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "json-file-session")
        .unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), PLUGIN);
        registry
            .set_permission("programming", PLUGIN, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", PLUGIN, true).unwrap();
        let catalog = registry
            .manual_catalog(&crate::plugin_registry::manual_catalog::CatalogQuery {
                scene_id: "programming".into(),
                plugin_id: Some(PLUGIN.into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(catalog["total"], 3, "{catalog}");
        for capability in [PATH, ORDERED, UNORDERED] {
            let detail = registry
                .manual_tool_detail(&crate::plugin_registry::manual_catalog::DetailQuery {
                    scene_id: "programming".into(),
                    plugin_id: PLUGIN.into(),
                    capability_id: capability.into(),
                    revision: registry.manual_revision("programming"),
                    resource_mime_type: None,
                })
                .unwrap();
            assert_eq!(detail["enabled"], true);
            assert_eq!(detail["resourceInputProfile"], "resource.wasi.input.draft2");
            if capability != PATH {
                assert_eq!(
                    detail["capability"]["resourceInputLabels"],
                    json!(["Left JSON file", "Right JSON file"])
                );
                assert_eq!(detail["capability"]["resourceInputMin"], 2);
                assert_eq!(detail["capability"]["resourceInputMax"], 2);
            }
        }
    }
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let owner = |capability| {
        json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":PLUGIN,"capabilityId":capability})
    };
    let request = |route, body| output_http::post(&host, &client, route, body);

    let path_owner = owner(PATH);
    let sample = format!("[\"{}\"]", "a".repeat(MAX_FILE - 4)).into_bytes();
    assert_eq!(sample.len(), MAX_FILE);
    let access = output_http::material(&host, &client, &path_owner, &sample).await;
    let expected = format!("[\n  \"{}\"\n]", "a".repeat(MAX_FILE - 4)).into_bytes();
    let (status, result) = invoke(&host, &client, &access, &[], json!({"query":"$[*]"})).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["result"]["sourceByteCounts"], json!([MAX_FILE]));
    let output = &result["resources"][0];
    assert_eq!(output["mimeType"], "application/json");
    assert_eq!(output["contentVersion"], sha256_hex(&expected));
    let derived = json!({"schemaVersion":1,"owner":path_owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
    let mut wrong = derived.clone();
    wrong["owner"]["sessionId"] = json!("unrelated");
    assert!(
        !request("read-view", json!({"access":wrong,"offset":0,"length":32}))
            .await
            .status()
            .is_success()
    );
    let (status, preview) =
        response(request("prepare-save", json!({"schemaVersion":1,"source":derived})).await).await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let relative_path = preview["preview"]["relativePath"].as_str().unwrap();
    assert!(relative_path.ends_with("/result.json"), "{relative_path}");
    let export = workspace.join(relative_path);
    assert!(!export.exists());
    let mut confirmation =
        json!({"schemaVersion":1,"source":derived,"grantId":preview["grantId"],"confirmed":false});
    assert!(
        !request("commit-save", confirmation.clone())
            .await
            .status()
            .is_success()
    );
    assert!(!export.exists());
    confirmation["confirmed"] = json!(true);
    let (status, saved) = response(request("commit-save", confirmation.clone()).await).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["receipt"]["contentVersion"], sha256_hex(&expected));
    assert_eq!(std::fs::read(&export).unwrap(), expected);
    let (status, replay) = response(request("commit-save", confirmation).await).await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(replay["replayed"], true);
    assert_eq!(replay["receipt"], saved["receipt"]);
    assert_eq!(std::fs::read(export).unwrap(), expected);

    for (capability, equal) in [(ORDERED, false), (UNORDERED, true)] {
        let owner = owner(capability);
        let left = output_http::material(&host, &client, &owner, br#"{"a/b~":[3,2,2]}"#).await;
        let right = output_http::material(&host, &client, &owner, br#"{"a/b~":[2,3,2]}"#).await;
        let (status, _) = invoke(&host, &client, &left, &[], json!({})).await;
        assert_ne!(
            status,
            StatusCode::OK,
            "a diff requires two authorised resources"
        );
        let (status, result) = invoke(
            &host,
            &client,
            &left,
            std::slice::from_ref(&right),
            json!({}),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        let output = &result["resources"][0];
        assert_eq!(
            output["derivedFromAll"][0]["resourceId"],
            left["resourceId"]
        );
        assert_eq!(
            output["derivedFromAll"][1]["resourceId"],
            right["resourceId"]
        );
        let derived = json!({"schemaVersion":1,"owner":owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
        let (status, chunk) = response(
            request(
                "read-view",
                json!({"access":derived,"offset":0,"length":4096}),
            )
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{chunk}");
        let bytes = STANDARD
            .decode(chunk["dataBase64"].as_str().unwrap())
            .unwrap();
        let report: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(report["equal"], equal);
        if !equal {
            assert_eq!(
                report["changes"][0],
                json!({"path":"/a~1b~0/0","kind":"changed","before":3,"after":2})
            );
        }
    }
    let deep_owner = owner(ORDERED);
    let deep = format!("{}0{}", "[".repeat(127), "]".repeat(127));
    let left = output_http::material(&host, &client, &deep_owner, b"null").await;
    let right = output_http::material(&host, &client, &deep_owner, deep.as_bytes()).await;
    let (status, result) = invoke(&host, &client, &left, &[right], json!({})).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["resources"][0]["mimeType"], "application/json");

    let malformed = output_http::material(&host, &client, &path_owner, b"{").await;
    let before = host.state.plugin_resources.lock().unwrap().record_count();
    let (status, result) = invoke(&host, &client, &malformed, &[], json!({"query":"$"})).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["result"]["error"]["code"], "INVALID_JSON_OR_QUERY");
    assert!(
        result["resources"].is_null() || result["resources"].as_array().is_some_and(Vec::is_empty)
    );
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before
    );
    let oversized =
        output_http::material(&host, &client, &path_owner, &vec![b' '; MAX_FILE + 1]).await;
    let (status, result) = invoke(&host, &client, &oversized, &[], json!({"query":"$"})).await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(result["error"]["code"], "resource_input_too_large");
    assert!(result["resources"].is_null());

    eprintln!(
        "JSON file Host verified: 3 directory capabilities, two ordered grants, failed save confirmation writes nothing, byte-identical .json export, malformed and oversized inputs rejected, no user data"
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    let root = root.canonicalize().unwrap();
    assert_eq!(root.parent(), Some(scratch.as_path()));
    std::fs::remove_dir_all(root).unwrap();
}

async fn response(result: reqwest::Response) -> (StatusCode, Value) {
    (result.status(), result.json().await.unwrap())
}

async fn invoke(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
    additional: &[Value],
    input: Value,
) -> (StatusCode, Value) {
    let (status, ticket) = response(output_http::post(host, client, "prepare-call",
        json!({"schemaVersion":1,"access":access,"additionalAccesses":additional,"input":input})).await).await;
    if status != StatusCode::OK {
        return (status, ticket);
    }
    response(
        output_http::post(
            host,
            client,
            "invoke-call",
            json!({"access":access,"additionalAccesses":additional,"callId":ticket["callId"],
               "hostInstanceId":ticket["hostInstanceId"],"input":input}),
        )
        .await,
    )
    .await
}

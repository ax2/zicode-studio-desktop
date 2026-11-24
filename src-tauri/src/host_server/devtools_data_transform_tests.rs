//! Runs the existing Compute package through the Windows Host for table preview fixtures.

use super::*;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compute package, its external receipt and a production Windows Worker"]
async fn data_transform_preview_frozen_host_results() {
    let candidate = PathBuf::from(std::env::var_os("ZICODE_TEST_COMPUTE_PACKAGE").unwrap());
    let receipt = candidate.with_file_name(format!(
        "{}-verification.json",
        candidate.file_name().unwrap().to_string_lossy(),
    ));
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    super::inspect_011_host_tests::verify_receipt(&project, &candidate, &receipt, 8);

    let root = project.join(".cache/task-scratch").join(format!(
        "compute-transform-preview-{}",
        uuid::Uuid::new_v4()
    ));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Compute data transform Host/Worker acceptance","lifetime":"remove on success; retain failures"}"#,
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let workspace = "27a89235-43d6-47be-9b76-b8578c05ea86";
    runtimes
        .register_tool_session(RuntimeTarget::new(
            workspace,
            "table-preview",
            "table-runtime",
        ))
        .unwrap();
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let plugin = "com.zicode.devtools.compute";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&candidate).unwrap(), plugin);
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable);

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let long_header = "标签".repeat(90);
    let inputs = [
        ("integer", "integer", "csv", "amount", "amount,active\n9223372036854775807,true\n-9223372036854775808,false".to_owned()),
        ("failed-row", "integer", "csv", "amount", "amount,active\n42,true\ninvalid,false\n56,true".to_owned()),
        ("empty-table", "trim", "csv", "name", "name,category\n".to_owned()),
        ("long-header", "trim", "csv", &long_header, format!("{long_header},category\n  Zi Tools  ,local")),
        ("duplicate-header", "trim", "csv", "name", "name,name\na,b".to_owned()),
        ("nested", "trim", "json", "name", r#"[{"name":"  Zi  ","nested":{"amount":18446744073709551615,"flags":[true,null,{"tag":"保留"}]}}]"#.to_owned()),
    ];
    for (name, op, format, column, text) in inputs {
        let body = json!({
            "workspaceId": workspace,
            "sceneId": "programming",
            "pluginId": plugin,
            "capabilityId": format!("devtools.compute.transform.{op}"),
            "captureResult": true,
            "input": {"text":text,"options":json!({"format":format,"column":column}).to_string()},
        });
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{name}");
        let response: Value = response.json().await.unwrap();
        let result = &response["result"];
        if matches!(name, "failed-row" | "duplicate-header") {
            assert_eq!(result["ok"], false);
            assert!(result["data"].is_null());
            assert!(response["resultRef"].is_null());
            assert_eq!(result["error"]["code"], "INVALID_INPUT");
            let message = result["error"]["message"].as_str().unwrap();
            if name == "failed-row" {
                assert_eq!(message, "第 2 行，列 amount 转换失败；原数据未修改");
            } else {
                assert!(message.contains("重复"));
            }
        } else {
            assert_eq!(result["ok"], true, "{name}: {result}");
            assert_eq!(response["resultRef"]["mimeType"], "text/plain");
            assert_eq!(response["resultRef"]["csvExport"]["mimeType"], "text/csv");
            let text = result["data"]["text"].as_str().unwrap();
            let parsed: Value = serde_json::from_str(text).unwrap();
            match name {
                "integer" => {
                    assert_eq!(parsed["changed"], 2);
                    assert_eq!(parsed["data"]["rows"][0][0], i64::MAX);
                    assert_eq!(parsed["data"]["rows"][1][0], i64::MIN);
                    let csv = parsed["csv"].as_str().unwrap();
                    assert_eq!(
                        csv.lines().collect::<Vec<_>>(),
                        [
                            "amount,active",
                            "9223372036854775807,true",
                            "-9223372036854775808,false"
                        ]
                    );
                    verify_csv_export(&host, &root, workspace, &response, csv);
                }
                "empty-table" => {
                    assert_eq!(parsed["data"]["headers"], json!(["name", "category"]));
                    assert_eq!(parsed["data"]["rows"], json!([]));
                }
                "long-header" => {
                    assert_eq!(parsed["data"]["headers"][0], long_header);
                    assert_eq!(parsed["data"]["rows"][0][0], "Zi Tools");
                }
                "nested" => {
                    assert_eq!(parsed["data"]["rows"][0][0], "Zi");
                    assert_eq!(parsed["data"]["rows"][0][1]["amount"], u64::MAX);
                    assert_eq!(parsed["data"]["rows"][0][1]["flags"][2]["tag"], "保留");
                }
                _ => unreachable!(),
            }
        }
        println!(
            "DATA_TRANSFORM_RESPONSE {}",
            json!({"name":name,"request":body["input"],"result":result})
        );
    }
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

fn verify_csv_export(
    host: &HostServer,
    root: &std::path::Path,
    workspace: &str,
    response: &Value,
    expected: &str,
) {
    use super::plugin_resources::export::Context;

    let scope = json!({
        "workspaceId": workspace, "sceneId": "programming",
        "pluginId": "com.zicode.devtools.compute", "capabilityId": "devtools.compute.transform.integer",
    });
    let reference = &response["resultRef"];
    let descriptor = &reference["csvExport"];
    assert_eq!(
        descriptor,
        &json!({
            "mimeType": "text/csv", "byteLength": expected.len(), "contentVersion": sha256_hex(expected.as_bytes()),
        })
    );
    let source = json!({"scope": scope, "resultId": reference["resultId"], "format": "csv"});
    let mut plain = source.clone();
    plain.as_object_mut().unwrap().remove("format");
    let context = Context {
        window: "main".into(),
        workspace: workspace.into(),
        route: format!("/app/workspaces/{workspace}/tools"),
    };
    let metadata = host
        .result_text_export_metadata(&context, source.clone())
        .unwrap();
    assert_eq!(metadata["suggestedFileName"], "data-transform.csv");
    assert_eq!(metadata["extension"], "csv");
    assert_eq!(metadata["mimeType"], "text/csv");
    assert_eq!(metadata["contentVersion"], descriptor["contentVersion"]);
    let plain_metadata = host
        .result_text_export_metadata(&context, plain.clone())
        .unwrap();
    assert_eq!(plain_metadata["mimeType"], "text/plain");
    assert_eq!(
        plain_metadata["contentVersion"],
        reference["contentVersion"]
    );

    let folder = root.canonicalize().unwrap().join("exports");
    std::fs::create_dir(&folder).unwrap();
    assert!(host
        .prepare_result_text_export(context.clone(), source.clone(), folder.join("wrong.txt"),)
        .is_err());
    let prepare = |name| {
        let grant = host
            .prepare_result_text_export(context.clone(), source.clone(), folder.join(name))
            .unwrap();
        assert_eq!(
            grant["preview"]["contentVersion"],
            descriptor["contentVersion"]
        );
        assert_eq!(grant["preview"]["byteLength"], descriptor["byteLength"]);
        grant["grantId"].as_str().unwrap().to_owned()
    };
    let cancelled = prepare("cancelled.csv");
    host.cancel_result_text_export(context.clone(), source.clone(), cancelled.clone())
        .unwrap();
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), cancelled, true)
        .is_err());

    let grant = prepare("转换结果.CSV");
    let mut foreign = context.clone();
    foreign.route.push_str("/other");
    assert!(host
        .commit_result_text_export(foreign, source.clone(), grant.clone(), true)
        .is_err());
    assert!(host
        .commit_result_text_export(context.clone(), plain, grant.clone(), true)
        .is_err());
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), grant.clone(), false)
        .is_err());
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 0);
    let result = host
        .commit_result_text_export(context.clone(), source.clone(), grant.clone(), true)
        .unwrap();
    assert_eq!(result["profile"], "result.export.csv.v1");
    assert_eq!(result["receipt"]["mimeType"], "text/csv");
    assert_eq!(
        result["receipt"]["contentVersion"],
        descriptor["contentVersion"]
    );
    assert_eq!(
        std::fs::read(folder.join("转换结果.CSV")).unwrap(),
        expected.as_bytes()
    );
    assert_eq!(
        host.verify_result_text_export(context.clone(), source.clone(), grant.clone())
            .unwrap()["status"],
        "verified"
    );
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), grant, true)
        .is_err());

    let collision = prepare("collision.csv");
    std::fs::write(folder.join("collision.csv"), b"existing").unwrap();
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), collision, true)
        .is_err());
    assert_eq!(
        std::fs::read(folder.join("collision.csv")).unwrap(),
        b"existing"
    );
    let revoked = prepare("revoked.csv");
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.devtools.compute", false)
        .unwrap();
    assert!(host
        .commit_result_text_export(context, source, revoked, true)
        .is_err());
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.devtools.compute", true)
        .unwrap();
    assert_eq!(std::fs::read_dir(folder).unwrap().count(), 2);
    println!(
        "DATA_TRANSFORM_CSV bytes={} sha256={}",
        expected.len(),
        descriptor["contentVersion"]
    );
}

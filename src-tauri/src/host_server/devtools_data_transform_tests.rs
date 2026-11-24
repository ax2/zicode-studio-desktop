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
            let text = result["data"]["text"].as_str().unwrap();
            let parsed: Value = serde_json::from_str(text).unwrap();
            match name {
                "integer" => {
                    assert_eq!(parsed["changed"], 2);
                    assert_eq!(parsed["data"]["rows"][0][0], i64::MAX);
                    assert_eq!(parsed["data"]["rows"][1][0], i64::MIN);
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

//! Runs the existing Compute package through the Windows Host for table preview fixtures.

use super::*;
use serde_json::value::RawValue;

pub(super) const WORKSPACE: &str = "27a89235-43d6-47be-9b76-b8578c05ea86";
const PLUGIN: &str = "com.zicode.devtools.compute";

async fn start_compute_host(purpose: &str) -> (PathBuf, HostServer) {
    start_frozen_export_host(purpose, "ZICODE_TEST_COMPUTE_PACKAGE", PLUGIN, 8).await
}

pub(super) async fn start_frozen_export_host(
    purpose: &str,
    package: &str,
    plugin: &str,
    file_count: usize,
) -> (PathBuf, HostServer) {
    let candidate = PathBuf::from(std::env::var_os(package).unwrap());
    let receipt = candidate.with_file_name(format!(
        "{}-verification.json",
        candidate.file_name().unwrap().to_string_lossy(),
    ));
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    super::inspect_011_host_tests::verify_receipt(&project, &candidate, &receipt, file_count);

    let root = project
        .join(".cache/task-scratch")
        .join(format!("export-{purpose}-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose": format!("{purpose} Host/Worker acceptance"), "lifetime": "remove on success; retain failures"}).to_string(),
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    runtimes
        .register_tool_session(RuntimeTarget::new(
            WORKSPACE,
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
    (root, host)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compute package, its external receipt and a production Windows Worker"]
async fn data_transform_preview_frozen_host_results() {
    let (root, host) = start_compute_host("transform-preview").await;
    let (workspace, plugin) = (WORKSPACE, PLUGIN);

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
            assert_eq!(
                response["resultRef"]["jsonExport"]["mimeType"],
                "application/json"
            );
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
                    let raw: HashMap<String, &RawValue> = serde_json::from_str(text).unwrap();
                    verify_table_export(
                        &host,
                        &root,
                        workspace,
                        &response,
                        ExportCase {
                            format: "json",
                            mime_type: "application/json",
                            operation: &format!("transform.{op}"),
                            stem: "data-transform",
                            expected: raw["data"].get(),
                            revoke: false,
                        },
                    );
                    verify_table_export(
                        &host,
                        &root,
                        workspace,
                        &response,
                        ExportCase {
                            format: "csv",
                            mime_type: "text/csv",
                            operation: &format!("transform.{op}"),
                            stem: "data-transform",
                            expected: csv,
                            revoke: true,
                        },
                    );
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
                    let raw: HashMap<String, &RawValue> = serde_json::from_str(text).unwrap();
                    let file = verify_table_export(
                        &host,
                        &root,
                        workspace,
                        &response,
                        ExportCase {
                            format: "json",
                            mime_type: "application/json",
                            operation: &format!("transform.{op}"),
                            stem: "data-transform",
                            expected: raw["data"].get(),
                            revoke: true,
                        },
                    );
                    let mut replay = body.clone();
                    replay["input"]["text"] = json!(std::fs::read_to_string(file).unwrap());
                    let round_trip = client
                        .post(&endpoint)
                        .header("x-zicode-desktop-token", host.desktop_token())
                        .json(&replay)
                        .send()
                        .await
                        .unwrap();
                    assert_eq!(round_trip.status(), StatusCode::OK);
                    let result: Value = round_trip.json().await.unwrap();
                    assert_eq!(result["result"]["ok"], true);
                    let input: Value =
                        serde_json::from_str(result["result"]["data"]["text"].as_str().unwrap())
                            .unwrap();
                    assert_eq!(input["data"], parsed["data"]);
                }
                _ => unreachable!(),
            }
        }
        println!(
            "DATA_TRANSFORM_RESPONSE {}",
            json!({"name":name,"request":body["input"],"result":result})
        );
    }
    let pairs = [
        (
            "left",
            "csv",
            "id,name\n1,A\n2,B",
            "id,name\n1,X\n1,Y",
            "id,name,id_right1,name_right1\n1,A,1,X\n1,A,1,Y\n2,B,,\n",
        ),
        (
            "inner",
            "tsv",
            "id\tname\n1\tA\n2\tB",
            "id\tname\n1\tX\n1\tY",
            "id,name,id_right1,name_right1\n1,A,1,X\n1,A,1,Y\n",
        ),
        (
            "append",
            "json",
            r#"{"headers":["id","name"],"rows":[[9223372036854775807,"甲"],[-9223372036854775808,"乙"]]}"#,
            r#"{"headers":["name","id"],"rows":[["丙",18446744073709551615]]}"#,
            "id,name\n9223372036854775807,甲\n-9223372036854775808,乙\n18446744073709551615,丙\n",
        ),
        (
            "columns",
            "csv",
            "id,name\n1,A\n2,B",
            "name,id\nX,3\nY,4",
            "id,name,name_right1,id_right1\n1,A,X,3\n2,B,Y,4\n",
        ),
    ];
    for (mode, format, left, right, expected_csv) in pairs {
        let operation = format!("merge.{mode}");
        let capability_id = format!("devtools.compute.{operation}");
        let body = json!({
            "workspaceId": workspace,
            "sceneId": "programming",
            "pluginId": plugin,
            "capabilityId": capability_id,
            "captureResult": true,
            "input": {"text": left, "options": json!({
                "format": format, "right": right, "left_key": "id", "right_key": "id"
            }).to_string()}
        });
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response: Value = response.json().await.unwrap();
        assert_eq!(response["result"]["ok"], true, "{mode}: {response}");
        let text = response["result"]["data"]["text"].as_str().unwrap();
        let fields: HashMap<String, &RawValue> = serde_json::from_str(text).unwrap();
        let csv: String = serde_json::from_str(fields["csv"].get()).unwrap();
        assert_eq!(csv, expected_csv, "{mode}");
        let table = fields["data"].get();
        verify_table_export(
            &host,
            &root,
            workspace,
            &response,
            ExportCase {
                format: "csv",
                mime_type: "text/csv",
                operation: &operation,
                stem: "csv-merge",
                expected: expected_csv,
                revoke: false,
            },
        );
        let file = verify_table_export(
            &host,
            &root,
            workspace,
            &response,
            ExportCase {
                format: "json",
                mime_type: "application/json",
                operation: &operation,
                stem: "csv-merge",
                expected: table,
                revoke: true,
            },
        );
        if mode == "append" {
            let read_back = std::fs::read_to_string(file).unwrap();
            let table: Value = serde_json::from_str(&read_back).unwrap();
            assert_eq!(table["rows"][0][0], i64::MAX);
            assert_eq!(table["rows"][1][0], i64::MIN);
            assert_eq!(table["rows"][2][0], u64::MAX);
        }
        println!(
            "CSV_MERGE_EXPORT mode={mode} csv_bytes={} json_bytes={}",
            expected_csv.len(),
            table.len()
        );
    }
    let quality = [
        (
            "json",
            r#"[{"数值":9223372036854775807},{"数值":9223372036854775806},{"数值":9223372036854775807},{"数值":" "},{}]"#,
            5,
            1,
        ),
        ("csv", "城市,标签\r\n广州,A\r\n广州,A\r\n北京, ", 3, 0),
        ("tsv", "城市\t标签\r\n广州\tA\r\n广州\tA\r\n北京\t ", 3, 0),
    ];
    for (format, input, rows, missing) in quality {
        let operation = format!("quality.{format}");
        let request = json!({
            "workspaceId": workspace, "sceneId": "programming", "pluginId": plugin,
            "capabilityId": format!("devtools.compute.{operation}"), "captureResult": true,
            "input": {"text": input},
        });
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response: Value = response.json().await.unwrap();
        assert_eq!(response["result"]["ok"], true, "{format}: {response}");
        assert!(response["resultRef"]["csvExport"].is_null());
        let text = response["result"]["data"]["text"].as_str().unwrap();
        let report: Value = serde_json::from_str(text).unwrap();
        assert_eq!(report["rows"], rows);
        assert_eq!(report["duplicateRowsAfterFirst"], 1);
        let column = &report["columns"][if format == "json" { 0 } else { 1 }];
        assert_eq!(
            column["column"],
            if format == "json" { "数值" } else { "标签" }
        );
        assert_eq!(column["missingOrNull"], missing);
        assert_eq!(column["blankStrings"], 1);
        assert_eq!(column["mixedNonNullTypes"], format == "json");
        verify_table_export(
            &host,
            &root,
            workspace,
            &response,
            ExportCase {
                format: "json",
                mime_type: "application/json",
                operation: &operation,
                stem: "data-quality-report",
                expected: text,
                revoke: true,
            },
        );
        println!("DATA_QUALITY_REPORT format={format} bytes={}", text.len());
    }

    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compute 0.2.0, its external receipt and a production Windows Worker"]
async fn data_workbench_frozen_host_exports() {
    let (root, host) = start_compute_host("workbench-export").await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let input = r#"{"headers":["id","name"],"rows":[[18446744073709551615,"甲,组"],[9223372036854775807,"乙"],[-9223372036854775808,"丙"]]}"#;
    for (mode, format, mime_type) in [
        ("json", "json", "application/json"),
        ("csv", "csv", "text/csv"),
        ("query", "json", "application/json"),
        ("query", "csv", "text/csv"),
        ("query", "tsv", "text/tab-separated-values"),
    ] {
        let operation = format!("table.{mode}");
        let options = if mode == "query" {
            json!({"format":"json","query":"甲","output":format})
        } else {
            json!({"format":"json"})
        };
        let request = json!({
            "workspaceId": WORKSPACE, "sceneId": "programming", "pluginId": PLUGIN,
            "capabilityId": format!("devtools.compute.{operation}"), "captureResult": true,
            "input": {"text": input, "options": options.to_string()},
        });
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response: Value = response.json().await.unwrap();
        assert_eq!(
            response["result"]["ok"], true,
            "{mode}/{format}: {response}"
        );
        let report: Value =
            serde_json::from_str(response["result"]["data"]["text"].as_str().unwrap()).unwrap();
        let output = report["text"].as_str().unwrap();
        assert_eq!(report["format"], format);
        assert_eq!(report["inputRows"], 3);
        assert_eq!(report["selectedRows"], if mode == "query" { 1 } else { 3 });
        match (mode, format) {
            ("json", "json") => {
                let rows: Value = serde_json::from_str(output).unwrap();
                assert_eq!(rows, json!([{"id":u64::MAX,"name":"甲,组"},{"id":i64::MAX,"name":"乙"},{"id":i64::MIN,"name":"丙"}]));
            }
            ("csv", "csv") => assert_eq!(output, "id,name\n18446744073709551615,\"甲,组\"\n9223372036854775807,乙\n-9223372036854775808,丙\n"),
            ("query", "json") => assert_eq!(serde_json::from_str::<Value>(output).unwrap(), json!([{"id":u64::MAX,"name":"甲,组"}])),
            ("query", "csv") => assert_eq!(output, "id,name\n18446744073709551615,\"甲,组\"\n"),
            ("query", "tsv") => assert_eq!(output, "id\tname\n18446744073709551615\t甲,组\n"),
            _ => unreachable!(),
        }
        for alternate in ["csv", "tsv", "json"] {
            if alternate != format {
                assert!(response["resultRef"][format!("{alternate}Export")].is_null());
            }
        }
        verify_table_export(
            &host,
            &root,
            WORKSPACE,
            &response,
            ExportCase {
                format,
                mime_type,
                operation: &operation,
                stem: "data-workbench",
                expected: output,
                revoke: true,
            },
        );
        println!(
            "DATA_WORKBENCH_EXPORT {mode}/{format} bytes={}",
            output.len()
        );
    }
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compare 0.1.0 candidate 02, its receipt and a production Windows Worker"]
async fn json_path_frozen_host_exports() {
    let plugin = "com.zicode.devtools.compare";
    let (root, host) =
        start_frozen_export_host("json-path", "ZICODE_TEST_COMPARE_PACKAGE", plugin, 10).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let document = r#"{"项目":[{"金额":9223372036854775807},{"金额":18446744073709551615},{"金额":-9223372036854775808}]}"#;
    let scope = json!({
        "workspaceId": WORKSPACE, "sceneId": "programming", "pluginId": plugin,
        "capabilityId": "devtools.compare.json.path",
    });
    for (name, text, query, expected) in [
        (
            "matched",
            document,
            r#"$.项目[*]["金额"]"#,
            Some(json!([i64::MAX, u64::MAX, i64::MIN])),
        ),
        ("empty", document, "$.缺失[*]", Some(json!([]))),
        ("invalid-query", document, "$..", None),
        ("invalid-json", r#"{"项目":"#, "$.项目[*]", None),
    ] {
        let mut request = scope.clone();
        request["captureResult"] = json!(true);
        request["input"] = json!({"text": text, "query": query});
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let response: Value = response.json().await.unwrap();
        let result = &response["result"];
        if let Some(expected) = expected {
            assert_eq!(result["ok"], true, "{name}: {result}");
            let output = result["data"]["text"].as_str().unwrap();
            assert_eq!(serde_json::from_str::<Value>(output).unwrap(), expected);
            assert_eq!(
                response["resultRef"]["jsonExport"]["contentVersion"],
                response["resultRef"]["contentVersion"]
            );
            assert!(
                response["resultRef"]["csvExport"].is_null()
                    && response["resultRef"]["tsvExport"].is_null()
            );
            verify_result_export(
                &host,
                &root,
                WORKSPACE,
                &scope,
                &response,
                ExportCase {
                    format: "json",
                    mime_type: "application/json",
                    operation: name,
                    stem: "json-path-result",
                    expected: output,
                    revoke: true,
                },
            );
            println!("JSON_PATH_EXPORT {name} bytes={}", output.len());
        } else {
            assert_eq!(result["ok"], false, "{name}: {result}");
            assert_eq!(result["error"]["code"], "INVALID_INPUT");
            assert!(response["resultRef"].is_null());
            println!("JSON_PATH_EXPORT {name} rejected before file grant");
        }
    }
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

struct ExportCase<'a> {
    format: &'static str,
    mime_type: &'static str,
    operation: &'a str,
    stem: &'static str,
    expected: &'a str,
    revoke: bool,
}

fn verify_table_export(
    host: &HostServer,
    root: &std::path::Path,
    workspace: &str,
    response: &Value,
    case: ExportCase<'_>,
) -> PathBuf {
    let scope = json!({
        "workspaceId": workspace, "sceneId": "programming", "pluginId": PLUGIN,
        "capabilityId": format!("devtools.compute.{}", case.operation),
    });
    verify_result_export(host, root, workspace, &scope, response, case)
}

fn verify_result_export(
    host: &HostServer,
    root: &std::path::Path,
    workspace: &str,
    scope: &Value,
    response: &Value,
    case: ExportCase<'_>,
) -> PathBuf {
    use super::plugin_resources::export::Context;
    let ExportCase {
        format,
        mime_type,
        operation,
        stem,
        expected,
        revoke,
    } = case;
    let plugin = scope["pluginId"].as_str().unwrap();
    let reference = &response["resultRef"];
    let is_text = format == "text";
    let extension = if is_text { "txt" } else { format };
    let descriptor = if is_text { reference } else { &reference[format!("{format}Export")] };
    let expected_descriptor = json!({
        "mimeType": mime_type, "byteLength": expected.len(), "contentVersion": sha256_hex(expected.as_bytes()),
    });
    if is_text {
        assert_eq!(descriptor["schemaVersion"], 1);
        for key in ["mimeType", "byteLength", "contentVersion"] {
            assert_eq!(descriptor[key], expected_descriptor[key]);
        }
    } else {
        assert_eq!(descriptor, &expected_descriptor);
    }
    let plain = json!({"scope": scope, "resultId": reference["resultId"]});
    let mut source = plain.clone();
    if !is_text {
        source["format"] = json!(format);
    }
    let context = Context {
        window: "main".into(),
        workspace: workspace.into(),
        route: format!("/app/workspaces/{workspace}/tools"),
    };
    let metadata = host
        .result_text_export_metadata(&context, source.clone())
        .unwrap();
    assert_eq!(metadata["suggestedFileName"], format!("{stem}.{extension}"));
    assert_eq!(metadata["extension"], extension);
    assert_eq!(metadata["mimeType"], mime_type);
    assert_eq!(metadata["contentVersion"], descriptor["contentVersion"]);
    let plain_metadata = host
        .result_text_export_metadata(&context, plain.clone())
        .unwrap();
    assert_eq!(plain_metadata["mimeType"], "text/plain");
    assert_eq!(
        plain_metadata["contentVersion"],
        reference["contentVersion"]
    );

    let folder = root
        .canonicalize()
        .unwrap()
        .join(format!("exports-{operation}-{format}"));
    std::fs::create_dir(&folder).unwrap();
    assert!(host
        .prepare_result_text_export(context.clone(), source.clone(), folder.join("wrong.bin"),)
        .is_err());
    let prepare = |name: &str| {
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
    let cancelled = prepare(&format!("cancelled.{extension}"));
    host.cancel_result_text_export(context.clone(), source.clone(), cancelled.clone())
        .unwrap();
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), cancelled, true)
        .is_err());

    let file_name = format!("工具结果.{}", extension.to_ascii_uppercase());
    let file = folder.join(&file_name);
    let grant = prepare(&file_name);
    let mut foreign = context.clone();
    foreign.route.push_str("/other");
    assert!(host
        .commit_result_text_export(foreign, source.clone(), grant.clone(), true)
        .is_err());
    if is_text {
        let mut other_capability = source.clone();
        other_capability["scope"]["capabilityId"] = json!("devtools.compare.json.path");
        assert!(host
            .prepare_result_text_export(context.clone(), other_capability.clone(), folder.join("other.txt"))
            .is_err());
        assert!(host
            .commit_result_text_export(context.clone(), other_capability, grant.clone(), true)
            .is_err());
    } else {
        assert!(host
            .commit_result_text_export(context.clone(), plain, grant.clone(), true)
            .is_err());
    }
    let mut other_format = source.clone();
    other_format["format"] = json!(if format == "csv" { "json" } else { "csv" });
    assert!(host
        .commit_result_text_export(context.clone(), other_format, grant.clone(), true)
        .is_err());
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), grant.clone(), false)
        .is_err());
    assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 0);
    let result = host
        .commit_result_text_export(context.clone(), source.clone(), grant.clone(), true)
        .unwrap();
    let profile = if is_text { "result.export.text.draft1".to_owned() } else { format!("result.export.{format}.v1") };
    assert_eq!(result["profile"], profile);
    assert_eq!(result["receipt"]["mimeType"], mime_type);
    assert_eq!(
        result["receipt"]["contentVersion"],
        descriptor["contentVersion"]
    );
    assert_eq!(std::fs::read(&file).unwrap(), expected.as_bytes());
    assert_eq!(
        host.verify_result_text_export(context.clone(), source.clone(), grant.clone())
            .unwrap()["status"],
        "verified"
    );
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), grant, true)
        .is_err());

    let collision_name = format!("collision.{extension}");
    let collision = prepare(&collision_name);
    std::fs::write(folder.join(&collision_name), b"existing").unwrap();
    assert!(host
        .commit_result_text_export(context.clone(), source.clone(), collision.clone(), true)
        .is_err());
    assert_eq!(
        std::fs::read(folder.join(&collision_name)).unwrap(),
        b"existing"
    );
    // The dialog cancels its unused grant when closed after a rejected write.
    host.cancel_result_text_export(context.clone(), source.clone(), collision)
        .unwrap();
    if revoke {
        let revoked = prepare(&format!("revoked.{extension}"));
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_enabled("programming", plugin, false)
            .unwrap();
        assert!(host
            .commit_result_text_export(context.clone(), source.clone(), revoked.clone(), true)
            .is_err());
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_enabled("programming", plugin, true)
            .unwrap();
        host.cancel_result_text_export(context, source, revoked)
            .unwrap();
    }
    assert_eq!(std::fs::read_dir(folder).unwrap().count(), 2);
    println!(
        "RESULT_EXPORT_{} bytes={} sha256={}",
        format.to_ascii_uppercase(),
        expected.len(),
        descriptor["contentVersion"]
    );
    file
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compare 0.1.0 candidate 02, its receipt and a production Windows Worker"]
async fn text_diff_frozen_host_exports_original_reports() {
    let plugin = "com.zicode.devtools.compare";
    let (root, host) =
        start_frozen_export_host("text-diff", "ZICODE_TEST_COMPARE_PACKAGE", plugin, 10).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let scope = json!({
        "workspaceId": WORKSPACE, "sceneId": "programming", "pluginId": plugin,
        "capabilityId": "devtools.compare.text.diff",
    });
    let at_limit = "a".repeat(8192);
    for (name, left, right, expected) in [
        ("different", "序言\r\n旧值  \r\n收尾\r\n", "序言\r\n新值  \r\n收尾\r\n", vec!["-旧值  ", "+新值  "]),
        ("new-with-no-final-newline", "", "新增", vec!["+新增", "\\ No newline at end of file"]),
        ("both-empty", "", "", vec!["两份文本完全相同"]),
        ("boundary", at_limit.as_str(), at_limit.as_str(), vec!["两份文本完全相同"]),
    ] {
        let mut request = scope.clone();
        request["captureResult"] = json!(true);
        request["input"] = json!({"left":left, "right":right});
        let response: Value = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        let result = &response["result"];
        assert_eq!(result["ok"], true, "{name}: {result}");
        let diff = result["data"]["text"].as_str().unwrap();
        for exact_line in expected {
            assert!(diff.lines().any(|line| line == exact_line), "{name}: {diff}");
        }
        verify_result_export(&host, &root, WORKSPACE, &scope, &response, ExportCase {
            format: "text", mime_type: "text/plain", operation: name, stem: "text-diff-report",
            expected: diff, revoke: name == "boundary",
        });
        println!("verified text diff case {name}");
    }
    host.stop();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compare 0.1.0 candidate 02, its receipt and a production Windows Worker"]
async fn structured_json_diff_frozen_host_exports_original_reports() {
    use super::plugin_resources::export::Context;

    let plugin = "com.zicode.devtools.compare";
    let (root, host) =
        start_frozen_export_host("structured-json-diff", "ZICODE_TEST_COMPARE_PACKAGE", plugin, 10)
            .await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let original = r#"{"项目/名~":[1,1,2],"amount":18446744073709551614,"min":-9223372036854775807}"#;
    let changed = r#"{"项目/名~":[3,2,1],"amount":18446744073709551615,"min":-9223372036854775808}"#;
    let reordered = r#"{"项目/名~":[2,1,1],"min":-9223372036854775807,"amount":18446744073709551614}"#;
    let context = Context {
        window: "main".into(),
        workspace: WORKSPACE.into(),
        route: format!("/app/workspaces/{WORKSPACE}/tools"),
    };

    for (mode, label, pointer, other_mode) in [
        ("ordered", "by index", "/项目~1名~0/0", "unordered"),
        ("unordered", "ignored (duplicates retained)", "/项目~1名~0", "ordered"),
    ] {
        let scope = json!({
            "workspaceId": WORKSPACE, "sceneId": "programming", "pluginId": plugin,
            "capabilityId": format!("devtools.compare.json.diff.{mode}"),
        });
        let invoke = async |right: &str| -> Value {
            let mut body = scope.clone();
            body["captureResult"] = json!(true);
            body["input"] = json!({ "left": original, "right": right });
            client
                .post(&endpoint)
                .header("x-zicode-desktop-token", host.desktop_token())
                .json(&body)
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap()
        };

        for (name, right, equal) in [
            ("changes", changed, false),
            ("identical", original, true),
            ("reordered", reordered, mode == "unordered"),
        ] {
            let response = invoke(right).await;
            let result = &response["result"];
            assert_eq!(result["ok"], true, "{mode}/{name}: {result}");
            let report = result["data"]["text"].as_str().unwrap();
            let json: Value = serde_json::from_str(report).unwrap();
            assert_eq!(json["equal"], equal);
            assert_eq!(json["arrayOrder"], label);
            let changes = json["changes"].as_array().unwrap();
            assert_eq!(changes.is_empty(), equal);
            if name == "changes" {
                assert!(changes.iter().any(|change| change["path"] == pointer));
                let amount = changes.iter().find(|change| change["path"] == "/amount").unwrap();
                assert_eq!(amount["before"], u64::MAX - 1);
                assert_eq!(amount["after"], u64::MAX);
                let min = changes.iter().find(|change| change["path"] == "/min").unwrap();
                assert_eq!(min["after"], i64::MIN);

                let mut foreign_scope = scope.clone();
                foreign_scope["capabilityId"] = json!(format!("devtools.compare.json.diff.{other_mode}"));
                assert!(host
                    .result_text_export_metadata(&context, json!({
                        "scope": foreign_scope, "resultId": response["resultRef"]["resultId"],
                        "format": "json"
                    }))
                    .is_err());
            }
            let case = format!("{mode}-{name}");
            verify_result_export(
                &host, &root, WORKSPACE, &scope, &response,
                ExportCase {
                    format: "json", mime_type: "application/json", operation: &case,
                    stem: "json-diff-report", expected: report, revoke: name == "reordered",
                },
            );
            println!("verified structured JSON diff {case}");
        }

        let invalid = invoke(r#"{"missing":}"#).await;
        assert_eq!(invalid["result"]["ok"], false);
        assert!(invalid["resultRef"].is_null());
    }
    host.stop();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Compute candidate and Windows production Worker to capture merge preview samples"]
async fn csv_merge_preview_frozen_host_responses() {
    let (root, host) = start_compute_host("merge-table-view").await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let cases = [
        (
            "left",
            "csv",
            "id,label\n1,A\n2,B",
            "id,label\n1,X\n1,Y",
            "id",
            "id",
        ),
        (
            "inner",
            "tsv",
            "id\tlabel\n1\tA",
            "id\tlabel\n2\tB",
            "id",
            "id",
        ),
        (
            "append",
            "json",
            r#"{"headers":["amount","details"],"rows":[[9223372036854775807,{"nested":18446744073709551615}]]}"#,
            r#"{"headers":["details","amount"],"rows":[[null,-9223372036854775808]]}"#,
            "",
            "",
        ),
        ("columns", "csv", "id,label\n1,A", "label,id\nX,3", "", ""),
    ];
    for (mode, format, left, right, left_key, right_key) in cases {
        let request = json!({
            "workspaceId": WORKSPACE, "sceneId": "programming", "pluginId": PLUGIN,
            "capabilityId": format!("devtools.compute.merge.{mode}"), "captureResult": true,
            "input": {"text": left, "options": json!({"format": format, "right": right, "left_key": left_key, "right_key": right_key}).to_string()},
        });
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{mode}: {}",
            response.text().await.unwrap()
        );
        let response: Value = response.json().await.unwrap();
        let result = &response["result"];
        assert_eq!(result["ok"], true, "{mode}: {result}");
        assert_eq!(response["resultRef"]["csvExport"]["mimeType"], "text/csv");
        assert_eq!(
            response["resultRef"]["jsonExport"]["mimeType"],
            "application/json"
        );
        println!(
            "CSV_MERGE_RESPONSE {}",
            json!({"name": mode, "result": result})
        );
    }
    host.stop_and_wait().await.unwrap();
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    assert!(
        root.canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap())
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[path = "devtools_table_merge_tests.rs"]
mod table_merge_tests;

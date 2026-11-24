//! Exact frozen mixed-format plugin import, normal directory and confirmed save.
use super::*;

const MERGE_PLUGIN: &str = "com.zicode.devtools.table-merge";
const SCENE: &str = "programming";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen independent Table Merge candidate and production Windows Worker"]
async fn frozen_table_merge_exports_both_formats() {
    let (root, host) = start_frozen_export_host(
        "independent-merge",
        "ZICODE_TEST_TABLE_MERGE_PACKAGE",
        MERGE_PLUGIN,
        8,
    )
    .await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let directory = format!("{}/v2/plugin-tool-directory", host.origin());
    let inputs = [
        (
            "left",
            "csv",
            "json",
            "id,label\n1,左\n2,缺",
            r#"[{"id":1,"value":0},{"id":"1","value":18446744073709551615}]"#,
            json!({"headers":["id","label","id_right1","value"],"rows":[["1","左","1",u64::MAX],["2","缺",null,null]]}),
        ),
        (
            "inner",
            "tsv",
            "csv",
            "id\tlabel\n1\tL\n2\tmiss",
            "id,team\n1,R\n3,skip",
            json!({"headers":["id","label","id_right1","team"],"rows":[["1","L","1","R"]]}),
        ),
        (
            "append",
            "csv",
            "json",
            "label,amount\n原件,001",
            r#"{"headers":["amount","label"],"rows":[[-9223372036854775808,"低"],[9223372036854775807,"高"]]}"#,
            json!({"headers":["label","amount"],"rows":[["原件","001"],["低",i64::MIN],["高",i64::MAX]]}),
        ),
        (
            "columns",
            "json",
            "tsv",
            r#"[{"id":1,"state":true}]"#,
            "id\tname\n001\t甲",
            json!({"headers":["id","state","id_right1","name"],"rows":[[1,true,"001","甲"]]}),
        ),
    ];
    for (mode, left_format, right_format, left, right, expected) in inputs {
        let page: Value = client
            .get(&directory)
            .header("x-zicode-desktop-token", host.desktop_token())
            .query(&[
                ("sceneId", SCENE),
                ("pluginId", MERGE_PLUGIN),
                ("query", "两表合并"),
            ])
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(page["total"], 4);
        let revision = page["revision"].as_str().unwrap();
        let capability = format!("devtools.table-merge.{mode}");
        let detail: Value = client
            .get(format!("{directory}/detail"))
            .header("x-zicode-desktop-token", host.desktop_token())
            .query(&[
                ("sceneId", SCENE),
                ("pluginId", MERGE_PLUGIN),
                ("capabilityId", &capability),
                ("revision", revision),
            ])
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        for key in ["leftFormat", "rightFormat"] {
            assert_eq!(
                detail["capability"]["inputSchema"]["properties"][key]["enum"],
                json!(["csv", "tsv", "json"])
            );
        }
        assert_eq!(detail["permissions"], json!([]));
        let scope = json!({"workspaceId":WORKSPACE, "sceneId":SCENE, "pluginId":MERGE_PLUGIN, "capabilityId":capability});
        let mut request = scope.clone();
        request["input"] =
            json!({"left":left,"right":right,"leftFormat":left_format,"rightFormat":right_format});
        request["captureResult"] = json!(true);
        request["catalogRevision"] = json!(revision);
        let response = client
            .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
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
        assert_eq!(response["result"]["ok"], true, "{response}");
        let text = response["result"]["data"]["text"].as_str().unwrap();
        let result: Value = serde_json::from_str(text).unwrap();
        assert_eq!(result["data"], expected, "{mode}");
        let fields: HashMap<String, &RawValue> = serde_json::from_str(text).unwrap();
        let csv = result["csv"].as_str().unwrap();
        for (format, mime_type, bytes) in [
            ("csv", "text/csv", csv),
            ("json", "application/json", fields["data"].get()),
        ] {
            verify_result_export(
                &host,
                &root,
                WORKSPACE,
                &scope,
                &response,
                ExportCase {
                    format,
                    mime_type,
                    operation: mode,
                    stem: "csv-merge",
                    expected: bytes,
                    revoke: format == "json",
                },
            );
        }
        println!(
            "INDEPENDENT_MERGE_HOST_RESPONSE {}",
            json!({"name":mode, "input":request["input"], "result":response["result"]})
        );
    }
    let body = json!({"workspaceId":WORKSPACE,"sceneId":SCENE,"pluginId":MERGE_PLUGIN,
        "capabilityId":"devtools.table-merge.left","captureResult":true,
        "input":{"left":"id\n1","right":"{","leftFormat":"csv","rightFormat":"json"}});
    let rejected: Value = client
        .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&body)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(rejected["result"]["ok"], false);
    assert!(rejected["resultRef"].is_null());
    host.stop_and_wait().await.unwrap();
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    assert!(
        root.canonicalize()
            .unwrap()
            .starts_with(scratch.canonicalize().unwrap())
    );
    std::fs::remove_dir_all(root).unwrap();
}

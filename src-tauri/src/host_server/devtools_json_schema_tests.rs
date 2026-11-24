//! The external frozen JSON Schema package as used from the normal tool directory.
use super::devtools_data_transform_tests::{WORKSPACE, start_frozen_export_host};
use super::*;

const PLUGIN: &str = "com.zicode.devtools.json-schema";
const CAPABILITY: &str = "devtools.json-schema.validate";
const SCENE: &str = "programming";

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen JSON Schema candidate, receipt and a production Windows Worker"]
async fn frozen_json_schema_discovery_detail_and_offline_validation() {
    let (root, host) =
        start_frozen_export_host("json-schema", "ZICODE_TEST_JSON_SCHEMA_PACKAGE", PLUGIN, 8).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let headers = "x-zicode-desktop-token";
    let directory = format!("{}/v2/plugin-tool-directory", host.origin());
    let page: Value = client
        .get(&directory)
        .header(headers, host.desktop_token())
        .query(&[
            ("sceneId", SCENE),
            ("pluginId", PLUGIN),
            ("query", "json schema validator"),
        ])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["capabilityId"], CAPABILITY);
    assert_eq!(page["items"][0]["enabled"], true);
    assert_eq!(page["items"][0]["categoryId"], "data");
    let revision = page["revision"].as_str().unwrap();
    let detail: Value = client
        .get(format!("{directory}/detail"))
        .header(headers, host.desktop_token())
        .query(&[
            ("sceneId", SCENE),
            ("pluginId", PLUGIN),
            ("capabilityId", CAPABILITY),
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
    assert_eq!(
        detail["capability"]["inputSchema"]["required"],
        json!(["instance", "schema"])
    );
    assert_eq!(
        detail["capability"]["inputSchema"]["properties"]["instance"]["maxLength"],
        8192
    );
    assert_eq!(
        detail["capability"]["inputSchema"]["properties"]["schema"]["maxLength"],
        8192
    );
    assert_eq!(detail["permissions"], json!([]));
    assert!(detail["resourceInputProfile"].is_null());

    let mut cases = Vec::new();
    for draft in [4, 6, 7] {
        let schema = json!({
            "$schema": format!("http://json-schema.org/draft-0{draft}/schema#"),
            "definitions":{"amount":{"type":"integer"}},
            "properties":{"项目/名~":{"$ref":"#/definitions/amount"}},
            "required":["项目/名~"]
        })
        .to_string();
        cases.push((
            format!("draft-{draft}-valid"),
            r#"{"项目/名~":18446744073709551615}"#.to_owned(),
            schema.clone(),
            true,
            "校验通过",
        ));
        cases.push((
            format!("draft-{draft}-invalid"),
            r#"{"项目/名~":"private-fixture"}"#.to_owned(),
            schema,
            true,
            "/项目~1名~0",
        ));
    }
    cases.extend([
        (
            "default-draft".into(),
            "\"value\"".to_owned(),
            r#"{"if":{"type":"string"},"then":{"minLength":6}}"#.to_owned(),
            true,
            "校验失败",
        ),
        (
            "unsupported-draft".into(),
            "1".into(),
            r#"{"$schema":"https://json-schema.org/draft/2020-12/schema"}"#.into(),
            false,
            "Draft 4, 6 and 7",
        ),
        (
            "external-reference".into(),
            "1".into(),
            r#"{"$ref":"file:///fixture/other.json"}"#.into(),
            false,
            "已拒绝引用",
        ),
        (
            "bounded-pointer".into(),
            json!({("x".repeat(2000)): vec![0; 12]}).to_string(),
            r#"{"additionalProperties":{"type":"array","items":{"type":"string"}}}"#.into(),
            true,
            "校验报告已达到显示上限",
        ),
    ]);
    for (label, instance, schema, ok, expected) in cases {
        let request = json!({
            "workspaceId":WORKSPACE, "sceneId":SCENE, "pluginId":PLUGIN, "capabilityId":CAPABILITY,
            "catalogRevision":revision, "captureResult":true, "input":{"instance":instance,"schema":schema},
        });
        let response = client
            .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
            .header(headers, host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "{label}: {}",
            response.text().await.unwrap()
        );
        let response: Value = response.json().await.unwrap();
        let result = &response["result"];
        assert_eq!(result["ok"], ok, "{label}: {result}");
        assert_eq!(result["contractVersion"], "1.0.0-rc.1");
        let bytes = serde_json::to_vec(result).unwrap();
        assert!(bytes.len() <= 48 * 1024);
        if ok {
            let text = result["data"]["text"].as_str().unwrap();
            assert!(text.contains(expected), "{label}: {text}");
            assert!(
                !text.contains("private-fixture"),
                "{label}: leaked fixture value"
            );
            assert_eq!(response["resultRef"]["mimeType"], "text/plain");
        } else {
            assert_eq!(result["error"]["code"], "VALIDATION_FAILED");
            assert!(
                result["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains(expected)
            );
            assert!(response["resultRef"].is_null());
        }
        println!("JSON_SCHEMA_HOST {label} {} bytes", bytes.len());
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

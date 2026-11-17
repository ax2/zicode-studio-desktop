use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};

const MIME: &str = crate::plugin_output_types::ENCODED_TEXT;
const BOUNDARY_SHA: &str = "6c7ddc6cfeee3337d8a310a343d4717ab3e9561704661721a9eac119e3c9cc26";

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    root: &std::path::Path,
    package: &std::path::Path,
) {
    let mut owner = owner.clone();
    owner["capabilityId"] = json!("devtools.encoding.convert");
    let vectors: Value =
        serde_json::from_slice(&std::fs::read(package.join("fixtures.json")).unwrap()).unwrap();
    let post = |route, payload| output_http::post(host, client, route, payload);
    let mut tested = 0;
    for case in vectors["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["capabilityId"] == "devtools.encoding.convert")
    {
        let sample = STANDARD
            .decode(case["bytesBase64"].as_str().unwrap())
            .unwrap();
        let snapshot = output_http::material(host, client, &owner, &sample).await;
        let (status, result) = invoke(host, client, &snapshot, &case["input"]).await;
        assert_eq!(status, StatusCode::OK, "{}: {result}", case["id"]);
        if let Some(encoded) = case["nativeExpected"]["outputBase64"].as_str() {
            let expected = STANDARD.decode(encoded).unwrap();
            assert_eq!(result["result"], case["nativeExpected"]["report"]);
            let [output] = result["resources"].as_array().unwrap().as_slice() else {
                panic!("{result}");
            };
            assert_eq!(output["byteLength"], expected.len());
            assert_eq!(
                output["mimeType"],
                if case["input"]["targetEncoding"] == "utf8" {
                    "text/plain"
                } else {
                    MIME
                }
            );
            assert_eq!(output["contentVersion"], sha256_hex(&expected));
            let access = derived(&owner, output);
            let (status, chunk) = response(
                post(
                    "read-view",
                    json!({"access":access,"offset":0,"length":4096}),
                )
                .await,
            )
            .await;
            assert_eq!(status, StatusCode::OK, "{chunk}");
            assert_eq!(
                STANDARD
                    .decode(chunk["dataBase64"].as_str().unwrap())
                    .unwrap(),
                expected
            );
        } else {
            assert_eq!(result["result"]["error"], case["nativeExpected"]["error"]);
            assert_no_output(&result);
        }
        tested += 1;
    }
    assert_eq!(tested, 10);

    let workspace = root.join("workspace");
    let name = "接近上限的文本.txt";
    let path = workspace.join(name);
    let sample = vec![b'a'; 8 * 1024 * 1024];
    std::fs::write(&path, &sample).unwrap();
    let snapshot = import(host, client, &owner, name).await;
    let mut input = json!({"sourceEncoding":"utf8","targetEncoding":"utf16le"});
    let (status, result) = invoke(host, client, &snapshot["access"], &input).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["result"]["bytePreviewHex"], "6100".repeat(32));
    let output = &result["resources"][0];
    assert_eq!(output["contentVersion"], BOUNDARY_SHA);
    assert_eq!(output["byteLength"], 16 * 1024 * 1024);
    let access = derived(&owner, output);
    let (status, preview) =
        response(post("prepare-save", json!({"schemaVersion":1,"source":access})).await).await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let relative = preview["preview"]["relativePath"].as_str().unwrap();
    assert!(relative.ends_with("/result.encoded.txt"), "{relative}");
    let saved_path = workspace.join(relative);
    let mut confirmation =
        json!({"schemaVersion":1,"source":access,"grantId":preview["grantId"],"confirmed":false});
    let (status, _) = response(post("commit-save", confirmation.clone()).await).await;
    assert_ne!(status, StatusCode::OK);
    assert!(!saved_path.exists());
    confirmation["confirmed"] = json!(true);
    let (status, receipt) = response(post("commit-save", confirmation).await).await;
    assert_eq!(status, StatusCode::OK, "{receipt}");
    assert_eq!(receipt["receipt"]["contentVersion"], BOUNDARY_SHA);
    assert_eq!(
        sha256_hex(&std::fs::read(saved_path).unwrap()),
        BOUNDARY_SHA
    );
    assert_eq!(std::fs::read(path).unwrap(), sample);

    input["bom"] = json!(true);
    let (status, result) = invoke(host, client, &snapshot["access"], &input).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["result"]["error"]["code"], "OUTPUT_TOO_LARGE");
    assert_no_output(&result);
    eprintln!("seven targets, 10 fixed vectors, 16 MiB UTF-16 save, and output overflow passed");
}

fn assert_no_output(value: &Value) {
    assert!(
        value["resources"].is_null() || value["resources"].as_array().is_some_and(Vec::is_empty)
    );
}

fn derived(owner: &Value, output: &Value) -> Value {
    json!({"schemaVersion":1,"owner":owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]})
}

async fn invoke(
    host: &HostServer,
    client: &reqwest::Client,
    snapshot: &Value,
    input: &Value,
) -> (StatusCode, Value) {
    let post = |route, payload| output_http::post(host, client, route, payload);
    let (status, ticket) = response(
        post(
            "prepare-call",
            json!({"schemaVersion":1,"access":snapshot,"input":input}),
        )
        .await,
    )
    .await;
    if status != StatusCode::OK {
        return (status, ticket);
    }
    response(post("invoke-call", json!({"access":snapshot,"callId":ticket["callId"],"hostInstanceId":ticket["hostInstanceId"],"input":input})).await).await
}

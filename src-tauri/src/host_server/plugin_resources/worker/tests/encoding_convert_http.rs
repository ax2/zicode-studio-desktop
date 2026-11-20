use super::*;

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    receiver: &Value,
    root: &std::path::Path,
) {
    const MAX_INPUT: usize = 8 * 1024 * 1024;
    const OUTPUT_SHA: &str = "c018d2891c3466daba9f8794b49c345f38c60f708a70f27bfbbd2473103f8881";
    let mut owner = receiver.clone();
    owner["capabilityId"] = json!("devtools.encoding.to_utf8");
    let workspace = root.join("workspace");
    let contents = vec![0xe9; MAX_INPUT];
    let name = "需要转换.txt";
    let path = workspace.join(name);
    std::fs::write(&path, &contents).unwrap();
    let snapshot = import(host, client, &owner, name).await;
    let post = |route, payload| output_http::post(host, client, route, payload);
    let (status, result) = convert(host, client, &snapshot["access"], "windows1252", false).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["result"]["sourceByteCount"], MAX_INPUT);
    assert_eq!(result["result"]["outputByteCount"], 2 * MAX_INPUT);
    assert_eq!(result["result"]["characterCount"], MAX_INPUT);
    assert_eq!(result["result"]["preview"], "é".repeat(256));
    assert_eq!(result["resources"].as_array().unwrap().len(), 1);
    let output = &result["resources"][0];
    assert_eq!(output["byteLength"], 2 * MAX_INPUT);
    assert_eq!(output["mimeType"], "text/plain");
    assert_eq!(output["contentVersion"], OUTPUT_SHA);
    let access = json!({"schemaVersion":1,"owner":owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
    let (status, preview) =
        response(post("prepare-save", json!({"schemaVersion":1,"source":access})).await).await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let saved_path = workspace.join(preview["preview"]["relativePath"].as_str().unwrap());
    assert_eq!(saved_path.extension().unwrap(), "txt");
    assert!(!saved_path.exists());
    let mut request =
        json!({"schemaVersion":1,"source":access,"grantId":preview["grantId"],"confirmed":false});
    let (status, _) = response(post("commit-save", request.clone()).await).await;
    assert_ne!(status, StatusCode::OK);
    assert!(!saved_path.exists());
    request["confirmed"] = json!(true);
    let (status, saved) = response(post("commit-save", request).await).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["receipt"]["contentVersion"], OUTPUT_SHA);
    let saved_bytes = std::fs::read(&saved_path).unwrap();
    assert_eq!(saved_bytes.len(), 2 * MAX_INPUT);
    assert_eq!(sha256_hex(&saved_bytes), OUTPUT_SHA);
    assert_eq!(std::fs::read(path).unwrap(), contents);

    let (status, limited) = convert(host, client, &snapshot["access"], "windows1252", true).await;
    assert_eq!(status, StatusCode::OK, "{limited}");
    assert_eq!(limited["result"]["error"]["code"], "OUTPUT_TOO_LARGE");
    assert_no_output(&limited);

    let mut invalid = vec![b'a'; MAX_INPUT];
    invalid[..3].copy_from_slice(b"\xef\xbb\xbf");
    *invalid.last_mut().unwrap() = 0xff;
    std::fs::write(workspace.join("invalid.txt"), invalid).unwrap();
    let snapshot = import(host, client, &owner, "invalid.txt").await;
    let (status, invalid) = convert(host, client, &snapshot["access"], "utf8", false).await;
    assert_eq!(status, StatusCode::OK, "{invalid}");
    assert_eq!(invalid["result"]["error"]["code"], "DECODE_FAILED");
    assert_no_output(&invalid);

    let snapshot = import(host, client, &owner, "large.txt").await;
    let (status, oversized) = convert(host, client, &snapshot["access"], "utf8", false).await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(oversized["error"]["code"], "resource_input_too_large");
    eprintln!(
        "8 MiB conversion, 16 MiB saved SHA-256 {OUTPUT_SHA}, and three rejection cases passed"
    );
}

fn assert_no_output(response: &Value) {
    assert!(
        response["resources"].is_null()
            || response["resources"].as_array().is_some_and(Vec::is_empty)
    );
}

async fn convert(
    host: &HostServer,
    client: &reqwest::Client,
    access: &Value,
    source_encoding: &str,
    bom: bool,
) -> (StatusCode, Value) {
    let post = |route, payload| output_http::post(host, client, route, payload);
    let input = json!({"sourceEncoding":source_encoding,"bom":bom});
    let (status, ticket) = response(
        post(
            "prepare-call",
            json!({"schemaVersion":1,"access":access,"input":input}),
        )
        .await,
    )
    .await;
    if status != StatusCode::OK {
        return (status, ticket);
    }
    response(post("invoke-call", json!({"access":access,"callId":ticket["callId"],"hostInstanceId":ticket["hostInstanceId"],"input":input})).await).await
}

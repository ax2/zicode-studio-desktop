use super::*;

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    sender: &Value,
    receiver: &Value,
    root: &std::path::Path,
    workspace: &str,
) {
    use crate::plugin_resource_execution::encoding as policy;
    let context = export::Context {
        window: "native-workspace-large-encoding".into(),
        workspace: workspace.into(),
        route: "/workspace".into(),
    };
    let mut contents = vec![b'a'; policy::MAX_BYTES];
    contents[..3].copy_from_slice(&[0xef, 0xbb, 0xbf]);
    let path = root
        .join("outside-first")
        .canonicalize()
        .unwrap()
        .join("最大大小.txt");
    std::fs::write(&path, &contents).unwrap();
    let preview = host
        .prepare_native_digest_files(context.clone(), sender.clone(), vec![path.clone()])
        .await
        .unwrap();
    assert_eq!(preview["contentRead"], false);
    let snapshot = host
        .commit_native_digest_file(
            context,
            sender.clone(),
            preview["files"][0]["grantId"].as_str().unwrap().to_owned(),
            true,
        )
        .await
        .unwrap();
    assert_eq!(snapshot["originalFile"]["byteLength"], policy::MAX_BYTES);
    let (status, report) = invoke(host, client, &snapshot["access"]).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(
        report["result"]["files"][0]["sha256"],
        sha256_hex(&contents)
    );
    let (status, ready) = response(output_http::post(host, client, "prepare-transfer", json!({"schemaVersion":1,"source":snapshot["access"],"target":receiver,"originalFile":true})).await).await;
    assert_eq!(status, StatusCode::OK, "{ready}");
    assert_eq!(ready["byteLength"], policy::MAX_BYTES);
    let (status, handoff) = response(output_http::post(host, client, "commit-transfer", json!({"schemaVersion":1,"source":snapshot["access"],"grantId":ready["grantId"],"confirmed":true})).await).await;
    assert_eq!(status, StatusCode::OK, "{handoff}");
    assert_eq!(handoff["contentRead"], false);
    let received = json!({"schemaVersion":1,"owner":receiver,"resourceId":handoff["reference"]["resourceId"],"contentVersion":handoff["reference"]["contentVersion"]});
    let (status, inspected) = invoke(host, client, &received).await;
    assert_eq!(status, StatusCode::OK, "{inspected}");
    assert_eq!(inspected["result"]["sourceByteCount"], policy::MAX_BYTES);
    assert_eq!(inspected["result"]["encoding"], "utf8");
    assert_eq!(inspected["result"]["strictlyDecodable"], true);
    assert_eq!(std::fs::read(&path).unwrap(), contents);
    contents.push(b'x');
    let oversized = output_http::material(host, client, receiver, &contents).await;
    let (status, result) = invoke(host, client, &oversized).await;
    assert_ne!(status, StatusCode::OK);
    assert_eq!(result["error"]["code"], "resource_input_too_large");
}

use super::*;

pub(super) async fn confirmed_input(
    host: &HostServer,
    client: &reqwest::Client,
    root: &std::path::Path,
    target: &RuntimeTarget,
    template: &Value,
    module: &str,
    bytes: &[u8],
) -> Value {
    let version = sha256_hex(bytes);
    let id = "com.zicode.studio.independent-resource-fixture";
    let package = root.join("independent-package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    let mut manifest = template.clone();
    manifest["id"] = json!(id);
    manifest["name"] = json!("Independent resource fixture");
    std::fs::write(
        package.join("plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(package.join("runtime/tools.wasm"), module).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry.set_enabled("programming", id, true).unwrap();
        registry
            .set_permission("programming", id, "resource.read", true)
            .unwrap();
    }
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":id,"capabilityId":"resource.inspect"});
    let post = |path: &str, body: Value| {
        client
            .post(format!("{}/v2/plugin-resources/{path}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let prepared = post(
        "prepare",
        json!({"schemaVersion":1,"owner":owner,
        "mimeType":"application/octet-stream","byteLength":bytes.len(),"contentVersion":&version}),
    )
    .await
    .unwrap();
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared: Value = prepared.json().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":owner,
        "resourceId":prepared["resourceId"],"contentVersion":&version});
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        assert_eq!(
            post(
                "append",
                json!({"access":access,"offset":index * MAX_CHUNK,
            "dataBase64":base64::engine::general_purpose::STANDARD.encode(chunk)})
            )
            .await
            .unwrap()
            .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        post("commit", json!({"access":access,"confirmed":true}))
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    access
}

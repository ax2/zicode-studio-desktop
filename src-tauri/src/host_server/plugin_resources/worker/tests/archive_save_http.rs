//! Real HTTP -> current Worker -> confirmed managed archive save. Synthetic ZIP only.
use super::*;

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    root: &std::path::Path,
    target: &RuntimeTarget,
    template: &Value,
) -> Value {
    let package = root.join("archive-output-package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    let mut manifest = template.clone();
    manifest["id"] = json!("com.zicode.studio.archive-output-fixture");
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({
        "output.schema.v1":"=1.0.0-rc.1",
        "resource.output.types.v1":"=1.0.0-preview.1"
    });
    manifest["runtime"]["resourceOutputProfile"] =
        json!(crate::plugin_worker::resource_output::PROFILE);
    manifest["contributes"]["capabilities"] = json!([{"id":"archive.fixture","title":"Archive output fixture",
        "inputSchema":{"type":"object","additionalProperties":false},
        "outputSchema":{"type":"object","additionalProperties":false}}]);
    std::fs::write(
        package.join("plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    let module = r#"(module
      (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
      (import "zicode_resource_output_draft1" "create" (func $create (param i32 i64) (result i32)))
      (import "zicode_resource_output_draft1" "write" (func $write (param i32 i32 i32) (result i32)))
      (import "zicode_resource_output_draft1" "finish" (func $finish (param i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 1)
      (data (i32.const 0) "PK\05\06") (data (i32.const 64) "{}")
      (func (export "_start")
        i32.const 0 i64.const 0 i32.const 32 i32.const 1 call $read i32.const 1 i32.ne if unreachable end
        i32.const 5 i64.const 22 call $create i32.const 0 i32.ne if unreachable end
        i32.const 0 i32.const 0 i32.const 22 call $write i32.const 22 i32.ne if unreachable end
        i32.const 0 call $finish i32.const 0 i32.ne if unreachable end
        i32.const 80 i32.const 64 i32.store i32.const 84 i32.const 2 i32.store
        i32.const 1 i32.const 80 i32.const 1 i32.const 88 call $json drop))"#;
    std::fs::write(package.join("runtime/tools.wasm"), module).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled(
                "programming",
                "com.zicode.studio.archive-output-fixture",
                true,
            )
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.studio.archive-output-fixture",
                "resource.read",
                true,
            )
            .unwrap();
        registry
            .set_enabled("programming", "com.zicode.artifacts", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.artifacts",
                "storage.plugin",
                true,
            )
            .unwrap();
    }
    let workspace = root.join("archive-output-workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":"com.zicode.studio.archive-output-fixture","capabilityId":"archive.fixture"});
    let source = output_http::material(host, client, &owner, b"x").await;
    let invoked = output_http::post(
        host,
        client,
        "invoke-view",
        json!({"access":source,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(invoked.status(), StatusCode::OK);
    let invoked = invoked.json::<Value>().await.unwrap();
    assert_eq!(invoked["result"], json!({}));
    assert_eq!(
        invoked["resources"][0]["mimeType"],
        "application/x-zicode-archive-zip"
    );
    let bytes = [
        b'P', b'K', 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ];
    assert_eq!(
        invoked["resources"][0]["contentVersion"],
        sha256_hex(&bytes)
    );
    let derived = json!({"schemaVersion":1,"owner":owner,
        "resourceId":invoked["resources"][0]["resourceId"],
        "contentVersion":invoked["resources"][0]["contentVersion"]});
    let prepared = output_http::post(
        host,
        client,
        "prepare-save",
        json!({"schemaVersion":1,"source":derived}),
    )
    .await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared = prepared.json::<Value>().await.unwrap();
    let path = workspace.join(prepared["preview"]["relativePath"].as_str().unwrap());
    assert!(path.ends_with("result.zip"));
    assert!(!path.exists());
    let mut commit =
        json!({"schemaVersion":1,"source":derived,"grantId":prepared["grantId"],"confirmed":false});
    assert_eq!(
        output_http::post(host, client, "commit-save", commit.clone())
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    assert!(!path.exists());
    commit["confirmed"] = json!(true);
    let saved = output_http::post(host, client, "commit-save", commit).await;
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = saved.json::<Value>().await.unwrap();
    assert_eq!(
        saved["receipt"]["mimeType"],
        "application/x-zicode-archive-zip"
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    let listed = client
        .get(format!(
            "{}/v2/plugin-resources/saved-outputs",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .query(&[
            ("schemaVersion", "1"),
            ("sceneId", "programming"),
            ("workspaceId", target.workspace_id.as_str()),
        ])
        .send()
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap();
    assert!(listed["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["receipt"]["saveId"] == prepared["grantId"]));
    assert_eq!(
        output_http::post(host, client, "revoke", source)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(std::fs::read(&path).unwrap(), bytes);
    json!({"passed":true,"workerMimeIndex":5,"confirmedSave":true,"generatedExtension":"zip",
        "savedLibraryVisible":true,"sourceRevocationKeptApprovedCopy":true,"providerAlgorithm":false,"nativeUi":false})
}

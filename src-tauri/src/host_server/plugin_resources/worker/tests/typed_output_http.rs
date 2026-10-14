//! Real HTTP -> current Worker -> confirmed managed document/database saves.
use super::*;

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    root: &std::path::Path,
    target: &RuntimeTarget,
    template: &Value,
) -> Value {
    let package = root.join("typed-output-package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    let mut manifest = template.clone();
    let plugin_id = "com.zicode.studio.typed-output-fixture";
    manifest["id"] = json!(plugin_id);
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
    manifest["runtime"]["resourceOutputProfile"] =
        json!(crate::plugin_worker::resource_output::PROFILE);
    manifest["contributes"]["capabilities"] = json!([{
        "id":"typed.fixture","title":"Typed output fixture",
        "inputSchema":{"type":"object","additionalProperties":false},
        "outputSchema":{"type":"object","additionalProperties":false}
    }]);
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
      (data (i32.const 0) "<script>alert(1)</script>")
      (data (i32.const 64) "SQLite format 3\00")
      (data (i32.const 128) "{}")
      (func (export "_start")
        i32.const 0 i64.const 0 i32.const 48 i32.const 1 call $read i32.const 1 i32.ne if unreachable end
        i32.const 25 i64.const 25 call $create i32.const 0 i32.ne if unreachable end
        i32.const 0 i32.const 0 i32.const 25 call $write i32.const 25 i32.ne if unreachable end
        i32.const 0 call $finish i32.const 0 i32.ne if unreachable end
        i32.const 26 i64.const 16 call $create i32.const 1 i32.ne if unreachable end
        i32.const 1 i32.const 64 i32.const 16 call $write i32.const 16 i32.ne if unreachable end
        i32.const 1 call $finish i32.const 0 i32.ne if unreachable end
        i32.const 144 i32.const 128 i32.store i32.const 148 i32.const 2 i32.store
        i32.const 1 i32.const 144 i32.const 1 i32.const 152 call $json drop))"#;
    std::fs::write(package.join("runtime/tools.wasm"), module).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
        registry
            .set_permission("programming", plugin_id, "resource.read", true)
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
    let workspace = root.join("typed-output-workspace");
    std::fs::create_dir_all(&workspace).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":plugin_id,"capabilityId":"typed.fixture"});
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
    let rows = invoked["resources"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    let cases: [(&str, &str, &[u8]); 2] = [
        ("text/html", "html", b"<script>alert(1)</script>"),
        (
            "application/x-zicode-sqlite",
            "sqlite",
            b"SQLite format 3\0",
        ),
    ];
    let mut saved_ids = Vec::new();
    for (row, (mime, extension, bytes)) in rows.iter().zip(cases) {
        assert_eq!(row["mimeType"], mime);
        assert_eq!(row["byteLength"], bytes.len());
        assert_eq!(row["contentVersion"], sha256_hex(bytes));
        let derived = json!({"schemaVersion":1,"owner":owner,
            "resourceId":row["resourceId"],"contentVersion":row["contentVersion"]});
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
        assert!(path.ends_with(format!("result.{extension}")));
        assert!(!path.exists());
        let mut commit = json!({"schemaVersion":1,"source":derived,
            "grantId":prepared["grantId"],"confirmed":false});
        let denied = output_http::post(host, client, "commit-save", commit.clone()).await;
        assert_eq!(
            denied.json::<Value>().await.unwrap()["error"]["code"],
            "resource_confirmation_required"
        );
        assert!(!path.exists());
        commit["confirmed"] = json!(true);
        let saved = output_http::post(host, client, "commit-save", commit).await;
        assert_eq!(saved.status(), StatusCode::OK);
        let saved = saved.json::<Value>().await.unwrap();
        assert_eq!(saved["receipt"]["mimeType"], mime);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        saved_ids.push(prepared["grantId"].clone());
    }
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
    for id in &saved_ids {
        assert!(listed["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| row["receipt"]["saveId"] == *id));
    }
    assert_eq!(
        output_http::post(host, client, "revoke", source)
            .await
            .status(),
        StatusCode::OK
    );
    json!({"passed":true,"workerMimeIndices":[25,26],"confirmedSave":true,
        "generatedExtensions":["html","sqlite"],"savedLibraryVisible":true,
        "providerAlgorithm":false,"nativeUi":false})
}

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
    manifest["requiredProfiles"] = json!({
        "output.schema.v1":"=1.0.0-rc.1",
        "resource.output.types.v1":"=1.0.0-preview.1"
    });
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
    let consumer_id = "com.zicode.studio.typed-output-consumer";
    let consumer_package = root.join("typed-output-consumer-package");
    std::fs::create_dir_all(consumer_package.join("runtime")).unwrap();
    let mut consumer_manifest = template.clone();
    consumer_manifest["id"] = json!(consumer_id);
    consumer_manifest["requiredProfiles"]["resource.input.types.v1"] = json!("=1.0.0-preview.1");
    consumer_manifest["contributes"]["capabilities"] = json!([{
        "id":"typed.consume","title":"Consume typed output",
        "resourceInputMimeTypes":["text/html","application/x-zicode-sqlite"],
        "inputSchema":{"type":"object","additionalProperties":false},
        "outputSchema":{"type":"object","properties":{"received":{"type":"string"}},
            "required":["received"],"additionalProperties":false}
    }]);
    std::fs::write(
        consumer_package.join("plugin.json"),
        serde_json::to_vec(&consumer_manifest).unwrap(),
    )
    .unwrap();
    let consumer_module = r#"(module
      (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
      (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
      (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
      (memory (export "memory") 1)
      (data (i32.const 128) "<script>alert(1)</script>")
      (data (i32.const 192) "SQLite format 3\00")
      (data (i32.const 256) "{\22received\22:\22html\22}")
      (data (i32.const 300) "{\22received\22:\22sqlite\22}")
      (func (export "_start") (local $length i32) (local $expected i32)
        (local $jsonptr i32) (local $jsonlen i32) (local $index i32)
        i32.const 0 call $size
        i64.const 25 i64.eq
        if
          i32.const 25 local.set $length
          i32.const 128 local.set $expected
          i32.const 256 local.set $jsonptr
          i32.const 19 local.set $jsonlen
        else
          i32.const 0 call $size i64.const 16 i64.ne if unreachable end
          i32.const 16 local.set $length
          i32.const 192 local.set $expected
          i32.const 300 local.set $jsonptr
          i32.const 21 local.set $jsonlen
        end
        i32.const 0 i64.const 0 i32.const 0 local.get $length call $read
        local.get $length i32.ne if unreachable end
        block $done
          loop $compare
            local.get $index local.get $length i32.ge_u br_if $done
            local.get $index i32.load8_u
            local.get $expected local.get $index i32.add i32.load8_u
            i32.ne if unreachable end
            local.get $index i32.const 1 i32.add local.set $index
            br $compare
          end
        end
        i32.const 400 local.get $jsonptr i32.store
        i32.const 404 local.get $jsonlen i32.store
        i32.const 1 i32.const 400 i32.const 1 i32.const 408 call $json drop))"#;
    std::fs::write(consumer_package.join("runtime/tools.wasm"), consumer_module).unwrap();
    let legacy_id = "com.zicode.studio.typed-output-unnegotiated";
    let legacy_package = root.join("typed-output-unnegotiated-package");
    std::fs::create_dir_all(legacy_package.join("runtime")).unwrap();
    let mut legacy_manifest = manifest.clone();
    legacy_manifest["id"] = json!(legacy_id);
    legacy_manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
    std::fs::write(
        legacy_package.join("plugin.json"),
        serde_json::to_vec(&legacy_manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(legacy_package.join("runtime/tools.wasm"), module).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (id, path) in [
            (plugin_id, &package),
            (consumer_id, &consumer_package),
            (legacy_id, &legacy_package),
        ] {
            registry.install_developer(path).unwrap();
            registry.set_enabled("programming", id, true).unwrap();
            registry
                .set_permission("programming", id, "resource.read", true)
                .unwrap();
        }
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
    let consumer_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":consumer_id,"capabilityId":"typed.consume"});
    let legacy_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":legacy_id,"capabilityId":"typed.fixture"});
    let legacy_source = output_http::material(host, client, &legacy_owner, b"x").await;
    let before = host.state.plugin_resources.lock().unwrap().record_count();
    let rejected = output_http::post(
        host,
        client,
        "invoke-view",
        json!({"access":legacy_source,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(rejected.status(), StatusCode::CONFLICT);
    assert_eq!(
        rejected.json::<Value>().await.unwrap()["error"]["code"],
        "resource_output_profile_unsupported"
    );
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before
    );
    assert_eq!(
        output_http::post(host, client, "revoke", legacy_source)
            .await
            .status(),
        StatusCode::OK
    );
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

        let transfer = output_http::post(
            host,
            client,
            "prepare-transfer",
            json!({"schemaVersion":1,"source":derived,"target":consumer_owner}),
        )
        .await;
        assert_eq!(transfer.status(), StatusCode::OK);
        let transfer = transfer.json::<Value>().await.unwrap();
        assert_eq!(transfer["mimeType"], mime);
        assert_eq!(transfer["requiresConfirmation"], true);
        let mut commit = json!({"schemaVersion":1,"source":derived,
            "grantId":transfer["grantId"],"confirmed":false});
        let denied = output_http::post(host, client, "commit-transfer", commit.clone()).await;
        assert_eq!(
            denied.json::<Value>().await.unwrap()["error"]["code"],
            "resource_confirmation_required"
        );
        commit["confirmed"] = json!(true);
        let transferred = output_http::post(host, client, "commit-transfer", commit).await;
        assert_eq!(transferred.status(), StatusCode::OK);
        let transferred = transferred.json::<Value>().await.unwrap();
        assert_eq!(
            transferred["reference"]["contentVersion"],
            row["contentVersion"]
        );
        let access = json!({"schemaVersion":1,"owner":consumer_owner,
            "resourceId":transferred["reference"]["resourceId"],
            "contentVersion":transferred["reference"]["contentVersion"]});
        let consumed = output_http::post(
            host,
            client,
            "invoke-view",
            json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
        )
        .await;
        assert_eq!(consumed.status(), StatusCode::OK);
        assert_eq!(
            consumed.json::<Value>().await.unwrap()["result"]["received"],
            extension
        );
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
        "confirmedCrossPluginTransfer":true,"consumerCheckedExactBytes":true,
        "unnegotiatedTypeRejectedBeforePublication":true,
        "providerAlgorithm":false,"nativeUi":false})
}

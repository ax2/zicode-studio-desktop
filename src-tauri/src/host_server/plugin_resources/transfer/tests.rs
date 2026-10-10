use super::*;

#[test]
fn confirmation_requests_reject_owner_override_and_paths() {
    let source = json!({"schemaVersion":1,"owner":{"runtimeId":"r","sessionId":"s","pluginId":"a","capabilityId":"one"},"resourceId":uuid::Uuid::new_v4(),"contentVersion":"a".repeat(64)});
    let prepare = json!({"schemaVersion":1,"source":source,"target":{"runtimeId":"r","sessionId":"s","pluginId":"b","capabilityId":"two"}});
    assert!(serde_json::from_value::<PrepareTransfer>(prepare.clone()).is_ok());
    let mut invalid = prepare;
    invalid["target"]["path"] = json!("private");
    assert!(serde_json::from_value::<PrepareTransfer>(invalid).is_err());
    let commit =
        json!({"schemaVersion":1,"source":source,"grantId":uuid::Uuid::new_v4(),"confirmed":true});
    assert!(serde_json::from_value::<CommitTransfer>(commit.clone()).is_ok());
    for field in ["target", "path", "token"] {
        let mut invalid = commit.clone();
        invalid[field] = json!({});
        assert!(serde_json::from_value::<CommitTransfer>(invalid).is_err());
    }
}

pub(in crate::host_server::plugin_resources) async fn verify(
    host: &HostServer,
    root: &std::path::Path,
    target: &RuntimeTarget,
    template: &Value,
) -> Value {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for id in [
        "com.zicode.studio.transfer-source",
        "com.zicode.studio.transfer-target",
    ] {
        let package = root.join(id);
        std::fs::create_dir_all(package.join("runtime")).unwrap();
        let mut manifest = template.clone();
        manifest["id"] = json!(id);
        if id.ends_with("source") {
            manifest["schemaVersion"] = json!(2);
            manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
            manifest["runtime"]["resourceOutputProfile"] =
                json!(crate::plugin_worker::resource_output::PROFILE);
            manifest["contributes"]["capabilities"][0]["outputSchema"] = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
        }
        std::fs::write(
            package.join("plugin.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        std::fs::copy(
            root.join("package/runtime/tools.wasm"),
            package.join("runtime/tools.wasm"),
        )
        .unwrap();
        if id.ends_with("source") {
            std::fs::write(package.join("runtime/tools.wasm"), COPY_OUTPUT).unwrap();
        }
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry.set_enabled("programming", id, true).unwrap();
        registry
            .set_permission("programming", id, "resource.read", true)
            .unwrap();
    }
    let source_owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":"com.zicode.studio.transfer-source","capabilityId":"resource.inspect"});
    let mut target_owner = source_owner.clone();
    target_owner["pluginId"] = json!("com.zicode.studio.transfer-target");
    let mut bytes = vec![173; 300000];
    bytes[299992..].copy_from_slice(b"resource");
    let input = material(host, &client, &source_owner, &bytes).await;
    let produced = post(
        host,
        &client,
        "invoke-view",
        json!({"access":input,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(produced.status(), StatusCode::OK);
    let produced = produced.json::<Value>().await.unwrap();
    assert_eq!(produced["resources"][0]["byteLength"], bytes.len());
    assert_eq!(
        produced["resources"][0]["contentVersion"],
        sha256_hex(&bytes)
    );
    let source = json!({"schemaVersion":1,"owner":source_owner,"resourceId":produced["resources"][0]["resourceId"],"contentVersion":produced["resources"][0]["contentVersion"]});
    let prepare = json!({"schemaVersion":1,"source":source,"target":target_owner});
    assert_eq!(
        client
            .post(format!(
                "{}/v2/plugin-resources/prepare-transfer",
                host.origin()
            ))
            .bearer_auth("fixture-resource-credential")
            .json(&prepare)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let prepared = post(host, &client, "prepare-transfer", prepare.clone()).await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared = prepared.json::<Value>().await.unwrap();
    assert_eq!(prepared["requiresConfirmation"], true);
    assert_eq!(prepared["byteLength"], 300000);
    let commit =
        json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":true});
    let mut unconfirmed = commit.clone();
    unconfirmed["confirmed"] = json!(false);
    assert_eq!(
        post(host, &client, "commit-transfer", unconfirmed)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    let mut foreign = commit.clone();
    foreign["source"]["owner"] = target_owner.clone();
    assert!(!post(host, &client, "commit-transfer", foreign)
        .await
        .status()
        .is_success());
    let count = host.state.plugin_resources.lock().unwrap().record_count();
    let result = post(host, &client, "commit-transfer", commit.clone()).await;
    assert_eq!(result.status(), StatusCode::OK);
    let result = result.json::<Value>().await.unwrap();
    let replay = post(host, &client, "commit-transfer", commit)
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(result["reference"], replay["reference"]);
    assert_eq!(replay["replayed"], true);
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        count + 1
    );
    let access = json!({"schemaVersion":1,"owner":target_owner,"resourceId":result["reference"]["resourceId"],"contentVersion":result["reference"]["contentVersion"]});
    let read = json!({"access":access,"offset":0,"length":32768});
    let response = post(host, &client, "read-view", read.clone()).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.json::<Value>().await.unwrap()["dataBase64"],
        base64::engine::general_purpose::STANDARD.encode(&bytes[..32768])
    );
    let invoked = post(
        host,
        &client,
        "invoke-view",
        json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(invoked.status(), StatusCode::OK);
    assert_eq!(
        invoked.json::<Value>().await.unwrap()["result"],
        json!({"text":"resource"})
    );
    let prepared = post(host, &client, "prepare-transfer", prepare.clone())
        .await
        .json::<Value>()
        .await
        .unwrap();
    let pending =
        json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":true});
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.studio.transfer-target",
            "resource.read",
            false,
        )
        .unwrap();
    assert!(!post(host, &client, "commit-transfer", pending.clone())
        .await
        .status()
        .is_success());
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.studio.transfer-target",
            "resource.read",
            true,
        )
        .unwrap();
    assert_eq!(
        post(host, &client, "commit-transfer", pending)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_authorization_changed"
    );
    let prepared = post(host, &client, "prepare-transfer", prepare.clone())
        .await
        .json::<Value>()
        .await
        .unwrap();
    let fresh_transfer = post(
        host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":true}),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let access = json!({"schemaVersion":1,"owner":target_owner,"resourceId":fresh_transfer["reference"]["resourceId"],"contentVersion":fresh_transfer["reference"]["contentVersion"]});
    let read = json!({"access":access,"offset":0,"length":1});
    assert!(post(host, &client, "read-view", read.clone())
        .await
        .status()
        .is_success());
    let prepared = post(host, &client, "prepare-transfer", prepare)
        .await
        .json::<Value>()
        .await
        .unwrap();
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.studio.transfer-source",
            "resource.read",
            false,
        )
        .unwrap();
    assert_eq!(
        post(host, &client, "read-view", read.clone())
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "permission_denied"
    );
    assert!(!post(
        host,
        &client,
        "commit-transfer",
        json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":true})
    )
    .await
    .status()
    .is_success());
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.studio.transfer-source",
            "resource.read",
            true,
        )
        .unwrap();
    assert_eq!(
        post(host, &client, "read-view", read)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_authorization_changed"
    );
    let fresh = material(host, &client, &target_owner, &bytes).await;
    assert!(post(
        host,
        &client,
        "read-view",
        json!({"access":fresh,"offset":0,"length":1})
    )
    .await
    .status()
    .is_success());
    assert!(post(host, &client, "revoke", source)
        .await
        .status()
        .is_success());
    let fresh_source = material(host, &client, &source_owner, &bytes).await;
    let prepared = post(
        host,
        &client,
        "prepare-transfer",
        json!({"schemaVersion":1,"source":fresh_source,"target":target_owner}),
    )
    .await
    .json::<Value>()
    .await
    .unwrap();
    let delegated = post(host, &client, "commit-transfer", json!({"schemaVersion":1,"source":fresh_source,"grantId":prepared["grantId"],"confirmed":true})).await.json::<Value>().await.unwrap();
    let fresh_access = json!({"schemaVersion":1,"owner":target_owner,"resourceId":delegated["reference"]["resourceId"],"contentVersion":delegated["reference"]["contentVersion"]});
    let fresh_read = json!({"access":fresh_access,"offset":0,"length":1});
    assert!(post(host, &client, "read-view", fresh_read.clone())
        .await
        .status()
        .is_success());
    assert!(post(host, &client, "revoke", fresh_source)
        .await
        .status()
        .is_success());
    assert_eq!(
        post(host, &client, "read-view", fresh_read)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_unavailable"
    );
    assert!(!post(
        host,
        &client,
        "read-view",
        json!({"access":access,"offset":0,"length":1})
    )
    .await
    .status()
    .is_success());
    json!({"passed":true,"profile":"resource.transfer.draft1","bytes":300000,"brokerDenied":true,"unconfirmedDenied":true,"ownerOverrideDenied":true,"singleResourceOnReplay":true,"sourceWorkerOutputTransferred":true,"realWorkerExecutedTransferredInput":true,"targetPermissionRevocationAndRegrantDenied":true,"sourcePermissionRevocationAndRegrantDenied":true,"sourceRevocationCascades":true,"unrelatedTargetFreshInputReadable":true,"nativeUi":false,"providerAlgorithm":false})
}

const COPY_OUTPUT: &str = r#"(module
 (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
 (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
 (import "zicode_resource_output_draft1" "create" (func $create (param i32 i64) (result i32)))
 (import "zicode_resource_output_draft1" "write" (func $write (param i32 i32 i32) (result i32)))
 (import "zicode_resource_output_draft1" "finish" (func $finish (param i32) (result i32)))
 (import "wasi_snapshot_preview1" "fd_write" (func $json (param i32 i32 i32 i32) (result i32)))
 (memory (export "memory") 2) (data (i32.const 65536) "{\22text\22:\22copied\22}")
 (func (export "_start") (local $length i32) (local $offset i32) (local $chunk i32)
  i32.const 0 call $size i32.wrap_i64 local.set $length
  i32.const 0 local.get $length i64.extend_i32_u call $create i32.const 0 i32.ne if unreachable end
  (block $done (loop $loop
   local.get $offset local.get $length i32.ge_u br_if $done
   local.get $length local.get $offset i32.sub local.tee $chunk i32.const 65536 i32.gt_u if i32.const 65536 local.set $chunk end
   i32.const 0 local.get $offset i64.extend_i32_u i32.const 0 local.get $chunk call $read local.get $chunk i32.ne if unreachable end
   i32.const 0 i32.const 0 local.get $chunk call $write local.get $chunk i32.ne if unreachable end
   local.get $offset local.get $chunk i32.add local.set $offset br $loop))
  i32.const 0 call $finish i32.const 0 i32.ne if unreachable end
  i32.const 65600 i32.const 65536 i32.store i32.const 65604 i32.const 17 i32.store
  i32.const 1 i32.const 65600 i32.const 1 i32.const 65620 call $json drop))"#;

pub(in crate::host_server::plugin_resources) async fn post(
    host: &HostServer,
    client: &reqwest::Client,
    path: &str,
    body: Value,
) -> reqwest::Response {
    client
        .post(format!("{}/v2/plugin-resources/{path}", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&body)
        .send()
        .await
        .unwrap()
}
pub(in crate::host_server::plugin_resources) async fn material(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    bytes: &[u8],
) -> Value {
    let version = sha256_hex(bytes);
    let prepared=post(host,client,"prepare",json!({"schemaVersion":1,"owner":owner,"mimeType":"application/octet-stream","byteLength":bytes.len(),"contentVersion":version})).await.json::<Value>().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":owner,"resourceId":prepared["resourceId"],"contentVersion":version});
    for (index, chunk) in bytes.chunks(MAX_CHUNK).enumerate() {
        assert_eq!(post(host,client,"append",json!({"access":access,"offset":index*MAX_CHUNK,"dataBase64":base64::engine::general_purpose::STANDARD.encode(chunk)})).await.status(),StatusCode::OK);
    }
    assert_eq!(
        post(
            host,
            client,
            "commit",
            json!({"access":access,"confirmed":true})
        )
        .await
        .status(),
        StatusCode::OK
    );
    access
}

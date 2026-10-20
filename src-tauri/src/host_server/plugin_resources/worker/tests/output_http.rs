//! Real HTTP Host admission and readback with the production Worker executable.
use super::*;

pub(super) async fn post(
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

pub(super) async fn material(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    bytes: &[u8],
) -> Value {
    material_with_mime(host, client, owner, "application/octet-stream", bytes).await
}

pub(super) async fn material_with_mime(
    host: &HostServer,
    client: &reqwest::Client,
    owner: &Value,
    mime_type: &str,
    bytes: &[u8],
) -> Value {
    let version = sha256_hex(bytes);
    let response=post(host,client,"prepare",json!({"schemaVersion":1,"owner":owner,"mimeType":mime_type,"byteLength":bytes.len(),"contentVersion":version})).await;
    assert_eq!(response.status(), StatusCode::OK);
    let resource = response.json::<Value>().await.unwrap();
    let access = json!({"schemaVersion":1,"owner":owner,"resourceId":resource["resourceId"],"contentVersion":version});
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

pub(super) async fn verify(
    host: &HostServer,
    client: &reqwest::Client,
    root: &std::path::Path,
    target: &RuntimeTarget,
    template: &Value,
) -> Value {
    let package = root.join("binary-package");
    std::fs::create_dir_all(package.join("runtime")).unwrap();
    let mut manifest = template.clone();
    manifest["id"] = json!("com.zicode.studio.output-fixture");
    manifest["schemaVersion"] = json!(2);
    manifest["requiredProfiles"] = json!({"output.schema.v1":"=1.0.0-rc.1"});
    manifest["contributes"]["capabilities"][0]["outputSchema"] = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
    manifest["runtime"]["resourceOutputProfile"] =
        json!(crate::plugin_worker::resource_output::PROFILE);
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
      (memory (export "memory") 2) (data (i32.const 65536) "{\22text\22:\22copied\22}")
      (func (export "_start") (local $n i32)
        i32.const 0 i64.const 2097152 call $create i32.const 0 i32.ne if unreachable end
        (loop $loop
          i32.const 0 local.get $n i64.extend_i32_u i64.const 65536 i64.mul i32.const 0 i32.const 65536 call $read i32.const 65536 i32.ne if unreachable end
          i32.const 0 i32.const 0 i32.const 65536 call $write i32.const 65536 i32.ne if unreachable end
          local.get $n i32.const 1 i32.add local.tee $n i32.const 32 i32.lt_u br_if $loop)
        i32.const 0 call $finish i32.const 0 i32.ne if unreachable end
        i32.const 65600 i32.const 65536 i32.store i32.const 65604 i32.const 17 i32.store
        i32.const 1 i32.const 65600 i32.const 1 i32.const 65620 call $json drop))"#;
    std::fs::write(package.join("runtime/tools.wasm"), module).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&package).unwrap();
        registry
            .set_enabled("programming", "com.zicode.studio.output-fixture", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.studio.output-fixture",
                "resource.read",
                true,
            )
            .unwrap();
    }
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":"com.zicode.studio.output-fixture","capabilityId":"resource.inspect"});
    let bytes: Vec<u8> = (0..2097152).map(|i| (i % 251) as u8).collect();
    let source = material(host, client, &owner, &bytes).await;
    let count = host.state.plugin_resources.lock().unwrap().record_count();
    let events = Arc::new(Mutex::new(Vec::new()));
    let observed = events.clone();
    *host.state.plugin_resource_workers.observer.lock().unwrap() =
        Some(Arc::new(move |event, pid| {
            observed.lock().unwrap().push((event, pid))
        }));
    let mut access = source.clone();
    let mut descriptors = Vec::new();
    for _ in 0..2 {
        let response = post(
            host,
            client,
            "invoke-view",
            json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let response = response.json::<Value>().await.unwrap();
        assert_eq!(response["result"], json!({"text":"copied"}));
        assert_eq!(
            response["outputProfile"],
            crate::plugin_worker::resource_output::PROFILE
        );
        let descriptor = &response["resources"][0];
        assert_eq!(descriptor["byteLength"], bytes.len());
        assert_eq!(descriptor["saved"], false);
        assert_eq!(descriptor["contentVersion"], sha256_hex(&bytes));
        assert_eq!(
            descriptor["derivedFrom"]["resourceId"],
            access["resourceId"]
        );
        access = json!({"schemaVersion":1,"owner":owner,"resourceId":descriptor["resourceId"],"contentVersion":descriptor["contentVersion"]});
        descriptors.push(access.clone());
    }
    let mut recovered = Vec::new();
    for offset in (0..bytes.len()).step_by(32768) {
        let response = post(
            host,
            client,
            "read-view",
            json!({"access":access,"offset":offset,"length":32768}),
        )
        .await;
        assert_eq!(response.status(), StatusCode::OK);
        let response = response.json::<Value>().await.unwrap();
        recovered.extend(
            base64::engine::general_purpose::STANDARD
                .decode(response["dataBase64"].as_str().unwrap())
                .unwrap(),
        );
    }
    assert_eq!(recovered, bytes);
    let mut foreign = access.clone();
    foreign["owner"]["capabilityId"] = json!("foreign");
    assert_ne!(
        post(
            host,
            client,
            "read-view",
            json!({"access":foreign,"offset":0,"length":1})
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        client
            .post(format!("{}/v2/plugin-resources/read-view", host.origin()))
            .json(&json!({"access":access,"offset":0,"length":1}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        post(host, client, "revoke", source.clone()).await.status(),
        StatusCode::OK
    );
    for derived in &descriptors {
        assert_ne!(
            post(
                host,
                client,
                "read-view",
                json!({"access":derived,"offset":0,"length":1})
            )
            .await
            .status(),
            StatusCode::OK
        );
    }
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        count - 1
    );
    // Sealed output followed by trap must not create a Host record.
    let installed = host
        .state
        .plugins
        .lock()
        .unwrap()
        .plugin_runtime_entry("programming", "com.zicode.studio.output-fixture")
        .unwrap()
        .0;
    std::fs::write(
        &installed,
        module.replace(
            "i32.const 65600 i32.const 65536 i32.store",
            "unreachable i32.const 65600 i32.const 65536 i32.store",
        ),
    )
    .unwrap();
    let failed_source = material(host, client, &owner, &bytes).await;
    let count_before_failure = host.state.plugin_resources.lock().unwrap().record_count();
    let response = post(
        host,
        client,
        "invoke-view",
        json!({"access":failed_source,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_ne!(response.status(), StatusCode::OK);
    let response = response.json::<Value>().await.unwrap();
    assert!(response.get("resources").is_none());
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        count_before_failure
    );
    assert_eq!(
        post(host, client, "revoke", failed_source).await.status(),
        StatusCode::OK
    );
    // A valid binary frame with a wrong declared JSON output also admits nothing.
    std::fs::write(&installed, module.replace(r#"\22copied\22"#, "12345678")).unwrap();
    let invalid_source = material(host, client, &owner, &bytes).await;
    let before_invalid = host.state.plugin_resources.lock().unwrap().record_count();
    let invalid = post(
        host,
        client,
        "invoke-view",
        json!({"access":invalid_source,"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert_eq!(invalid.status(), StatusCode::CONFLICT);
    let invalid = invalid.json::<Value>().await.unwrap();
    assert_eq!(invalid["error"]["code"], "invalid_output");
    assert!(invalid.get("resources").is_none());
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        before_invalid
    );
    assert_eq!(
        post(host, client, "revoke", invalid_source).await.status(),
        StatusCode::OK
    );
    std::fs::write(installed, module).unwrap();
    *host.state.plugin_resource_workers.observer.lock().unwrap() = None;
    let publication =
        super::output_admission_http::verify(host, client, &owner, &bytes, target).await;
    let rows = events.lock().unwrap();
    let starts: Vec<_> = rows.iter().filter(|r| r.0 == "started").collect();
    assert_eq!(starts.len(), 4);
    for start in starts {
        for event in ["reaped", "pipes_closed"] {
            assert!(rows.contains(&(event, start.1)));
        }
    }
    json!({"passed":true,"bytes":bytes.len(),"sameOwnerChainedExecutions":2,"fullReadbackVerified":true,"crossCapabilityRejected":true,"desktopTokenRequired":true,"ancestorRevocationCascaded":true,"trapRegisteredNoOutputs":true,"invalidOutputSchemaRegisteredNothing":true,"workers":4,"publicationBoundary":publication,"allReapedPipesClosed":true,"saved":false,"preview":false,"crossPluginRelay":false,"nativeUi":false})
}

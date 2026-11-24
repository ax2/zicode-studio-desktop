//! One verified crop from explicit image sharing through actual Host and Worker.
use super::*;
use crate::plugin_resource_execution::{
    IMAGE_CROP_CAPABILITY_ID, IMAGE_CROP_PLUGIN_ID, IMAGE_CROP_PROFILE,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageEncoder, Rgba, RgbaImage};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires a frozen crop provider and the production Windows Studio Worker"]
async fn image_crop_frozen_host_worker_and_confirmed_export() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_IMAGE_CROP_PACKAGE").unwrap());
    let receipt_path = package.with_file_name(format!(
        "{}-verification.json",
        package.file_name().unwrap().to_string_lossy()
    ));
    let receipt: Value = serde_json::from_slice(&std::fs::read(receipt_path).unwrap()).unwrap();
    assert_eq!(
        receipt["directoryIndexSha256"],
        "7f2e636ba2a63a687210265715a7d65754fc49e5a5c2f93702c6954612fdcfd6"
    );
    assert_eq!(receipt["files"].as_array().unwrap().len(), 8);
    for entry in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(package.join(entry["path"].as_str().unwrap())).unwrap();
        assert_eq!(entry["size"], bytes.len());
        assert_eq!(entry["sha256"], sha256_hex(&bytes));
    }

    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    std::fs::create_dir_all(&scratch).unwrap();
    let sandbox = tempfile::Builder::new()
        .prefix("image-crop-host-")
        .tempdir_in(scratch)
        .unwrap();
    let workspace = sandbox.path().join("workspace");
    let public = sandbox.path().join("public");
    std::fs::create_dir(&workspace).unwrap();
    std::fs::create_dir(&public).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&sandbox.path().join("metadata.sqlite3"))
            .unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        "crop-test-worker",
        "crop-test-instance",
    );
    let runtime = runtimes.register_in_memory(issued.clone()).unwrap();
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    host.state.plugin_tokens.lock().unwrap().insert(
        issued.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(b"synthetic-crop-host-fixture-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "crop-test-session")
        .unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace.clone());
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap(),
    ));
    {
        use crate::plugin_registry::manual_catalog::{CatalogQuery, DetailQuery};
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(
            registry.install_developer(&package).unwrap(),
            IMAGE_CROP_PLUGIN_ID
        );
        assert!(registry
            .set_enabled("programming", IMAGE_CROP_PLUGIN_ID, true)
            .is_err());
        registry
            .set_permission("programming", IMAGE_CROP_PLUGIN_ID, "resource.read", true)
            .unwrap();
        registry
            .set_enabled("programming", IMAGE_CROP_PLUGIN_ID, true)
            .unwrap();
        let catalog = registry
            .manual_catalog(&CatalogQuery {
                scene_id: "programming".into(),
                plugin_id: Some(IMAGE_CROP_PLUGIN_ID.into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(catalog["total"], 1);
        let detail = registry
            .manual_tool_detail(&DetailQuery {
                scene_id: "programming".into(),
                plugin_id: IMAGE_CROP_PLUGIN_ID.into(),
                capability_id: IMAGE_CROP_CAPABILITY_ID.into(),
                revision: registry.manual_revision("programming"),
                resource_mime_type: None,
            })
            .unwrap();
        assert_eq!(detail["resourceInputProfile"], "resource.wasi.input.draft2");
        assert_eq!(detail["capability"]["executionProfile"], IMAGE_CROP_PROFILE);
        assert_eq!(detail["capability"]["id"], IMAGE_CROP_CAPABILITY_ID);
    }

    let original = RgbaImage::from_fn(4, 3, |x, y| {
        Rgba([x as u8 * 12, y as u8 * 31, 40, (x + y) as u8 * 32])
    });
    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(original.as_raw(), 4, 3, image::ExtendedColorType::Rgba8)
        .unwrap();
    let source_file = workspace.join("source-crop-fixture.png");
    std::fs::write(&source_file, &png).unwrap();
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":IMAGE_CROP_PLUGIN_ID,
        "capabilityId":IMAGE_CROP_CAPABILITY_ID});
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let request = |route, body| output_http::post(&host, &client, route, body);
    let source = output_http::material_with_mime(
        &host,
        &client,
        &owner,
        "image/png",
        &std::fs::read(&source_file).unwrap(),
    )
    .await;
    let invoke = |input: Value| {
        request(
            "invoke-view",
            json!({"access":source,"toolCallId":uuid::Uuid::new_v4(),"input":input}),
        )
    };
    let invalid = invoke(json!({"x":3,"y":0,"width":2,"height":1})).await;
    assert_eq!(invalid.status(), StatusCode::OK);
    let invalid = invalid.json::<Value>().await.unwrap();
    assert_eq!(invalid["result"]["error"]["code"], "INVALID_PARAMETERS");
    assert!(invalid["resources"].is_null());
    let response = invoke(json!({"x":0,"y":0,"width":3,"height":2})).await;
    let status = response.status();
    let response = response.json::<Value>().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["result"]["width"], 3);
    assert_eq!(response["result"]["height"], 2);
    let output = &response["resources"][0];
    assert_eq!(output["mimeType"], "image/png");
    assert_eq!(output["derivedFrom"]["resourceId"], source["resourceId"]);
    assert_eq!(
        output["derivedFrom"]["contentVersion"],
        source["contentVersion"]
    );
    assert_eq!(output["saved"], false);
    let derived = json!({"schemaVersion":1,"owner":owner,"resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
    let preview = request(
        "read-view",
        json!({"access":derived,"offset":0,"length":32768}),
    )
    .await;
    assert_eq!(preview.status(), StatusCode::OK);
    let preview = preview.json::<Value>().await.unwrap();
    let bytes = STANDARD
        .decode(preview["dataBase64"].as_str().unwrap())
        .unwrap();
    assert_eq!(sha256_hex(&bytes), output["contentVersion"]);
    let expected = image::imageops::crop_imm(&original, 0, 0, 3, 2).to_image();
    assert_eq!(
        image::load_from_memory(&bytes).unwrap().to_rgba8(),
        expected
    );

    let context = export::Context {
        window: "crop-test-window".into(),
        workspace: target.workspace_id.clone(),
        route: "/workspace".into(),
    };
    let destination = sandbox.path().join("crop.png");
    let prepare = |path| host.prepare_resource_export(context.clone(), derived.clone(), path);
    let commit =
        |id, confirm| host.commit_resource_export(context.clone(), derived.clone(), id, confirm);
    let grant = prepare(destination.clone()).unwrap();
    let grant_id = |grant: &Value| grant["grantId"].as_str().unwrap().to_owned();
    assert!(!destination.exists());
    assert_eq!(
        commit(grant_id(&grant), false).unwrap_err(),
        "resource_confirmation_required"
    );
    assert!(!destination.exists());
    let saved = commit(grant_id(&grant), true).unwrap();
    assert_eq!(saved["receipt"]["byteLength"], bytes.len());
    assert_eq!(std::fs::read(&destination).unwrap(), bytes);
    assert!(commit(grant_id(&grant), true).is_err());
    assert!(prepare(destination.clone()).is_err());
    let cancelled = sandbox.path().join("cancelled.png");
    let grant = prepare(cancelled.clone()).unwrap();
    host.cancel_resource_export(context.clone(), derived.clone(), grant_id(&grant))
        .unwrap();
    assert!(commit(grant_id(&grant), true).is_err());
    assert!(!cancelled.exists());
    let revoked = sandbox.path().join("revoked.png");
    let grant = prepare(revoked.clone()).unwrap();
    assert!(request("revoke", source).await.status().is_success());
    assert!(commit(grant_id(&grant), true).is_err());
    assert!(!revoked.exists());
    assert_eq!(std::fs::read(source_file).unwrap(), png);
    println!(
        "IMAGE_CROP_READBACK {} bytes {}",
        bytes.len(),
        sha256_hex(&bytes)
    );
    host.stop();
    drop(runtime);
}

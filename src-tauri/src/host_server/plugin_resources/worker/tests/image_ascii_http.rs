//! Confirm the original image, use the production Worker, then preview and save the TXT.
use super::*;
use crate::plugin_resource_execution::ascii_art::{CAPABILITY_ID, PLUGIN_ID, PROFILE};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageEncoder, RgbImage};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires a frozen ASCII image package and the Windows Studio Worker"]
async fn image_ascii_frozen_host_worker_and_confirmed_export() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_IMAGE_ASCII_PACKAGE").unwrap());
    let worker = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    std::fs::create_dir_all(&scratch).unwrap();
    let sandbox = tempfile::Builder::new()
        .prefix("image-ascii-host-")
        .tempdir_in(scratch)
        .unwrap();
    let profile = sandbox.path().join("profile");
    crate::desktop_profile::initialize(["--isolated-profile".into(), profile.into_os_string()])
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
        uuid::Uuid::new_v4().to_string(),
        "ascii-test-worker",
        "ascii-test-instance",
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
            token_hash: sha256_hex(b"synthetic-ascii-host-fixture-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "ascii-test-session")
        .unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), workspace);
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(worker);
    {
        use crate::plugin_registry::manual_catalog::{CatalogQuery, DetailQuery};
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), PLUGIN_ID);
        assert!(
            registry
                .set_enabled("programming", PLUGIN_ID, true)
                .is_err()
        );
        registry
            .set_permission("programming", PLUGIN_ID, "resource.read", true)
            .unwrap();
        registry
            .set_enabled("programming", PLUGIN_ID, true)
            .unwrap();
        let catalog = registry
            .manual_catalog(&CatalogQuery {
                scene_id: "programming".into(),
                plugin_id: Some(PLUGIN_ID.into()),
                ..Default::default()
            })
            .unwrap();
        assert_eq!(catalog["total"], 1);
        let detail = registry
            .manual_tool_detail(&DetailQuery {
                scene_id: "programming".into(),
                plugin_id: PLUGIN_ID.into(),
                capability_id: CAPABILITY_ID.into(),
                revision: registry.manual_revision("programming"),
                resource_mime_type: None,
            })
            .unwrap();
        assert_eq!(detail["capability"]["executionProfile"], PROFILE);
    }

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":PLUGIN_ID,"capabilityId":CAPABILITY_ID});
    let request = |route, body| output_http::post(&host, &client, route, body);
    let png = RgbImage::new(16, 16);
    let mut bytes = Vec::new();
    image::codecs::png::PngEncoder::new(&mut bytes)
        .write_image(png.as_raw(), 16, 16, image::ExtendedColorType::Rgb8)
        .unwrap();
    let source = output_http::material_with_mime(&host, &client, &owner, "image/png", &bytes).await;
    let response = request(
        "invoke-view",
        json!({"access":source,
        "toolCallId":uuid::Uuid::new_v4(),"input":{"width":8}}),
    )
    .await;
    let status = response.status();
    let response = response.json::<Value>().await.unwrap();
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(
        response["result"],
        json!({"ok":true,"width":8,"height":4,"byteLength":36})
    );
    let output = &response["resources"][0];
    assert_eq!(output["mimeType"], "text/plain");
    assert_eq!(output["derivedFrom"]["resourceId"], source["resourceId"]);
    assert_eq!(output["saved"], false);

    let derived = json!({"schemaVersion":1,"owner":owner,
        "resourceId":output["resourceId"],"contentVersion":output["contentVersion"]});
    let preview = request(
        "read-view",
        json!({"access":derived,"offset":0,"length":32768}),
    )
    .await;
    assert_eq!(preview.status(), StatusCode::OK);
    let preview = preview.json::<Value>().await.unwrap();
    let text = STANDARD
        .decode(preview["dataBase64"].as_str().unwrap())
        .unwrap();
    assert_eq!(text, b"@@@@@@@@\n@@@@@@@@\n@@@@@@@@\n@@@@@@@@\n");
    assert_eq!(sha256_hex(&text), output["contentVersion"]);

    let context = export::Context {
        window: "ascii-test-window".into(),
        workspace: target.workspace_id.clone(),
        route: "/workspace".into(),
    };
    let destination = sandbox.path().join("art.txt");
    let grant = host
        .prepare_resource_export(context.clone(), derived.clone(), destination.clone())
        .unwrap();
    let id = grant["grantId"].as_str().unwrap().to_owned();
    assert_eq!(
        host.commit_resource_export(context.clone(), derived.clone(), id.clone(), false)
            .unwrap_err(),
        "resource_confirmation_required"
    );
    assert!(!destination.exists());
    host.commit_resource_export(context, derived, id, true)
        .unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), text);
    assert!(request("revoke", source).await.status().is_success());
    host.stop();
    drop(runtime);
}

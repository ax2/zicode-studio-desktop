//! Verify the frozen image conversion plugin's animation errors through Host and Worker.
use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires the production Windows Studio Worker"]
async fn frozen_image_conversion_rejects_animation_without_an_output() {
    const PLUGIN: &str = "com.zicode.devtools.image-convert";
    const CAPABILITY: &str = "devtools.image.convert.original-size";
    let package = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/devtools-windows-file-tools/image-convert-0.1.0-candidate-01");
    let wasm = std::fs::read(package.join("runtime/tools.wasm")).unwrap();
    assert_eq!(
        sha256_hex(&wasm),
        "fd8ca2e9e0eaa29cc91846ad2ce4b61c7b0dd197e4d5aa927141e8a9353f2ba5"
    );

    let sandbox = tempfile::tempdir().unwrap();
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
        "image-convert-test",
        "image-convert-instance",
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
            token_hash: sha256_hex(b"synthetic-image-convert-host-fixture-token"),
            target: issued.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let target = host
        .state
        .runtimes
        .bind_session_id(&issued, "image-convert-test-session")
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
        .unwrap() = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap(),
    ));
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), PLUGIN);
        registry
            .set_permission("programming", PLUGIN, "resource.read", true)
            .unwrap();
        registry.set_enabled("programming", PLUGIN, true).unwrap();
    }
    let owner = json!({
        "runtimeId":target.instance_id, "sessionId":target.session_id, "pluginId":PLUGIN,
        "capabilityId":CAPABILITY
    });
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    // Two generated 4x4 two-frame files from the provider's conformance vectors.
    for (mime, sample) in [
        (
            "image/png",
            concat!(
                "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNU",
                "TAAAAAAAAAAEAAAABAAAAAAAAAAAAAEABQAAXC5E3AAAABVJREFUeJxjjApw+8+ABJiQOcQJAAB/CAH3G",
                "izazwAAABpmY1RMAAAAAQAAAAQAAAAEAAAAAAAAAAAAAQAFAADHXa4IAAAAGWZkQVQAAAACeJxjjOLh/8",
                "+ABJiQOcQJAABfiQF8ZT2lrwAAAABJRU5ErkJggg=="
            ),
        ),
        (
            "image/webp",
            concat!(
                "UklGRqwAAABXRUJQVlA4WAoAAAACAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GOAAAAAAAAAAAAAMAAA",
                "MAAMgAAAJWUDggIAAAADABAJ0BKgQABAABQCYllAADcAD+8U2voaNPw/Ox7XAAQU5NRkAAAAAAAAAAAAA",
                "DAAADAADIAAAAVlA4ICgAAAA0AQCdASoEAAQAAAAmJaAAA3AA/vqJ3/4Nkim5H//5Kf/eV/ru4oAA"
            ),
        ),
    ] {
        let bytes = STANDARD.decode(sample).unwrap();
        let access = output_http::material_with_mime(&host, &client, &owner, mime, &bytes).await;
        let count = host.state.plugin_resources.lock().unwrap().record_count();
        let response = output_http::post(
            &host,
            &client,
            "invoke-view",
            json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{"format":"png"}}),
        )
        .await;
        let status = response.status();
        let body = response.json::<Value>().await.unwrap();
        assert_eq!(status, StatusCode::OK, "{mime}: {body}");
        assert_eq!(
            body["result"],
            json!({"ok":false,"error":{
                "code":"IMAGE_ANIMATED","message":"请选择一张静态 PNG、JPEG 或 WebP 图片"
            }})
        );
        assert!(body["resources"].is_null());
        assert_eq!(
            host.state.plugin_resources.lock().unwrap().record_count(),
            count
        );
        println!(
            "IMAGE_CONVERT_ANIMATION {mime} {} no output",
            sha256_hex(&bytes)
        );
    }
    host.stop();
    drop(runtime);
}

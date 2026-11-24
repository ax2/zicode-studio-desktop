//! End-to-end tests for the existing frozen QR provider and native PNG save grants.

use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

const PLUGIN: &str = "com.zicode.devtools.compute";
const CAPABILITY: &str = "devtools.compute.qr.png";

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
#[ignore = "requires the frozen Compute package, matching receipt and Windows production Worker"]
async fn qr_png_frozen_worker_and_native_save() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_COMPUTE_PACKAGE").unwrap());
    let receipt = package.with_file_name(format!(
        "{}-verification.json",
        package.file_name().unwrap().to_string_lossy()
    ));
    let receipt: Value = serde_json::from_slice(&std::fs::read(receipt).unwrap()).unwrap();
    assert_eq!(receipt["pluginId"], PLUGIN);
    for entry in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(package.join(entry["path"].as_str().unwrap())).unwrap();
        assert_eq!(entry["size"], bytes.len());
        assert_eq!(entry["sha256"], sha256_hex(&bytes));
    }
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("qr-png-export-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"frozen Compute QR native export test","lifetime":"remove on success; retain failures"}"#,
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let workspace = "d6df2bc3-24e4-4690-afc4-c540b879d139";
    let target = RuntimeTarget::new(workspace, "qr-test-session", "qr-test-runtime");
    runtimes.register_in_memory(target).unwrap();
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&package).unwrap(), PLUGIN);
        registry.set_enabled("programming", PLUGIN, true).unwrap();
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let scope = json!({"workspaceId":workspace,"sceneId":"programming","pluginId":PLUGIN,"capabilityId":CAPABILITY});
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let fixtures: Value =
        serde_json::from_slice(&std::fs::read(package.join("fixtures.json")).unwrap()).unwrap();
    let mut saved_example = None;
    let mut passed = 0;
    for case in fixtures["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["capabilityId"] == CAPABILITY)
    {
        let mut body = scope.clone();
        body["captureResult"] = json!(true);
        body["input"] = case["input"].clone();
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{}", case["id"]);
        let output: Value = response.json().await.unwrap();
        if let Some(expected) = case["expectedText"].as_str() {
            assert_eq!(output["result"]["data"]["text"], expected, "{}", case["id"]);
            let expected: Value = serde_json::from_str(expected).unwrap();
            let payload = expected["dataUrl"]
                .as_str()
                .unwrap()
                .strip_prefix("data:image/png;base64,")
                .unwrap();
            let bytes = STANDARD.decode(payload).unwrap();
            let image =
                image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
            assert_eq!(expected["width"], image.width());
            assert_eq!(expected["height"], image.height());
            let descriptor = &output["resultRef"];
            assert_eq!(
                descriptor["pngExport"],
                json!({"mimeType":"image/png","byteLength":bytes.len(),"contentVersion":sha256_hex(&bytes)})
            );
            saved_example = Some((descriptor["resultId"].clone(), bytes));
        } else {
            assert_eq!(output["result"]["ok"], false, "{}", case["id"]);
            assert!(output["resultRef"].is_null());
        }
        passed += 1;
    }
    assert_eq!(passed, 4);
    let (id, expected) = saved_example.unwrap();
    let source = json!({"scope":scope,"resultId":id,"format":"png"});
    let context = Context {
        window: "main".into(),
        workspace: workspace.into(),
        route: format!("/app/workspaces/{workspace}/tools"),
    };
    let metadata = host
        .result_text_export_metadata(&context, source.clone())
        .unwrap();
    assert_eq!(metadata["suggestedFileName"], "qr-code.png");
    assert_eq!(metadata["extension"], "png");
    assert_eq!(metadata["contentVersion"], sha256_hex(&expected));

    let output = root.canonicalize().unwrap().join("exports");
    std::fs::create_dir(&output).unwrap();
    assert!(
        host.prepare_result_text_export(context.clone(), source.clone(), output.join("wrong.txt"))
            .is_err()
    );
    let prepare = |name: &str| {
        host.prepare_result_text_export(context.clone(), source.clone(), output.join(name))
            .unwrap()["grantId"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let cancelled = prepare("cancelled.png");
    host.cancel_result_text_export(context.clone(), source.clone(), cancelled.clone())
        .unwrap();
    assert!(
        host.commit_result_text_export(context.clone(), source.clone(), cancelled, true)
            .is_err()
    );

    let grant = prepare("qr-code.png");
    let mut foreign = context.clone();
    foreign.route.push_str("/other");
    assert!(
        host.commit_result_text_export(foreign, source.clone(), grant.clone(), true)
            .is_err()
    );
    let mut text = source.clone();
    text.as_object_mut().unwrap().remove("format");
    assert!(
        host.commit_result_text_export(context.clone(), text, grant.clone(), true)
            .is_err()
    );
    assert!(
        host.commit_result_text_export(context.clone(), source.clone(), grant.clone(), false)
            .is_err()
    );
    assert_eq!(std::fs::read_dir(&output).unwrap().count(), 0);
    let result = host
        .commit_result_text_export(context.clone(), source.clone(), grant.clone(), true)
        .unwrap();
    assert_eq!(result["profile"], "result.export.png.v1");
    assert_eq!(result["receipt"]["mimeType"], "image/png");
    assert_eq!(result["receipt"]["contentVersion"], sha256_hex(&expected));
    assert_eq!(std::fs::read(output.join("qr-code.png")).unwrap(), expected);
    assert_eq!(
        host.verify_result_text_export(context.clone(), source.clone(), grant.clone())
            .unwrap()["status"],
        "verified"
    );
    assert!(
        host.commit_result_text_export(context.clone(), source.clone(), grant, true)
            .is_err()
    );

    let collision = prepare("collision.png");
    std::fs::write(output.join("collision.png"), b"existing").unwrap();
    assert!(
        host.commit_result_text_export(context.clone(), source.clone(), collision, true)
            .is_err()
    );
    assert_eq!(
        std::fs::read(output.join("collision.png")).unwrap(),
        b"existing"
    );
    let revoked = prepare("revoked.png");
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", PLUGIN, false)
        .unwrap();
    assert!(
        host.commit_result_text_export(context, source, revoked, true)
            .is_err()
    );
    assert_eq!(std::fs::read_dir(&output).unwrap().count(), 2);

    println!(
        "{} {}: four frozen QR vectors; PNG export {} bytes, SHA-256 {}",
        PLUGIN,
        receipt["packageVersion"],
        expected.len(),
        sha256_hex(&expected)
    );
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

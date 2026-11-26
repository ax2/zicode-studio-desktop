//! End-to-end tests for the frozen QR providers and native PNG save grants.

use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};
use std::path::Path;

const PLUGIN: &str = "com.zicode.devtools.compute";
const CAPABILITY: &str = "devtools.compute.qr.png";
const INDEPENDENT_PLUGIN: &str = "com.zicode.devtools.qr";
const INDEPENDENT_CAPABILITY: &str = "devtools.qr.png";
const WORKSPACE: &str = "d6df2bc3-24e4-4690-afc4-c540b879d139";
const INDEPENDENT_RECEIPT_SHA256: &str =
    "01b9d3a053d786fb07112d04cd58b2fc4c99ff11cbdb683c47d2d4833016c218";

fn verified_receipt(package: &Path, plugin: &str, receipt_digest: Option<&str>) -> Value {
    let receipt = package.with_file_name(format!(
        "{}-verification.json",
        package.file_name().unwrap().to_string_lossy()
    ));
    let receipt_bytes = std::fs::read(receipt).unwrap();
    if let Some(expected) = receipt_digest {
        assert_eq!(sha256_hex(&receipt_bytes), expected);
    }
    let receipt: Value = serde_json::from_slice(&receipt_bytes).unwrap();
    assert_eq!(receipt["pluginId"], plugin);
    for entry in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(package.join(entry["path"].as_str().unwrap())).unwrap();
        assert_eq!(entry["size"], bytes.len());
        assert_eq!(entry["sha256"], sha256_hex(&bytes));
    }
    receipt
}

async fn start_qr_host(
    root: &Path,
    package: &Path,
    plugin: &str,
    executable: PathBuf,
) -> HostServer {
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose":"frozen QR native export test","pluginId":plugin}).to_string(),
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let target = RuntimeTarget::new(WORKSPACE, "qr-test-session", "qr-test-runtime");
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
        assert_eq!(registry.install_developer(package).unwrap(), plugin);
        registry.set_enabled("programming", plugin, true).unwrap();
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable);
    host
}

async fn invoke_qr(
    host: &HostServer,
    client: &reqwest::Client,
    scope: &Value,
    input: Value,
) -> (StatusCode, Value) {
    let mut body = scope.clone();
    body["captureResult"] = json!(true);
    body["input"] = input;
    let response = client
        .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&body)
        .send()
        .await
        .unwrap();
    (response.status(), response.json().await.unwrap())
}

fn verified_png(expected: &Value, descriptor: &Value) -> Vec<u8> {
    let payload = expected["dataUrl"]
        .as_str()
        .unwrap()
        .strip_prefix("data:image/png;base64,")
        .unwrap();
    let bytes = STANDARD.decode(payload).unwrap();
    let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
    assert_eq!(expected["width"], image.width());
    assert_eq!(expected["height"], image.height());
    assert_eq!(
        descriptor["pngExport"],
        json!({"mimeType":"image/png","byteLength":bytes.len(),"contentVersion":sha256_hex(&bytes)})
    );
    bytes
}

fn verify_native_png_save(
    host: &HostServer,
    root: &Path,
    plugin: &str,
    scope: Value,
    id: Value,
    expected: &[u8],
) {
    let source = json!({"scope":scope,"resultId":id,"format":"png"});
    let context = Context {
        window: "main".into(),
        workspace: WORKSPACE.into(),
        route: format!("/app/workspaces/{WORKSPACE}/tools"),
    };
    let metadata = host
        .result_text_export_metadata(&context, source.clone())
        .unwrap();
    assert_eq!(metadata["suggestedFileName"], "qr-code.png");
    assert_eq!(metadata["extension"], "png");
    assert_eq!(metadata["contentVersion"], sha256_hex(expected));

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
    assert_eq!(result["receipt"]["contentVersion"], sha256_hex(expected));
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
        .set_enabled("programming", plugin, false)
        .unwrap();
    assert!(
        host.commit_result_text_export(context, source, revoked, true)
            .is_err()
    );
    assert_eq!(std::fs::read_dir(&output).unwrap().count(), 2);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
#[ignore = "requires the frozen Compute package, matching receipt and Windows production Worker"]
async fn qr_png_frozen_worker_and_native_save() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_COMPUTE_PACKAGE").unwrap());
    let receipt = verified_receipt(&package, PLUGIN, None);
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("qr-png-export-{}", uuid::Uuid::new_v4()));
    let host = start_qr_host(&root, &package, PLUGIN, executable).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let scope = json!({"workspaceId":WORKSPACE,"sceneId":"programming","pluginId":PLUGIN,"capabilityId":CAPABILITY});
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
        let (status, output) = invoke_qr(&host, &client, &scope, case["input"].clone()).await;
        assert_eq!(status, StatusCode::OK, "{}", case["id"]);
        if let Some(expected) = case["expectedText"].as_str() {
            assert_eq!(output["result"]["data"]["text"], expected, "{}", case["id"]);
            let expected: Value = serde_json::from_str(expected).unwrap();
            let descriptor = &output["resultRef"];
            let bytes = verified_png(&expected, descriptor);
            saved_example = Some((descriptor["resultId"].clone(), bytes));
        } else {
            assert_eq!(output["result"]["ok"], false, "{}", case["id"]);
            assert!(output["resultRef"].is_null());
        }
        passed += 1;
    }
    assert_eq!(passed, 4);
    let (id, expected) = saved_example.unwrap();
    verify_native_png_save(&host, &root, PLUGIN, scope, id, &expected);

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

fn qr_receipt_case<'a>(cases: &'a Value, key: &str, name: &str) -> &'a Value {
    cases
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case[key] == name)
        .unwrap_or_else(|| panic!("missing QR receipt case {name}"))
}

fn varied_cjk(count: u32) -> String {
    (0..count)
        .map(|index| char::from_u32(0x4e00 + index * 419 % 7000).unwrap())
        .collect()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 3)]
#[ignore = "requires local QR 0.1.0 candidate 01, matching receipt and Windows production Worker"]
async fn qr_png_independent_frozen_worker_and_native_save() {
    let package = PathBuf::from(std::env::var_os("ZICODE_TEST_INDEPENDENT_QR_PACKAGE").unwrap());
    let receipt = verified_receipt(
        &package,
        INDEPENDENT_PLUGIN,
        Some(INDEPENDENT_RECEIPT_SHA256),
    );
    assert_eq!(receipt["packageVersion"], "0.1.0");
    assert_eq!(receipt["fileCount"], 8);
    assert_eq!(
        receipt["directoryIndexSha256"],
        "6dc57494c43443f3599fd49a00cdf30a97c70a8a9e051df0e08a8e76e92a257c"
    );
    let fixtures: Value =
        serde_json::from_slice(&std::fs::read(package.join("fixtures.json")).unwrap()).unwrap();
    let provenance: Value =
        serde_json::from_slice(&std::fs::read(package.join("provenance.json")).unwrap()).unwrap();
    let evidence = &provenance["workerVerification"];
    assert_eq!(evidence["decoder"], "ZXing Core 3.5.3");
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    assert_eq!(
        evidence["workerSha256"],
        sha256_hex(&std::fs::read(&executable).unwrap())
    );

    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("qr-independent-export-{}", uuid::Uuid::new_v4()));
    let host = start_qr_host(&root, &package, INDEPENDENT_PLUGIN, executable).await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let scope = json!({
        "workspaceId":WORKSPACE,
        "sceneId":"programming",
        "pluginId":INDEPENDENT_PLUGIN,
        "capabilityId":INDEPENDENT_CAPABILITY
    });
    let cases = [
        ("short_cjk_regression", 18, varied_cjk(6)),
        ("short_with_bom", 9, "\u{feff}中\r\nB".into()),
        ("boundary_cjk_varied", 2048, varied_cjk(682) + "AZ"),
    ];
    let mut captured = Vec::new();
    for (name, expected_length, text) in cases {
        let fixture = qr_receipt_case(&fixtures["cases"], "id", name);
        let provider = qr_receipt_case(&evidence["cases"], "name", name);
        assert_eq!(fixture["capabilityId"], INDEPENDENT_CAPABILITY);
        assert_eq!(fixture["expectedSuccess"], true);
        assert_eq!(text.len(), expected_length);
        assert_eq!(fixture["inputBytes"], expected_length);
        assert_eq!(fixture["inputSha256"], sha256_hex(text.as_bytes()));
        assert_eq!(provider["inputSha256"], fixture["inputSha256"]);

        let (status, output) = invoke_qr(&host, &client, &scope, json!({"text":text})).await;
        assert_eq!(status, StatusCode::OK, "{name}: {output}");
        assert_eq!(output["result"]["ok"], true, "{name}: {output}");
        let material: Value =
            serde_json::from_str(output["result"]["data"]["text"].as_str().unwrap()).unwrap();
        let descriptor = &output["resultRef"];
        let png = verified_png(&material, descriptor);
        assert_eq!(material["mimeType"], "image/png");
        assert_eq!(material["width"], fixture["expectedSide"]);
        assert_eq!(material["width"], provider["size"]);
        assert_eq!(material["pngBytes"], provider["pngBytes"]);
        assert_eq!(png.len(), provider["pngBytes"].as_u64().unwrap() as usize);
        assert_eq!(provider["pngSha256"], sha256_hex(&png));
        captured.push((name, descriptor["resultId"].clone(), png));
    }

    let (status, rejection) =
        invoke_qr(&host, &client, &scope, json!({"text":"中".repeat(683)})).await;
    assert_eq!(status, StatusCode::OK, "{rejection}");
    assert_eq!(rejection["result"]["ok"], false);
    let oversized = qr_receipt_case(&fixtures["cases"], "id", "over_2048");
    assert_eq!(
        rejection["result"]["error"]["code"],
        oversized["expectedError"]
    );
    assert_eq!(
        rejection["result"]["error"]["message"],
        "二维码内容不能超过 2048 字节"
    );
    assert!(rejection["resultRef"].is_null());
    for input in [
        json!({"text":""}),
        json!({"text":42}),
        json!({"text":"A".repeat(2049)}),
        json!({"text":"5","options":"{\"scale\":2}"}),
    ] {
        let (status, response) = invoke_qr(&host, &client, &scope, input).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        assert_eq!(response["error"]["code"], "invalid_parameters");
        assert!(response["resultRef"].is_null());
    }

    let context = Context {
        window: "main".into(),
        workspace: WORKSPACE.into(),
        route: format!("/app/workspaces/{WORKSPACE}/tools"),
    };
    let output = root.canonicalize().unwrap().join("provider-vectors");
    std::fs::create_dir(&output).unwrap();
    let (largest_name, largest_id, largest) = captured.pop().unwrap();
    for (name, id, expected) in captured {
        let source = json!({"scope":scope,"resultId":id,"format":"png"});
        let path = output.join(format!("{name}.png"));
        let prepared = host
            .prepare_result_text_export(context.clone(), source.clone(), path.clone())
            .unwrap();
        let grant = prepared["grantId"].as_str().unwrap().to_owned();
        assert!(!path.exists());
        host.commit_result_text_export(context.clone(), source.clone(), grant.clone(), true)
            .unwrap();
        assert_eq!(std::fs::read(path).unwrap(), expected);
        assert_eq!(
            host.verify_result_text_export(context.clone(), source, grant)
                .unwrap()["status"],
            "verified"
        );
    }
    assert_eq!(largest_name, "boundary_cjk_varied");
    verify_native_png_save(
        &host,
        &root,
        INDEPENDENT_PLUGIN,
        scope,
        largest_id,
        &largest,
    );
    host.stop_and_wait().await.unwrap();
    println!(
        "{INDEPENDENT_PLUGIN} 0.1.0: three provider-matched vectors and PNG readbacks, five input rejections; isolated evidence at {}",
        root.display()
    );
}

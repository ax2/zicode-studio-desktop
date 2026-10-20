use super::*;
use crate::metadata_store::MetadataStore;

pub(super) fn verify_receipt(
    project: &std::path::Path,
    candidate: &std::path::Path,
    receipt: &std::path::Path,
    expected_file_count: usize,
) {
    let output = std::process::Command::new("bun")
        .current_dir(project)
        .arg("run")
        .arg("verify:devtools-package")
        .arg(candidate)
        .arg(receipt)
        .output()
        .expect("Bun receipt verifier must be available");
    assert!(
        output.status.success(),
        "receipt verification failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["verified"], true);
    assert_eq!(result["fileCount"], expected_file_count);
    assert_eq!(result["directoryIndex"]["status"], "matched");
    assert_eq!(result["signatureVerified"], false);
    assert_eq!(result["runtimeAccepted"], false);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_INSPECT_011_DIR, ZICODE_TEST_INSPECT_011_RECEIPT and ZICODE_TEST_WORKER_EXE; run alone"]
async fn current_inspect_candidate_runs_all_eight_operations_in_real_host_worker() {
    run_inspect_host_candidate("011", "0.1.1", 606).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_INSPECT_012_DIR, ZICODE_TEST_INSPECT_012_RECEIPT and ZICODE_TEST_WORKER_EXE; run alone"]
async fn current_inspect_012_runs_all_eight_operations_in_real_host_worker() {
    run_inspect_host_candidate("012", "0.1.2", 616).await;
}

async fn run_inspect_host_candidate(suffix: &str, version: &str, file_count: usize) {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let candidate = PathBuf::from(std::env::var_os(format!("ZICODE_TEST_INSPECT_{suffix}_DIR")).unwrap())
        .canonicalize()
        .unwrap();
    let receipt = PathBuf::from(std::env::var_os(format!("ZICODE_TEST_INSPECT_{suffix}_RECEIPT")).unwrap())
        .canonicalize()
        .unwrap();
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap())
        .canonicalize()
        .unwrap();
    verify_receipt(&project, &candidate, &receipt, file_count);
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(candidate.join("plugin.json")).unwrap()).unwrap();
    assert_eq!(manifest["version"], version);

    let root = project
        .join(".cache/task-scratch")
        .join(format!("inspect-{suffix}-host-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose":format!("Inspect {version} real Host/Worker acceptance"), "lifetime":"remove on pass; retain failure for diagnosis"}).to_string(),
    )
    .unwrap();
    crate::desktop_profile::initialize([
        std::ffi::OsString::from("--isolated-profile"),
        root.join("profile").into_os_string(),
    ])
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin_id = "com.zicode.devtools.inspect";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&candidate).unwrap(), plugin_id);
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
    }
    verify_receipt(
        &project,
        &root.join("test-plugin-registry/developer").join(plugin_id),
        &receipt,
        file_count,
    );
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable);

    let catalog: Value =
        serde_json::from_slice(&std::fs::read(candidate.join("catalog.json")).unwrap()).unwrap();
    let fixtures: Value =
        serde_json::from_slice(&std::fs::read(candidate.join("fixtures/inspect.json")).unwrap())
            .unwrap();
    let tools = catalog["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 8);
    let cases = fixtures["cases"].as_array().unwrap();
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let request = |capability: &str, input: Value| {
        json!({"sceneId":"programming","workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "pluginId":plugin_id,"capabilityId":capability,"input":input})
    };
    let first = tools[0]["capabilityId"].as_str().unwrap();
    assert_eq!(
        client
            .post(&endpoint)
            .json(&request(first, json!({"text":"#FF8800"})))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );

    for tool in tools {
        let capability = tool["capabilityId"].as_str().unwrap();
        let case = cases
            .iter()
            .find(|case| {
                case["capabilityId"] == capability
                    && (case["id"].as_str().unwrap().ends_with("-sample")
                        || case["id"] == "color-known-0")
            })
            .unwrap();
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request(capability, case["input"].clone()))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{capability}");
        let result: Value = response.json().await.unwrap();
        assert_eq!(result["result"]["ok"], true, "{capability}: {result}");
        assert_eq!(
            result["result"]["data"]["text"], case["expectedText"],
            "{capability}"
        );
        eprintln!("Inspect {version} actual Host/Worker passed: {capability}");
    }

    let invalid = request("devtools.inspect.yaml.to_json", json!({"text":"a: ["}));
    let response: Value = client
        .post(&endpoint)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&invalid)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(response["result"]["ok"], false);
    assert_eq!(response["result"]["error"]["code"], "INVALID_INPUT");
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin_id, false)
        .unwrap();
    assert!(!client
        .post(&endpoint)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&invalid)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

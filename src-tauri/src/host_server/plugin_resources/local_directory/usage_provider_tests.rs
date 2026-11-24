//! Installs the independent frozen Disk Inspector and exercises its real Windows input path.
use super::*;
use crate::host_server::{HostMode, HostServer, RemoteAuth};
use crate::native_pi_manager::NativePiManager;
use crate::runtime_coordinator::RuntimeTarget;
use std::fs;

const WASM_SHA256: &str = "c5d1397ac3877b227b0aedc22362588235949515541cbda92d2db374f86c9d47";

#[tokio::test]
#[ignore = "requires the frozen Disk Inspector, its independent receipt, and the Windows production Worker"]
async fn frozen_disk_inspector_reports_real_confirmed_directories() {
    let candidate = PathBuf::from(std::env::var_os("ZICODE_TEST_DISK_INSPECTOR_DIR").unwrap());
    let receipt = PathBuf::from(std::env::var_os("ZICODE_TEST_DISK_INSPECTOR_RECEIPT").unwrap());
    let worker = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let manifest: Value =
        serde_json::from_slice(&fs::read(candidate.join("plugin.json")).unwrap()).unwrap();
    assert_eq!(manifest["id"], usage::PLUGIN);
    assert_eq!(manifest["version"], "0.1.0");
    let wasm = candidate.join(manifest["runtime"]["wasi"].as_str().unwrap());
    assert_eq!(sha256_hex(&fs::read(wasm).unwrap()), WASM_SHA256);
    let receipt_data: Value = serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    assert_eq!(
        receipt_data["directoryIndexSha256"],
        "dcfcbe53efddaf6c30d8f5429b34239f2038d50c855ecfb26c0d7ebb726e5e77"
    );
    crate::host_server::inspect_011_host_tests::verify_receipt(&project, &candidate, &receipt, 8);

    let scratch = project.join(".cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let fixture = tempfile::tempdir_in(scratch).unwrap();
    let root = fixture.path().canonicalize().unwrap();
    fs::create_dir(root.join("public")).unwrap();
    fs::create_dir_all(root.join("normal/archive/quarter")).unwrap();
    fs::create_dir(root.join("normal/empty")).unwrap();
    fs::write(root.join("normal/root.log"), b"1234567").unwrap();
    fs::write(
        root.join("normal/archive/报告.txt"),
        b"private fixture contents",
    )
    .unwrap();
    fs::write(root.join("normal/archive/quarter/details.csv"), b"12345").unwrap();
    fs::write(root.join("outside.txt"), b"fixture outside selection").unwrap();

    let host_partial = root.join("depth");
    fs::create_dir(&host_partial).unwrap();
    fs::write(host_partial.join("visible.txt"), b"visible").unwrap();
    let mut nested = host_partial;
    for _ in 0..17 {
        nested.push("d");
    }
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("excluded.txt"), b"deeper namespace").unwrap();

    let worker_partial = root.join("budget");
    fs::create_dir(&worker_partial).unwrap();
    let long_name = "d".repeat(110);
    for index in 0..600 {
        fs::write(
            worker_partial.join(format!("{index:03}-{long_name}.txt")),
            b"abc",
        )
        .unwrap();
    }

    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let target = RuntimeTarget::new(
        "2d22f30c-7a2d-4af1-8cd4-aadf063cc80d",
        "disk-inspector-session",
        "disk-inspector-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), root.clone());
    *host
        .state
        .plugin_resource_workers
        .executable
        .lock()
        .unwrap() = Some(worker);
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(
            registry.install_developer(&candidate).unwrap(),
            usage::PLUGIN
        );
        registry
            .set_enabled("programming", usage::PLUGIN, true)
            .unwrap();
        registry
            .set_permission("programming", usage::PLUGIN, "resource.read", true)
            .unwrap();
    }

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let owner = json!({
        "runtimeId": target.instance_id, "sessionId": target.session_id,
        "pluginId": usage::PLUGIN, "capabilityId": usage::CAPABILITY
    });
    let prepare_body = |path| {
        json!({
            "schemaVersion": 1, "owner": owner, "relativePath": path, "profile": usage::PROFILE,
        })
    };
    let grant_body = |preview: &Value, confirmed| {
        json!({
            "schemaVersion": 1, "owner": owner, "grantId": preview["grantId"], "confirmed": confirmed,
        })
    };
    let invoke_body = |access: &Value| {
        json!({
            "access": access, "toolCallId": uuid::Uuid::new_v4(), "input": {},
        })
    };
    let allow_usage = |allowed| {
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_permission("programming", usage::PLUGIN, usage::PERMISSION, allowed)
            .unwrap();
    };

    let denied = post(
        &host,
        &client,
        "prepare-local-directory",
        prepare_body("normal"),
    )
    .await;
    assert_eq!(denied.1["error"]["code"], "permission_denied");
    allow_usage(true);
    let (status, preview) = post(
        &host,
        &client,
        "prepare-local-directory",
        prepare_body("normal"),
    )
    .await;
    assert!(status.is_success(), "{preview}");
    assert_eq!(preview["entryNamesRead"], false);
    let (status, rejected) = post(
        &host,
        &client,
        "commit-local-directory",
        grant_body(&preview, false),
    )
    .await;
    assert!(!status.is_success());
    assert_eq!(rejected["error"]["code"], "resource_confirmation_required");
    let (_, cancelled) = post(
        &host,
        &client,
        "cancel-local-directory",
        grant_body(&preview, false),
    )
    .await;
    assert_eq!(cancelled["cancelled"], true);
    let (status, _) = post(
        &host,
        &client,
        "commit-local-directory",
        grant_body(&preview, true),
    )
    .await;
    assert!(!status.is_success());

    let mut last_access = Value::Null;
    for path in ["normal", "depth", "budget"] {
        let (status, preview) = post(
            &host,
            &client,
            "prepare-local-directory",
            prepare_body(path),
        )
        .await;
        assert!(status.is_success(), "{preview}");
        assert_eq!(preview["profile"], usage::PROFILE);
        assert_eq!(preview["entryNamesRead"], false);
        assert!(!preview.to_string().contains("报告.txt"));
        let (status, resource) = post(
            &host,
            &client,
            "commit-local-directory",
            grant_body(&preview, true),
        )
        .await;
        assert!(status.is_success(), "{resource}");
        assert_eq!(resource["profile"], usage::PROFILE);
        assert_eq!(resource["partial"], path == "depth");
        let access = &resource["access"];
        let (status, response) = post(&host, &client, "invoke-view", invoke_body(access)).await;
        assert!(status.is_success(), "{response}");
        let report = &response["result"];
        assert_eq!(report["material"], "directory-usage-report", "{response}");
        assert_eq!(report["schemaVersion"], 1);
        assert_eq!(report["ok"], true);
        assert_eq!(report["partial"], path != "normal");
        match path {
            "normal" => {
                assert_eq!(report["logicalBytes"], "36");
                assert_eq!(report["rootFilesLogicalBytes"], "7");
                assert_eq!(report["fileCount"], 3);
                assert_eq!(report["directoryCount"], 3);
                assert_eq!(report["groupCount"], 2);
                assert_eq!(
                    report["groups"],
                    json!([
                        {"path":"archive","logicalBytes":"29","pathTruncated":false},
                        {"path":"empty","logicalBytes":"0","pathTruncated":false}
                    ])
                );
                assert_eq!(
                    report["largestFiles"],
                    json!([
                        {"path":"archive/报告.txt","logicalBytes":"24","pathTruncated":false},
                        {"path":"root.log","logicalBytes":"7","pathTruncated":false},
                        {"path":"archive/quarter/details.csv","logicalBytes":"5","pathTruncated":false}
                    ])
                );
            }
            "depth" => {
                assert_eq!(report["source"]["skippedDepth"], 1);
                assert_eq!(report["analysis"]["limitReason"], Value::Null);
                assert_eq!(report["logicalBytes"], "7");
                assert_eq!(report["fileCount"], 1);
            }
            "budget" => {
                assert_eq!(resource["entryCount"], 600);
                assert_eq!(report["analysis"]["limitReason"], "analysis_bytes");
                assert_eq!(report["analysis"]["readBytes"], 65_536);
                let count = report["fileCount"].as_u64().unwrap();
                assert!((20..600).contains(&count));
                assert_eq!(report["largestFiles"].as_array().unwrap().len(), 20);
                assert_eq!(report["logicalBytes"], (count * 3).to_string());
            }
            _ => unreachable!(),
        }
        let text = report.to_string();
        assert!(!text.contains("private fixture contents"));
        assert!(!text.contains("excluded.txt"));
        assert!(!text.contains("outside.txt"));
        let encoded_root = serde_json::to_string(root.to_str().unwrap()).unwrap();
        assert!(!text.contains(encoded_root.trim_matches('"')));
        println!(
            "DISK_INSPECTOR_REPORT {}",
            json!({"case":path,"report":report})
        );
        last_access = access.clone();
    }

    allow_usage(false);
    let (status, _) = post(&host, &client, "invoke-view", invoke_body(&last_access)).await;
    assert!(!status.is_success());
    host.stop_and_wait().await.unwrap();
}

async fn post(
    host: &HostServer,
    client: &reqwest::Client,
    operation: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = client
        .post(format!("{}/v2/plugin-resources/{operation}", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&body)
        .send()
        .await
        .unwrap();
    (response.status(), response.json().await.unwrap())
}

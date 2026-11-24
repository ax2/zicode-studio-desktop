//! Frozen Duplicate Files acceptance through the Windows Host and production Worker.
use super::{usage_provider_tests::post, *};
use crate::host_server::{HostMode, HostServer, RemoteAuth};
use crate::native_pi_manager::NativePiManager;
use crate::runtime_coordinator::RuntimeTarget;
use std::fs;

#[tokio::test]
#[ignore = "requires the frozen Duplicate Files plugin, its receipt, and the Windows production Worker"]
async fn frozen_duplicate_files_groups_a_confirmed_directory() {
    use super::duplicates;

    let candidate = PathBuf::from(std::env::var_os("ZICODE_TEST_DUPLICATE_FILES_DIR").unwrap());
    let receipt = PathBuf::from(std::env::var_os("ZICODE_TEST_DUPLICATE_FILES_RECEIPT").unwrap());
    let worker = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let manifest: Value =
        serde_json::from_slice(&fs::read(candidate.join("plugin.json")).unwrap()).unwrap();
    assert_eq!(manifest["id"], duplicates::PLUGIN);
    assert_eq!(manifest["version"], "0.1.0");
    let wasm = candidate.join(manifest["runtime"]["wasi"].as_str().unwrap());
    assert_eq!(
        sha256_hex(&fs::read(wasm).unwrap()),
        "1b345c199af31400e24062a1fa84a598d5144dc8c11a9ddb3020daab9040d73c"
    );
    let receipt_data: Value = serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    assert_eq!(
        receipt_data["directoryIndexSha256"],
        "a90f927bc4e85f794f5657979a02dd5b6ee403f9ad4c70b37828e4545e7a0f13"
    );
    crate::host_server::inspect_011_host_tests::verify_receipt(&project, &candidate, &receipt, 8);

    let scratch = project.join(".cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let fixture = tempfile::tempdir_in(scratch.canonicalize().unwrap()).unwrap();
    let private = fixture.path().join("profile");
    let selected = fixture.path().join("共享测试文件夹");
    fs::create_dir_all(private.join("public")).unwrap();
    fs::create_dir_all(selected.join("副本")).unwrap();
    fs::write(selected.join("原件.txt"), b"abc").unwrap();
    fs::write(selected.join("副本/副本.txt"), b"abc").unwrap();
    fs::write(selected.join("同大小.txt"), b"xyz").unwrap();
    fs::write(
        selected.join("唯一.txt"),
        b"only the Host sees a path for this",
    )
    .unwrap();

    let metadata =
        crate::metadata_store::MetadataStore::open(&private.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        private.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let target = RuntimeTarget::new(
        "e2b294e7-eb6b-4d98-a310-71ce34e27381",
        "duplicate-files-session",
        "duplicate-files-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), private.canonicalize().unwrap());
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
            duplicates::PLUGIN
        );
        assert!(registry
            .set_enabled("programming", duplicates::PLUGIN, true)
            .is_err());
        for permission in ["resource.read", duplicates::PERMISSION] {
            registry
                .set_permission("programming", duplicates::PLUGIN, permission, true)
                .unwrap();
        }
        registry
            .set_enabled("programming", duplicates::PLUGIN, true)
            .unwrap();
    }
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":duplicates::PLUGIN,"capabilityId":duplicates::CAPABILITY});
    let context = Context {
        window: "native-workspace-duplicates".into(),
        workspace: target.workspace_id.clone(),
        route: format!(
            "/app/workspaces/{}/sessions/{}",
            target.workspace_id, target.session_id
        ),
    };
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for (filter, expected) in [("directoryOnly", 1), ("resourceOnly", 0)] {
        let catalog: Value = client
            .get(format!("{}/v2/plugin-tool-directory", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .query(&[
                ("sceneId", "programming"),
                ("pluginId", duplicates::PLUGIN),
                (filter, "true"),
            ])
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(catalog["total"], expected, "{catalog}");
    }
    let (_, refused) = post(
        &host,
        &client,
        "prepare-local-directory",
        json!({
            "schemaVersion":1,"owner":owner,"relativePath":".","profile":duplicates::PROFILE
        }),
    )
    .await;
    assert_eq!(
        refused["error"]["code"],
        "resource_directory_profile_unsupported"
    );
    let wrong_session = Context {
        route: format!(
            "/app/workspaces/{}/sessions/another-session",
            target.workspace_id
        ),
        ..context.clone()
    };
    assert_eq!(
        host.prepare_native_directory_analysis(
            wrong_session,
            owner.clone(),
            selected.clone(),
            Some(duplicates::PROFILE)
        )
        .await
        .unwrap_err(),
        "resource_authorization_changed"
    );

    let cancelled = host
        .prepare_native_directory_analysis(
            context.clone(),
            owner.clone(),
            selected.clone(),
            Some(duplicates::PROFILE),
        )
        .await
        .unwrap();
    let cancelled = cancelled["grantId"].as_str().unwrap().to_owned();
    assert_eq!(
        host.cancel_native_plugin_directory(&context, owner.clone(), cancelled.clone())
            .unwrap()["cancelled"],
        true
    );
    assert_eq!(
        host.commit_native_plugin_directory(context.clone(), owner.clone(), cancelled, true)
            .await
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    let preview = host
        .prepare_native_directory_analysis(
            context.clone(),
            owner.clone(),
            selected.clone(),
            Some(duplicates::PROFILE),
        )
        .await
        .unwrap();
    assert_eq!(preview["profile"], duplicates::PROFILE);
    assert_eq!(preview["entryNamesRead"], false);
    assert!(preview.get("relativePath").is_none());
    assert!(!preview.to_string().contains("原件.txt"));
    let id = preview["grantId"].as_str().unwrap().to_owned();
    assert_eq!(
        host.commit_native_plugin_directory(context.clone(), owner.clone(), id.clone(), false)
            .await
            .unwrap_err(),
        "resource_confirmation_required"
    );
    let foreign = Context {
        window: "native-workspace-other".into(),
        ..context.clone()
    };
    assert_eq!(
        host.commit_native_plugin_directory(foreign, owner.clone(), id.clone(), true)
            .await
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    let resource = host
        .commit_native_plugin_directory(context.clone(), owner.clone(), id.clone(), true)
        .await
        .unwrap();
    assert_eq!(resource["profile"], duplicates::PROFILE);
    assert_eq!(resource["partial"], false);
    assert_eq!(resource["entryCount"], 3);
    assert_eq!(
        host.commit_native_plugin_directory(context.clone(), owner.clone(), id, true)
            .await
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    let request =
        || json!({"access":resource["access"],"toolCallId":uuid::Uuid::new_v4(),"input":{}});
    let (status, reply) = post(&host, &client, "invoke-view", request()).await;
    assert!(status.is_success(), "{reply}");
    let report = &reply["result"];
    assert_eq!(report["material"], "duplicate-files-report", "{report}");
    assert_eq!(report["partial"], false);
    assert_eq!(report["groupCount"], 1);
    assert_eq!(report["duplicateFileCount"], 2);
    assert_eq!(report["redundantBytes"], "3");
    let paths = report["groups"][0]["paths"].as_array().unwrap();
    assert_eq!(paths.len(), 2);
    assert!(paths.contains(&json!("原件.txt")) && paths.contains(&json!("副本/副本.txt")));
    assert_eq!(report["source"]["hashedBytes"], "9");
    assert!(!report.to_string().contains("唯一.txt"));
    assert!(!report.to_string().contains("共享测试文件夹"));
    println!(
        "DUPLICATE_FILES_REPORT {}",
        json!({"case":"normal","report":report})
    );

    let partial = selected.join("部分覆盖");
    fs::create_dir(&partial).unwrap();
    fs::write(partial.join("first"), b"same").unwrap();
    fs::write(partial.join("second"), b"same").unwrap();
    for index in 0..257 {
        fs::write(partial.join(format!("empty-{index:03}")), b"").unwrap();
    }
    let preview = host
        .prepare_native_directory_analysis(
            context.clone(),
            owner.clone(),
            partial,
            Some(duplicates::PROFILE),
        )
        .await
        .unwrap();
    let id = preview["grantId"].as_str().unwrap().to_owned();
    let resource = host
        .commit_native_plugin_directory(context, owner.clone(), id, true)
        .await
        .unwrap();
    assert_eq!(resource["partial"], true);
    assert_eq!(resource["entryCount"], 2);
    let (status, response) = post(
        &host,
        &client,
        "invoke-view",
        json!({"access":resource["access"],"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
    )
    .await;
    assert!(status.is_success(), "{response}");
    let report = &response["result"];
    assert_eq!(report["partial"], true);
    assert_eq!(report["source"]["limitReason"], "candidate_files");
    assert_eq!(report["source"]["candidateFiles"], 259);
    assert_eq!(report["source"]["skippedBudget"], 257);
    assert_eq!(report["redundantBytes"], "4");
    assert_eq!(report["groups"][0]["paths"], json!(["first", "second"]));
    println!(
        "DUPLICATE_FILES_REPORT {}",
        json!({"case":"partial","report":report})
    );

    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            duplicates::PLUGIN,
            duplicates::PERMISSION,
            false,
        )
        .unwrap();
    let (status, _) = post(&host, &client, "invoke-view", request()).await;
    assert!(!status.is_success());
    host.stop_and_wait().await.unwrap();
}

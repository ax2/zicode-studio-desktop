//! Confirmed paired filesystem input through the real Windows Host and WASI Worker.
use super::{usage_provider_tests::post, *};
use crate::host_server::{HostMode, HostServer, RemoteAuth};
use crate::native_pi_manager::NativePiManager;
use crate::runtime_coordinator::RuntimeTarget;
use std::fs;

#[tokio::test]
#[ignore = "requires a frozen Directory Compare plugin and the production Windows Worker"]
async fn frozen_directory_compare_uses_only_confirmed_relative_pairs() {
    let candidate = PathBuf::from(std::env::var_os("ZICODE_TEST_DIRECTORY_COMPARE_DIR").unwrap());
    let receipt = PathBuf::from(std::env::var_os("ZICODE_TEST_DIRECTORY_COMPARE_RECEIPT").unwrap());
    let worker = PathBuf::from(std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let receipt_data: Value = serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    let expected_index = std::env::var("ZICODE_TEST_DIRECTORY_COMPARE_INDEX").unwrap();
    assert_eq!(receipt_data["directoryIndexSha256"], expected_index);
    crate::host_server::inspect_011_host_tests::verify_receipt(&project, &candidate, &receipt, 8);

    let scratch = project.join(".cache/task-scratch");
    fs::create_dir_all(&scratch).unwrap();
    let fixture = tempfile::tempdir_in(scratch.canonicalize().unwrap()).unwrap();
    let profile = fixture.path().join("profile");
    let left = fixture.path().join("左侧合成根");
    let right = fixture.path().join("右侧合成根");
    fs::create_dir_all(profile.join("public")).unwrap();
    for side in [&left, &right] {
        fs::create_dir_all(side.join("同目录")).unwrap();
        fs::write(side.join("同内容.txt"), b"same").unwrap();
    }
    fs::create_dir(left.join("种类")).unwrap();
    fs::write(right.join("种类"), b"type-only").unwrap();
    fs::write(left.join("大小.txt"), b"abc").unwrap();
    fs::write(right.join("大小.txt"), b"x").unwrap();
    fs::write(left.join("内容.txt"), b"abc").unwrap();
    fs::write(right.join("内容.txt"), b"xyz").unwrap();
    fs::write(left.join("左侧.txt"), b"arbitrary raw left content").unwrap();
    fs::write(right.join("右侧.txt"), b"arbitrary raw right content").unwrap();

    let metadata =
        crate::metadata_store::MetadataStore::open(&profile.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        profile.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let target = RuntimeTarget::new(
        "e2b294e7-eb6b-4d98-a310-71ce34e27381",
        "directory-compare-session",
        "directory-compare-runtime",
    );
    host.start_tool_session(target.clone()).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), profile.canonicalize().unwrap());
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
            compare::PLUGIN
        );
        assert!(registry
            .set_enabled("programming", compare::PLUGIN, true)
            .is_err());
        for permission in ["resource.read", compare::PERMISSION] {
            registry
                .set_permission("programming", compare::PLUGIN, permission, true)
                .unwrap();
        }
        registry
            .set_enabled("programming", compare::PLUGIN, true)
            .unwrap();
    }
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "pluginId":compare::PLUGIN,"capabilityId":compare::CAPABILITY});
    let context = Context {
        window: "native-workspace-compare".into(),
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
                ("pluginId", compare::PLUGIN),
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
        json!({"schemaVersion":1,"owner":owner,"relativePath":".","profile":compare::PROFILE}),
    )
    .await;
    assert_eq!(
        refused["error"]["code"],
        "resource_directory_profile_unsupported"
    );
    assert_eq!(
        host.prepare_native_directory_compare(
            context.clone(),
            owner.clone(),
            left.clone(),
            left.clone()
        )
        .await
        .unwrap_err(),
        "resource_directory_compare_same_folder"
    );
    let wrong_session = Context {
        route: format!(
            "/app/workspaces/{}/sessions/different-session",
            target.workspace_id
        ),
        ..context.clone()
    };
    assert_eq!(
        host.prepare_native_directory_compare(
            wrong_session,
            owner.clone(),
            left.clone(),
            right.clone()
        )
        .await
        .unwrap_err(),
        "resource_authorization_changed"
    );

    let prepare = || {
        host.prepare_native_directory_compare(
            context.clone(),
            owner.clone(),
            left.clone(),
            right.clone(),
        )
    };
    let grant = prepare().await.unwrap();
    let id = grant["grantId"].as_str().unwrap().to_owned();
    assert_eq!(grant["entryNamesRead"], false);
    assert_eq!(grant["displayNames"], json!(["左侧合成根", "右侧合成根"]));
    assert!(!grant.to_string().contains("同内容.txt"));
    assert_eq!(
        host.commit_native_plugin_directory(context.clone(), owner.clone(), id.clone(), false)
            .await
            .unwrap_err(),
        "resource_confirmation_required"
    );
    assert_eq!(
        host.cancel_native_plugin_directory(&context, owner.clone(), id.clone())
            .unwrap()["cancelled"],
        true
    );
    assert_eq!(
        host.commit_native_plugin_directory(context.clone(), owner.clone(), id, true)
            .await
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );

    let grant = prepare().await.unwrap();
    fs::write(right.join("change-root-after-selection"), b"changed").unwrap();
    assert_eq!(
        host.commit_native_plugin_directory(
            context.clone(),
            owner.clone(),
            grant["grantId"].as_str().unwrap().to_owned(),
            true
        )
        .await
        .unwrap_err(),
        "resource_directory_changed"
    );
    fs::remove_file(right.join("change-root-after-selection")).unwrap();

    let grant = prepare().await.unwrap();
    let id = grant["grantId"].as_str().unwrap().to_owned();
    let foreign = Context {
        window: "other-native-window".into(),
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
    assert_eq!(resource["profile"], compare::PROFILE);
    assert_eq!(resource["partial"], false);
    assert_eq!(
        host.commit_native_plugin_directory(context.clone(), owner.clone(), id, true)
            .await
            .unwrap_err(),
        "resource_directory_grant_unavailable"
    );
    let invoke =
        |access: Value| json!({"access":access,"toolCallId":uuid::Uuid::new_v4(),"input":{}});
    let (status, reply) = post(
        &host,
        &client,
        "invoke-view",
        invoke(resource["access"].clone()),
    )
    .await;
    assert!(status.is_success(), "{reply}");
    let report = &reply["result"];
    assert_eq!(report["material"], "directory-compare-report", "{report}");
    assert_eq!(report["partial"], false);
    assert_eq!(report["differenceCount"], 5);
    assert_eq!(report["sameFiles"], 1);
    assert_eq!(report["sameDirectories"], 1);
    for category in [
        "onlyLeft",
        "onlyRight",
        "sizeMismatch",
        "contentMismatch",
        "typeMismatch",
    ] {
        assert_eq!(report["differenceCounts"][category], 1, "{report}");
    }
    assert!(!report.to_string().contains("arbitrary raw"));
    assert!(!report.to_string().contains("左侧合成根"));
    assert_eq!(fs::read(right.join("种类")).unwrap(), b"type-only");
    println!(
        "DIRECTORY_COMPARE_REPORT {}",
        json!({"case":"normal","report":report})
    );

    for index in 0..260 {
        fs::write(left.join(format!("z-only-{index:03}")), b"").unwrap();
    }
    let grant = prepare().await.unwrap();
    let partial = host
        .commit_native_plugin_directory(
            context,
            owner.clone(),
            grant["grantId"].as_str().unwrap().to_owned(),
            true,
        )
        .await
        .unwrap();
    assert_eq!(partial["partial"], true);
    let (status, reply) = post(
        &host,
        &client,
        "invoke-view",
        invoke(partial["access"].clone()),
    )
    .await;
    assert!(status.is_success(), "{reply}");
    let report = &reply["result"];
    assert_eq!(report["coverageComplete"], false);
    assert_eq!(report["partial"], true);
    assert_eq!(report["differenceCounts"]["onlyLeft"], 0);
    assert_eq!(report["differenceCounts"]["onlyRight"], 0);
    assert_eq!(report["differenceCounts"]["contentMismatch"], 1);
    assert_eq!(report["differenceCounts"]["sizeMismatch"], 1);
    assert_eq!(report["differenceCounts"]["typeMismatch"], 1);
    assert_eq!(report["sameFiles"], 1);
    assert!(report["unassessedOneSide"].as_u64().unwrap() > 0);
    println!(
        "DIRECTORY_COMPARE_REPORT {}",
        json!({"case":"partial","report":report})
    );

    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", compare::PLUGIN, compare::PERMISSION, false)
        .unwrap();
    let (status, _) = post(
        &host,
        &client,
        "invoke-view",
        invoke(resource["access"].clone()),
    )
    .await;
    assert!(!status.is_success());
    host.stop_and_wait().await.unwrap();
}

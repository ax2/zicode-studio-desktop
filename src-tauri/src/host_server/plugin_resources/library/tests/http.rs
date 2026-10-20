use super::*;
#[tokio::test]
async fn fresh_hosts_recover_records_with_current_workspace_authority_and_no_resource_runtime() {
    let f = Fixture::new();
    fs::create_dir(f.root.join("public")).unwrap();
    let complete = f.save(b"abc");
    let mut pending = complete.clone();
    let pending_id = uuid::Uuid::new_v4().to_string();
    pending["saveId"] = json!(pending_id);
    pending["relativePath"] = json!(format!(".zicode/outputs/{pending_id}/result.bin"));
    drop(
        save_files::Staged::new(
            &f.root,
            &[Arc::from(b"abc".as_slice())],
            &pending,
            "bin",
            &pending_id,
        )
        .unwrap(),
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    for generation in 0..2 {
        let metadata = crate::metadata_store::MetadataStore::open(
            &f.root.join(format!("auth-{generation}.sqlite3")),
        )
        .unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let host = HostServer::start_with_mode(
            f.root.join("public"),
            NativePiManager::new(16),
            auth,
            HashMap::new(),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        assert!(host.state.runtimes.statuses().unwrap().is_empty());
        host.state
            .data
            .workspace_roots()
            .write()
            .unwrap()
            .insert("ws-library".into(), f.root.clone());
        {
            let mut registry = host.state.plugins.lock().unwrap();
            registry
                .set_permission(
                    "programming",
                    "com.zicode.artifacts",
                    "storage.plugin",
                    true,
                )
                .unwrap();
            registry
                .set_enabled("programming", "com.zicode.artifacts", true)
                .unwrap();
            assert!(!registry
                .list("programming")
                .iter()
                .any(|p| p.manifest.id == "test.source"));
        }
        let attempts = get(&host, &client, "ws-library", "save-attempts", &[])
            .await
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(attempts["total"], 2);
        assert_eq!(attempts["payloadsRead"], false);
        let saved = attempts["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["publication"] == "observed")
            .unwrap();
        assert_eq!(
            get(
                &host,
                &client,
                "ws-library",
                "saved-output",
                &[
                    ("saveId", complete["saveId"].as_str().unwrap()),
                    ("receiptVersion", saved["receiptVersion"].as_str().unwrap())
                ]
            )
            .await
            .bytes()
            .await
            .unwrap()
            .as_ref(),
            b"abc"
        );
        let pending_path = f.root.join(".zicode/outputs").join(&pending_id);
        assert!(pending_path.join(".receipt.pending").is_file());
        assert!(!pending_path.join("result.bin").exists());
        host.state
            .plugins
            .lock()
            .unwrap()
            .set_permission(
                "programming",
                "com.zicode.artifacts",
                "storage.plugin",
                false,
            )
            .unwrap();
        assert_eq!(
            get(&host, &client, "ws-library", "save-attempts", &[])
                .await
                .status(),
            StatusCode::CONFLICT
        );
        host.stop_and_wait().await.unwrap();
    }
}
async fn get(
    host: &HostServer,
    client: &reqwest::Client,
    workspace: &str,
    route: &str,
    extra: &[(&str, &str)],
) -> reqwest::Response {
    client
        .get(format!("{}/v2/plugin-resources/{route}", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .query(&[
            ("schemaVersion", "1"),
            ("sceneId", "programming"),
            ("workspaceId", workspace),
        ])
        .query(extra)
        .send()
        .await
        .unwrap()
}
pub(in crate::host_server::plugin_resources) async fn verify(
    host: &HostServer,
    root: &std::path::Path,
    target: &RuntimeTarget,
) -> Value {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let ws = &target.workspace_id;
    let page = get(host, &client, ws, "saved-outputs", &[])
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["skippedEntries"], 3);
    assert_eq!(page["payloadsRead"], false);
    let attempts = get(host, &client, ws, "save-attempts", &[])
        .await
        .json::<Value>()
        .await
        .unwrap();
    assert_eq!(attempts["profile"], "resource.save.recovery.draft1");
    assert_eq!(attempts["total"], 4);
    assert_eq!(
        attempts["items"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|r| r["publication"] == "not_observed")
            .count(),
        2
    );
    assert_eq!(attempts["payloadsRead"], false);
    assert_eq!(
        client
            .get(format!(
                "{}/v2/plugin-resources/save-attempts",
                host.origin()
            ))
            .bearer_auth("fixture-resource-credential")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let row = &page["items"][0];
    let receipt = &row["receipt"];
    let id = receipt["saveId"].as_str().unwrap();
    let version = row["receiptVersion"].as_str().unwrap();
    let query = [("saveId", id), ("receiptVersion", version)];
    let read = get(host, &client, ws, "saved-output", &query).await;
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(read.headers()["content-type"], "application/octet-stream");
    assert_eq!(read.headers()["x-content-type-options"], "nosniff");
    assert!(read.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .contains("attachment"));
    assert_eq!(read.bytes().await.unwrap().as_ref(), b"independent");
    assert_eq!(
        client
            .get(format!(
                "{}/v2/plugin-resources/saved-outputs",
                host.origin()
            ))
            .bearer_auth("fixture-resource-credential")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert!(!get(
        host,
        &client,
        ws,
        "saved-output",
        &[
            ("saveId", id),
            ("receiptVersion", version),
            ("path", "../private")
        ]
    )
    .await
    .status()
    .is_success());
    let foreign = root.join("library-other");
    fs::create_dir(&foreign).unwrap();
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert("library-other".into(), foreign.clone());
    assert_eq!(
        get(host, &client, "library-other", "saved-outputs", &[])
            .await
            .json::<Value>()
            .await
            .unwrap()["total"],
        0
    );
    assert!(!get(host, &client, "library-other", "saved-output", &query)
        .await
        .status()
        .is_success());
    assert!(!foreign.join(".zicode").exists());
    // This is persistent user-approved data, independent of the original ephemeral resource lease.
    let source = json!({"schemaVersion":1,"owner":{"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":receipt["source"]["pluginId"],"capabilityId":receipt["source"]["capabilityId"]},"resourceId":receipt["source"]["resourceId"],"contentVersion":receipt["contentVersion"]});
    assert!(
        super::super::super::transfer::tests::post(host, &client, "revoke", source)
            .await
            .status()
            .is_success()
    );
    assert_eq!(
        get(host, &client, ws, "saved-output", &query)
            .await
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        b"independent"
    );
    let workspace = root.join("save-workspace");
    let file = workspace.join(receipt["relativePath"].as_str().unwrap());
    fs::write(&file, b"changed!!!!").unwrap();
    assert_eq!(
        get(host, &client, ws, "saved-outputs", &[])
            .await
            .json::<Value>()
            .await
            .unwrap()["items"][0]["integrity"],
        "not_checked"
    );
    assert_eq!(
        get(host, &client, ws, "saved-output", &query)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "saved_output_changed"
    );
    assert_eq!(fs::read(&file).unwrap(), b"changed!!!!");
    fs::write(&file, b"independent").unwrap();
    let metadata = file.parent().unwrap().join("receipt.json");
    let original = fs::read(&metadata).unwrap();
    let mut changed = receipt.clone();
    changed["source"]["packageVersion"] = json!("0.2.0");
    fs::write(&metadata, serde_json::to_vec(&changed).unwrap()).unwrap();
    assert_eq!(
        get(host, &client, ws, "saved-output", &query)
            .await
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "saved_output_changed"
    );
    fs::write(&metadata, original).unwrap();
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.zicode.artifacts",
            "storage.plugin",
            false,
        )
        .unwrap();
    assert!(!get(host, &client, ws, "saved-outputs", &[])
        .await
        .status()
        .is_success());
    assert!(!get(host, &client, ws, "saved-output", &query)
        .await
        .status()
        .is_success());
    assert!(!get(host, &client, ws, "save-attempts", &[])
        .await
        .status()
        .is_success());
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.artifacts",
                "storage.plugin",
                true,
            )
            .unwrap();
        registry
            .set_enabled("programming", "com.zicode.artifacts", true)
            .unwrap();
    }
    assert_eq!(
        get(host, &client, ws, "saved-output", &query)
            .await
            .bytes()
            .await
            .unwrap()
            .as_ref(),
        b"independent"
    );
    json!({"passed":true,"metadataOnlyList":true,"skipsEditedLengthRecord":true,"rawSnapshotRead":true,"sourceRevocationDoesNotDeleteApprovedCopy":true,
        "sameLengthEditRejectedAndPreserved":true,"receiptReplacementRejected":true,"workspaceIsolation":true,"brokerAndPathOverrideDenied":true,
        "currentStoragePermissionRequired":true,"recoveryAfterPermissionRestored":true,"noDuplicatePayloadIndex":true,"backupIncluded":false,"nativeUi":false})
}

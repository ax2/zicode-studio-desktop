use super::*;
use super::super::super::transfer::tests::{material, post};

pub(in crate::host_server::plugin_resources) async fn verify(host: &HostServer, root: &std::path::Path, target: &RuntimeTarget) -> Value {
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let workspace = root.join("save-workspace"); fs::create_dir(&workspace).unwrap();
    host.state.data.workspace_roots().write().unwrap().insert(target.workspace_id.clone(), workspace.clone());
    let plugin = "com.zicode.studio.transfer-source";
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":plugin,"capabilityId":"resource.inspect"});
    let bytes = vec![173; 300000];
    let input = material(host, &client, &owner, &bytes).await;
    // The file to save is a real production Worker's derived output, not an injected JSON string.
    let output = post(host, &client, "invoke-view", json!({"access":input,"toolCallId":uuid::Uuid::new_v4(),"input":{}})).await.json::<Value>().await.unwrap();
    assert_eq!(output["resources"][0]["byteLength"], bytes.len());
    let source = json!({"schemaVersion":1,"owner":owner,"resourceId":output["resources"][0]["resourceId"],"contentVersion":sha256_hex(&bytes)});
    let prepare = json!({"schemaVersion":1,"source":source});
    let prepared = post(host, &client, "prepare-save", prepare.clone()).await;
    assert_eq!(prepared.status(), StatusCode::OK);
    let prepared = prepared.json::<Value>().await.unwrap();
    assert_eq!(prepared["requiresConfirmation"], true);
    assert!(!workspace.join(".zicode").exists());
    let commit = json!({"schemaVersion":1,"source":source,"grantId":prepared["grantId"],"confirmed":true});
    assert_eq!(client.post(format!("{}/v2/plugin-resources/commit-save",host.origin())).bearer_auth("fixture-resource-credential").json(&commit).send().await.unwrap().status(), StatusCode::FORBIDDEN);
    let mut unconfirmed = commit.clone(); unconfirmed["confirmed"] = json!(false);
    assert_eq!(post(host,&client,"commit-save",unconfirmed).await.json::<Value>().await.unwrap()["error"]["code"], "resource_confirmation_required");
    let mut override_path = commit.clone(); override_path["path"] = json!("../forbidden");
    assert!(!post(host,&client,"commit-save",override_path).await.status().is_success());
    assert!(!workspace.join(".zicode").exists());
    let saved = post(host,&client,"commit-save",commit.clone()).await;
    assert_eq!(saved.status(), StatusCode::OK);
    let saved = saved.json::<Value>().await.unwrap();
    assert_eq!(saved["replayed"], false);
    let path = workspace.join(saved["receipt"]["relativePath"].as_str().unwrap());
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let metadata = fs::read(path.parent().unwrap().join("receipt.json")).unwrap();
    assert!(!String::from_utf8_lossy(&metadata).contains("credential"));
    assert_eq!(post(host,&client,"commit-save",commit.clone()).await.json::<Value>().await.unwrap()["replayed"], true);
    assert_eq!(fs::read_dir(workspace.join(".zicode/outputs")).unwrap().count(), 1);
    // Check file conflicts while this saved grant still has its original authority.
    fs::write(&path, b"user edit preserved").unwrap();
    assert_eq!(post(host,&client,"commit-save",commit).await.json::<Value>().await.unwrap()["error"]["code"], "resource_save_conflict");
    assert_eq!(fs::read(&path).unwrap(), b"user edit preserved");
    for cause in ["source", "storage"] {
        let fresh = material(host,&client,&owner,b"publication boundary").await;
        let pending = post(host,&client,"prepare-save",json!({"schemaVersion":1,"source":fresh})).await.json::<Value>().await.unwrap();
        let id = pending["grantId"].as_str().unwrap().to_string();
        let (reached, resume) = super::publication::gate(&target.instance_id);
        let request = client.post(format!("{}/v2/plugin-resources/commit-save",host.origin())).header("x-zicode-desktop-token",host.desktop_token())
            .json(&json!({"schemaVersion":1,"source":fresh,"grantId":id,"confirmed":true}));
        let saving = tokio::spawn(async move { request.send().await.unwrap() });
        tokio::task::spawn_blocking(move || reached.recv_timeout(Duration::from_secs(10)).unwrap()).await.unwrap();
        let path = workspace.join(".zicode/outputs").join(&id);
        assert_eq!(fs::read(path.join("result.bin")).unwrap(), b"publication boundary");
        assert!(!path.join("receipt.json").exists());
        assert!(host.state.plugin_resources.try_lock().is_ok());
        if cause == "source" { assert!(post(host,&client,"revoke",fresh).await.status().is_success()); }
        else {
            let mut registry = host.state.plugins.lock().unwrap();
            registry.set_permission("programming","com.zicode.artifacts","storage.plugin",false).unwrap();
            registry.set_permission("programming","com.zicode.artifacts","storage.plugin",true).unwrap();
            registry.set_enabled("programming","com.zicode.artifacts",true).unwrap();
        }
        resume.send(()).unwrap(); assert!(!saving.await.unwrap().status().is_success());
        assert!(path.join(".receipt.pending").is_file(), "retain the confirmed attempt for read-only recovery");
        assert!(!path.join("result.bin").exists(), "unpublished payload must be cleaned after authorization changed");
        assert!(!path.join("receipt.json").exists());
    }
    let pending = post(host,&client,"prepare-save",prepare.clone()).await.json::<Value>().await.unwrap();
    let pending_commit = json!({"schemaVersion":1,"source":source,"grantId":pending["grantId"],"confirmed":true});
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", false).unwrap();
        registry.set_permission("programming", "com.zicode.artifacts", "storage.plugin", true).unwrap();
        registry.set_enabled("programming", "com.zicode.artifacts", true).unwrap();
    }
    assert_eq!(post(host,&client,"commit-save",pending_commit).await.json::<Value>().await.unwrap()["error"]["code"], "resource_authorization_changed");
    let pending = post(host,&client,"prepare-save",prepare.clone()).await.json::<Value>().await.unwrap();
    let pending_commit = json!({"schemaVersion":1,"source":source,"grantId":pending["grantId"],"confirmed":true});
    let other = root.join("save-other-workspace"); fs::create_dir(&other).unwrap();
    host.state.data.workspace_roots().write().unwrap().insert(target.workspace_id.clone(), other.clone());
    assert_eq!(post(host,&client,"commit-save",pending_commit).await.json::<Value>().await.unwrap()["error"]["code"], "resource_authorization_changed");
    assert!(!other.join(".zicode").exists());
    host.state.data.workspace_roots().write().unwrap().insert(target.workspace_id.clone(), workspace.clone());
    let pending = post(host,&client,"prepare-save",prepare.clone()).await.json::<Value>().await.unwrap();
    let pending_commit = json!({"schemaVersion":1,"source":source,"grantId":pending["grantId"],"confirmed":true});
    assert!(post(host,&client,"revoke",input).await.status().is_success());
    assert!(!post(host,&client,"commit-save",pending_commit).await.status().is_success());
    assert_eq!(fs::read_dir(workspace.join(".zicode/outputs")).unwrap().count(), 3);
    assert_eq!(fs::read_dir(workspace.join(".zicode/outputs")).unwrap().filter(|entry|
        entry.as_ref().unwrap().path().join(".receipt.pending").is_file()).count(),2);
    // A new independent resource still exports successfully after the denied ancestor chain.
    let fresh = material(host,&client,&owner,b"independent").await;
    let pending = post(host,&client,"prepare-save",json!({"schemaVersion":1,"source":fresh})).await.json::<Value>().await.unwrap();
    let saved = post(host,&client,"commit-save",json!({"schemaVersion":1,"source":fresh,"grantId":pending["grantId"],"confirmed":true})).await.json::<Value>().await.unwrap();
    assert_eq!(saved["saved"], true);
    assert_eq!(fs::read(workspace.join(saved["receipt"]["relativePath"].as_str().unwrap())).unwrap(), b"independent");
    json!({"passed":true,"resourceBytes":300000,"productionWorkerOutputSavedRaw":true,"prepareAndUnconfirmedWriteFree":true,
        "brokerAndPathOverrideDenied":true,"replayedWithoutNewFiles":true,"modifiedFilePreservedAndReplayRejected":true,
        "storageRevokeRegrantRejected":true,"destinationChangeRejected":true,"ancestorRevokeRejected":true,"independentResourceSaved":true,
        "persistedDirectories":4,"publishedSnapshots":2,"recoveryOnlyDirectories":2,"preparedBytesBeforePublicationRevokeCases":2,"preparedBytesCleanedAfterRevoke":true,
        "storeLockAvailableDuringStaging":true,"savedArtifactsIndexed":false,"nativeUi":false})
}

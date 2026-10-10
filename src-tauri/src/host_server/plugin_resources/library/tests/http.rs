use super::*;
async fn get(host: &HostServer, client: &reqwest::Client, workspace: &str, route: &str, extra: &[(&str,&str)]) -> reqwest::Response {
    client.get(format!("{}/v2/plugin-resources/{route}",host.origin())).header("x-zicode-desktop-token",host.desktop_token())
        .query(&[("schemaVersion","1"),("sceneId","programming"),("workspaceId",workspace)]).query(extra).send().await.unwrap()
}
pub(in crate::host_server::plugin_resources) async fn verify(host: &HostServer, root: &std::path::Path, target: &RuntimeTarget) -> Value {
    let client=reqwest::Client::builder().no_proxy().build().unwrap(); let ws=&target.workspace_id;
    let page=get(host,&client,ws,"saved-outputs",&[]).await.json::<Value>().await.unwrap();
    assert_eq!(page["total"],1); assert_eq!(page["skippedEntries"],1); assert_eq!(page["payloadsRead"],false);
    let row=&page["items"][0];let receipt=&row["receipt"]; let id=receipt["saveId"].as_str().unwrap();let version=row["receiptVersion"].as_str().unwrap();
    let query=[("saveId",id),("receiptVersion",version)];
    let read=get(host,&client,ws,"saved-output",&query).await;
    assert_eq!(read.status(),StatusCode::OK); assert_eq!(read.headers()["content-type"],"application/octet-stream");
    assert_eq!(read.headers()["x-content-type-options"],"nosniff"); assert!(read.headers()["content-disposition"].to_str().unwrap().contains("attachment"));
    assert_eq!(read.bytes().await.unwrap().as_ref(),b"independent");
    assert_eq!(client.get(format!("{}/v2/plugin-resources/saved-outputs",host.origin())).bearer_auth("fixture-resource-credential").send().await.unwrap().status(),StatusCode::FORBIDDEN);
    assert!(!get(host,&client,ws,"saved-output",&[("saveId",id),("receiptVersion",version),("path","../private")]).await.status().is_success());
    let foreign=root.join("library-other");fs::create_dir(&foreign).unwrap();host.state.data.workspace_roots().write().unwrap().insert("library-other".into(),foreign.clone());
    assert_eq!(get(host,&client,"library-other","saved-outputs",&[]).await.json::<Value>().await.unwrap()["total"],0);
    assert!(!get(host,&client,"library-other","saved-output",&query).await.status().is_success()); assert!(!foreign.join(".zicode").exists());
    // This is persistent user-approved data, independent of the original ephemeral resource lease.
    let source=json!({"schemaVersion":1,"owner":{"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":receipt["source"]["pluginId"],"capabilityId":receipt["source"]["capabilityId"]},"resourceId":receipt["source"]["resourceId"],"contentVersion":receipt["contentVersion"]});
    assert!(super::super::super::transfer::tests::post(host,&client,"revoke",source).await.status().is_success());
    assert_eq!(get(host,&client,ws,"saved-output",&query).await.bytes().await.unwrap().as_ref(),b"independent");
    let workspace=root.join("save-workspace");let file=workspace.join(receipt["relativePath"].as_str().unwrap());
    fs::write(&file,b"changed!!!!").unwrap();
    assert_eq!(get(host,&client,ws,"saved-outputs",&[]).await.json::<Value>().await.unwrap()["items"][0]["integrity"],"not_checked");
    assert_eq!(get(host,&client,ws,"saved-output",&query).await.json::<Value>().await.unwrap()["error"]["code"],"saved_output_changed");
    assert_eq!(fs::read(&file).unwrap(),b"changed!!!!");fs::write(&file,b"independent").unwrap();
    let metadata=file.parent().unwrap().join("receipt.json");let original=fs::read(&metadata).unwrap();
    let mut changed=receipt.clone();changed["source"]["packageVersion"]=json!("0.2.0");fs::write(&metadata,serde_json::to_vec(&changed).unwrap()).unwrap();
    assert_eq!(get(host,&client,ws,"saved-output",&query).await.json::<Value>().await.unwrap()["error"]["code"],"saved_output_changed");fs::write(&metadata,original).unwrap();
    host.state.plugins.lock().unwrap().set_permission("programming","com.zicode.artifacts","storage.plugin",false).unwrap();
    assert!(!get(host,&client,ws,"saved-outputs",&[]).await.status().is_success()); assert!(!get(host,&client,ws,"saved-output",&query).await.status().is_success());
    {let mut registry=host.state.plugins.lock().unwrap();registry.set_permission("programming","com.zicode.artifacts","storage.plugin",true).unwrap();registry.set_enabled("programming","com.zicode.artifacts",true).unwrap();}
    assert_eq!(get(host,&client,ws,"saved-output",&query).await.bytes().await.unwrap().as_ref(),b"independent");
    json!({"passed":true,"metadataOnlyList":true,"skipsEditedLengthRecord":true,"rawSnapshotRead":true,"sourceRevocationDoesNotDeleteApprovedCopy":true,
        "sameLengthEditRejectedAndPreserved":true,"receiptReplacementRejected":true,"workspaceIsolation":true,"brokerAndPathOverrideDenied":true,
        "currentStoragePermissionRequired":true,"recoveryAfterPermissionRestored":true,"noDuplicatePayloadIndex":true,"backupIncluded":false,"nativeUi":false})
}

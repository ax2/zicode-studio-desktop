use super::*;
use crate::metadata_store::MetadataStore;
use std::{fs, path::Path};

async fn start(root: &Path) -> HostServer {
    let public = root.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(
        public.join("index.html"),
        "Synthetic browser artifact acceptance",
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap()
}

#[tokio::test]
async fn browser_analysis_artifact_survives_host_restart_with_provenance_and_workspace_scope() {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("browser-artifact-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("owner.json"), r#"{"purpose":"Studio #16 synthetic browser analysis Artifact HTTP persistence","removeOnSuccess":true}"#).unwrap();
    // The frontend builder is checked against this same synthetic contract.
    let draft: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/browser-analysis-artifact.json"
    ))
    .unwrap();
    let workspace = "11111111-1111-4111-8111-111111111111";
    let other_workspace = "33333333-3333-4333-8333-333333333333";
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let host = start(&root).await;
    let mut request = draft.clone();
    request["workspaceId"] = json!(workspace);
    request["sceneId"] = json!("programming");
    let created = client
        .post(format!("{}/v2/artifacts/create", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(created.status(), StatusCode::OK);
    let saved: Value = created.json().await.unwrap();
    let artifact_id = saved["artifact"]["id"].as_str().unwrap().to_string();
    assert_eq!(saved["artifact"]["content"], draft["content"]);
    assert_eq!(saved["artifact"]["provenance"], draft["provenance"]);
    assert_eq!(
        saved["artifact"]["handle"],
        format!("artifact:{artifact_id}")
    );
    host.stop_and_wait().await.unwrap();

    let host = start(&root).await;
    let listed = client
        .get(format!(
            "{}/v2/artifacts?sceneId=programming&workspaceId={workspace}&query=Synthetic",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap();
    assert_eq!(listed.status(), StatusCode::OK);
    let list: Value = listed.json().await.unwrap();
    assert_eq!(list["snapshot"]["artifacts"].as_array().unwrap().len(), 1);
    assert_eq!(list["snapshot"]["artifacts"][0]["id"], artifact_id);
    let read_url = format!(
        "{}/v2/artifacts/item?sceneId=programming&workspaceId={workspace}&artifactId={artifact_id}",
        host.origin()
    );
    let read = client
        .get(&read_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    let reopened: Value = read.json().await.unwrap();
    assert_eq!(reopened["artifact"], saved["artifact"]);
    assert_eq!(reopened["artifact"]["mimeType"], "text/plain");

    let foreign = client.get(format!("{}/v2/artifacts/item?sceneId=programming&workspaceId={other_workspace}&artifactId={artifact_id}", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token()).send().await.unwrap();
    assert_eq!(foreign.status(), StatusCode::NOT_FOUND);

    let import_url = format!("{}/v2/artifacts/import-all", host.origin());
    let wrong_method = client.get(&import_url).send().await.unwrap();
    assert_eq!(wrong_method.status(), StatusCode::METHOD_NOT_ALLOWED);

    let backup = json!({
        "workspaceId": other_workspace,
        "sceneId": "programming",
        "artifacts": [saved["artifact"]]
    });
    let forbidden_origin = client
        .post(&import_url)
        .header("origin", "https://synthetic-origin.invalid")
        .json(&backup)
        .send()
        .await
        .unwrap();
    assert_eq!(forbidden_origin.status(), StatusCode::UNAUTHORIZED);
    let auth_error: Value = forbidden_origin.json().await.unwrap();
    assert_eq!(auth_error["error"]["code"], "device_auth_required");

    // Exercise the existing bulk-restore limit on the actual production router.
    let mut backup_body = serde_json::to_string(&backup).unwrap();
    backup_body.push_str(&" ".repeat(MAX_HTTP_BODY_BYTES));
    let imported = client
        .post(&import_url)
        .header("content-type", "application/json")
        .header("x-zicode-desktop-token", host.desktop_token())
        .body(backup_body)
        .send()
        .await
        .unwrap();
    assert_eq!(imported.status(), StatusCode::OK);
    let import_result: Value = imported.json().await.unwrap();
    assert_eq!(import_result, json!({"imported": 1}));

    let restored_url = format!(
        "{}/v2/artifacts/item?sceneId=programming&workspaceId={other_workspace}&artifactId={artifact_id}",
        host.origin()
    );
    let restored = client
        .get(restored_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap();
    assert_eq!(restored.status(), StatusCode::OK);
    let restored: Value = restored.json().await.unwrap();
    assert_eq!(restored["artifact"]["workspaceId"], other_workspace);
    assert_eq!(restored["artifact"]["content"], draft["content"]);

    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.artifacts", false)
        .unwrap();
    let denied = client
        .get(&read_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), StatusCode::FORBIDDEN);
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

use super::*;
use crate::{
    metadata_store::MetadataStore,
    notes_sync::{tests::Server, SyncKey},
};

async fn fixture() -> (PathBuf, HostServer, String) {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch/notes-sync-entry")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(root.join("public")).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let workspace = uuid::Uuid::new_v4().to_string();
    let system = root.join("system");
    std::fs::create_dir_all(&system).unwrap();
    let roots = HashMap::from([(workspace.clone(), system.clone())]);
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(8),
        auth,
        roots,
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let storage = host
        .notes_vault()
        .unwrap()
        .with_workspace_registry(host.state.data.workspace_roots(), system);
    *host.state.notes.lock().unwrap() = storage;
    (root, host, workspace)
}
async fn completed(host: &HostServer, workspace: &str) -> Status {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let status = host.state.notes_sync_runs.status(workspace).unwrap();
            if !status.running {
                return status;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("local fixture finishes within existing five-second budget")
}
async fn dispose(root: PathBuf, host: HostServer) {
    host.stop_and_wait().await.unwrap();
    let boundary = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch/notes-sync-entry")
        .canonicalize()
        .unwrap();
    let resolved = root.canonicalize().unwrap();
    assert_eq!(resolved.parent(), Some(boundary.as_path()));
    std::fs::remove_dir_all(resolved).unwrap();
}

#[tokio::test]
async fn manual_host_job_transfers_real_saved_notes_to_fresh_local_vault_without_exposing_content_in_status(
) {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let (root, host, workspace) = fixture().await;
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let book: Value = client
        .post(format!("{}/v2/notes/notebooks", host.origin()))
        .json(&json!({
            "workspaceId": workspace, "sceneId":"programming", "title":"Synthetic sync notebook"
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let book_id = book["notebook"]["id"].as_str().unwrap();
    let body = "  synthetic saved note / 合成笔记\n\nretain trailing spaces  \n";
    let note: Value = client
        .post(format!("{}/v2/notes/create", host.origin()))
        .json(&json!({
            "workspaceId": workspace, "sceneId":"programming", "notebookId":book_id,
            "title":"synthetic title", "content":body, "tags":["sync-fixture"]
        }))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let note_id = note["note"]["id"].as_str().unwrap();
    let started = host
        .launch_notes_sync(&workspace, "programming", server.configured(key).unwrap())
        .unwrap();
    assert!(started.run_id.is_some());
    assert_eq!(completed(&host, &workspace).await.state, "synced");
    assert!(server.index().unwrap().starts_with(b"ZNS1"));
    let serialized =
        serde_json::to_string(&host.state.notes_sync_runs.status(&workspace).unwrap()).unwrap();
    assert!(!serialized.contains(body));
    assert!(!serialized.contains(&recovery));
    assert!(!serialized.contains("fixture-password"));

    let (other_root, other, other_workspace) = fixture().await;
    other
        .launch_notes_sync(
            &other_workspace,
            "programming",
            server
                .configured(SyncKey::from_recovery(&recovery).unwrap())
                .unwrap(),
        )
        .unwrap();
    assert_eq!(completed(&other, &other_workspace).await.state, "synced");
    let fetched: Value = client
        .get(format!("{}/v2/notes/note", other.origin()))
        .query(&[
            ("workspaceId", other_workspace.as_str()),
            ("sceneId", "programming"),
            ("notebookId", book_id),
            ("noteId", note_id),
        ])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(fetched["note"]["content"], body);
    assert_eq!(fetched["note"]["title"], "synthetic title");
    dispose(other_root, other).await;
    dispose(root, host).await;
}

#[tokio::test]
async fn explicit_cancel_duplicate_start_permission_and_shutdown_preserve_the_real_queue() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let (root, host, workspace) = fixture().await;
    // No confirmation: no resolver or network activity.
    assert!(host
        .notes_sync_task(
            Request::Start {
                workspace_id: workspace.clone(),
                scene_id: "programming".into(),
                revision: uuid::Uuid::new_v4().to_string(),
                confirmed: false
            },
            root.clone(),
            Some("fixture".into()),
            true
        )
        .await
        .is_err());
    assert_eq!(server.request_count(), 0);
    let observed = Arc::new(tokio::sync::Notify::new());
    server.hold_index_read(observed.clone());
    let started = host
        .launch_notes_sync(&workspace, "programming", server.configured(key).unwrap())
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), observed.notified())
        .await
        .unwrap();
    assert!(host
        .launch_notes_sync(
            &workspace,
            "programming",
            server
                .configured(SyncKey::from_recovery(&recovery).unwrap())
                .unwrap()
        )
        .is_err());
    assert!(host
        .state
        .notes_sync_runs
        .cancel(&workspace, "stale-run")
        .is_err());
    host.state
        .notes_sync_runs
        .cancel(&workspace, started.run_id.as_deref().unwrap())
        .unwrap();
    assert_eq!(completed(&host, &workspace).await.state, "cancelled");
    assert!(server.index().is_none());
    server.release_index_read();
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", "com.zicode.notes", "storage.plugin", false)
        .unwrap();
    let before = server.request_count();
    assert!(host
        .launch_notes_sync(
            &workspace,
            "programming",
            server
                .configured(SyncKey::from_recovery(&recovery).unwrap())
                .unwrap()
        )
        .is_err());
    assert_eq!(server.request_count(), before);
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", "com.zicode.notes", "storage.plugin", true)
        .unwrap();
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.notes", true)
        .unwrap();
    let observed = Arc::new(tokio::sync::Notify::new());
    server.hold_index_read(observed.clone());
    host.launch_notes_sync(
        &workspace,
        "programming",
        server
            .configured(SyncKey::from_recovery(&recovery).unwrap())
            .unwrap(),
    )
    .unwrap();
    tokio::time::timeout(Duration::from_secs(5), observed.notified())
        .await
        .unwrap();
    let weak = Arc::downgrade(&host.state);
    host.request_shutdown();
    assert_eq!(completed(&host, &workspace).await.state, "cancelled");
    server.release_index_read();
    dispose(root, host).await;
    assert!(
        weak.upgrade().is_none(),
        "sync job must not retain Host state past shutdown"
    );
}

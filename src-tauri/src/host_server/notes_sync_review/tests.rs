use super::*;
use crate::{
    metadata_store::MetadataStore,
    notes_sync::{tests::Server, SyncKey},
    notes_sync_task::{ReviewContext, Status},
};
use std::fs;

struct App {
    root: PathBuf,
    host: HostServer,
    workspace: String,
    revision: String,
}
impl App {
    async fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/notes-conflicts-24")
            .join(uuid::Uuid::new_v4().to_string());
        let system = root.join("system");
        fs::create_dir_all(root.join("public")).unwrap();
        fs::create_dir_all(&system).unwrap();
        let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        let workspace = uuid::Uuid::new_v4().to_string();
        let host = HostServer::start_with_mode(
            root.join("public"),
            NativePiManager::new(8),
            auth,
            HashMap::from([(workspace.clone(), system.clone())]),
            HostMode::IsolatedDesktop,
        )
        .await
        .unwrap();
        let storage = host
            .notes_vault()
            .unwrap()
            .with_workspace_registry(host.state.data.workspace_roots(), system);
        *host.state.notes.lock().unwrap() = storage;
        Self {
            root,
            host,
            workspace,
            revision: uuid::Uuid::new_v4().to_string(),
        }
    }
    async fn post(&self, path: &str, value: Value) -> Value {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("{}{}", self.host.origin(), path))
            .json(&value)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap()
    }
    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Value {
        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("{}{}", self.host.origin(), path))
            .query(query)
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap()
    }
    async fn note(&self, book: &str, note: &str) -> Value {
        self.get(
            "/v2/notes/note",
            &[
                ("workspaceId", &self.workspace),
                ("sceneId", "programming"),
                ("notebookId", book),
                ("noteId", note),
            ],
        )
        .await["note"]
            .clone()
    }
    async fn edit(&self, book: &str, note: &str, title: &str, body: &str) {
        let current = self.note(book, note).await;
        self.post("/v2/notes/save",json!({"workspaceId":self.workspace,"sceneId":"programming","notebookId":book,"noteId":note,
            "title":title,"content":body,"tags":[],"expectedVersion":current["version"]})).await;
    }
    async fn sync(&self, repository: crate::notes_sync::SyncRepository) -> Status {
        self.host
            .launch_notes_sync_with_context(
                &self.workspace,
                "programming",
                repository,
                Some(ReviewContext {
                    scene: "programming".into(),
                    revision: self.revision.clone(),
                }),
            )
            .unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                let status = self
                    .host
                    .state
                    .notes_sync_runs
                    .status(&self.workspace)
                    .unwrap();
                if !status.running {
                    return status;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap()
    }
    fn request(&self, kind: &str, run: &str) -> Value {
        json!({"kind":kind,"workspaceId":self.workspace,"sceneId":"programming","runId":run,"revision":self.revision})
    }
    async fn close(self) {
        self.host.stop_and_wait().await.unwrap();
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/notes-conflicts-24")
            .canonicalize()
            .unwrap();
        let resolved = self.root.canonicalize().unwrap();
        assert_eq!(resolved.parent(), Some(base.as_path()));
        fs::remove_dir_all(resolved).unwrap();
    }
}

#[tokio::test]
async fn real_host_review_applies_explicit_both_locally_and_rejects_stale_duplicate_and_unauthorized_actions(
) {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let local = App::new().await;
    let cloud = App::new().await;
    let book=local.post("/v2/notes/notebooks",json!({"workspaceId":local.workspace,"sceneId":"programming","title":"Synthetic shared notebook"})).await["notebook"]["id"].as_str().unwrap().to_owned();
    let note=local.post("/v2/notes/create",json!({"workspaceId":local.workspace,"sceneId":"programming","notebookId":book,"title":"base","content":"base body","tags":[]})).await["note"]["id"].as_str().unwrap().to_owned();
    assert_eq!(
        local.sync(server.configured(key).unwrap()).await.state,
        "synced"
    );
    assert_eq!(
        cloud
            .sync(
                server
                    .configured(SyncKey::from_recovery(&recovery).unwrap())
                    .unwrap()
            )
            .await
            .state,
        "synced"
    );
    local
        .edit(&book, &note, "Local version", "  local body\n\n")
        .await;
    cloud
        .edit(
            &book,
            &note,
            "Cloud version",
            "cloud <script>not executable</script>\n",
        )
        .await;
    assert_eq!(
        cloud
            .sync(
                server
                    .configured(SyncKey::from_recovery(&recovery).unwrap())
                    .unwrap()
            )
            .await
            .state,
        "synced"
    );
    let status = local
        .sync(
            server
                .configured(SyncKey::from_recovery(&recovery).unwrap())
                .unwrap(),
        )
        .await;
    assert_eq!(status.state, "conflicts");
    assert!(status.conflicts_available);
    let run = status.run_id.unwrap();
    let repository = || {
        server
            .configured(SyncKey::from_recovery(&recovery).unwrap())
            .unwrap()
    };
    let before = server.request_count();
    let mut list = local.request("list", &run);
    list["cursor"] = json!(0);
    let listed = local
        .host
        .review_conflicts(serde_json::from_value(list.clone()).unwrap(), repository())
        .await
        .unwrap();
    assert_eq!(listed["total"], 1);
    let id = listed["rows"][0]["id"].as_str().unwrap();
    let mut detail = local.request("detail", &run);
    detail["id"] = json!(id);
    let compared = local
        .host
        .review_conflicts(serde_json::from_value(detail).unwrap(), repository())
        .await
        .unwrap();
    assert_eq!(compared["item"]["local"]["text"], "  local body\n\n");
    assert_eq!(
        compared["item"]["remote"]["text"],
        "cloud <script>not executable</script>\n"
    );
    let mut apply = local.request("apply", &run);
    apply["confirmed"] = json!(false);
    apply["locale"] = json!("en");
    apply["choices"] = json!([{"id":id,"choice":"both"}]);
    assert_eq!(
        local
            .host
            .review_conflicts(serde_json::from_value(apply.clone()).unwrap(), repository())
            .await
            .unwrap_err(),
        "notes_sync_confirmation_required"
    );
    apply["confirmed"] = json!(true);
    let mut duplicate = apply.clone();
    duplicate["choices"] = json!([{"id":id,"choice":"both"},{"id":id,"choice":"both"}]);
    assert_eq!(
        local
            .host
            .review_conflicts(serde_json::from_value(duplicate).unwrap(), repository())
            .await
            .unwrap_err(),
        "notes_sync_review_invalid"
    );
    let mut stale = apply.clone();
    stale["revision"] = json!("stale-revision");
    assert_eq!(
        local
            .host
            .review_conflicts(serde_json::from_value(stale).unwrap(), repository())
            .await
            .unwrap_err(),
        "notes_sync_review_changed"
    );
    {
        let lease = local
            .host
            .state
            .notes_sync_runs
            .reserve_review(&local.workspace, &run, &local.revision, "programming")
            .unwrap();
        assert!(local
            .host
            .launch_notes_sync_with_context(
                &local.workspace,
                "programming",
                repository(),
                Some(ReviewContext {
                    scene: "programming".into(),
                    revision: local.revision.clone()
                })
            )
            .is_err());
        assert_eq!(
            local
                .host
                .review_conflicts(serde_json::from_value(list.clone()).unwrap(), repository())
                .await
                .unwrap_err(),
            "notes_sync_review_busy"
        );
        drop(lease);
    }
    local
        .host
        .state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", "com.zicode.notes", "storage.plugin", false)
        .unwrap();
    assert_eq!(
        local
            .host
            .review_conflicts(serde_json::from_value(list).unwrap(), repository())
            .await
            .unwrap_err(),
        "notes_sync_permission_denied"
    );
    local
        .host
        .state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", "com.zicode.notes", "storage.plugin", true)
        .unwrap();
    local
        .host
        .state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.notes", true)
        .unwrap();
    let result = local
        .host
        .review_conflicts(serde_json::from_value(apply.clone()).unwrap(), repository())
        .await
        .unwrap();
    assert_eq!(result["state"], "savedLocally");
    assert_eq!(result["copiedNotes"], 1);
    assert_eq!(result["pendingUpload"], true);
    assert_eq!(
        server.request_count(),
        before,
        "comparing and applying choices never uploads"
    );
    let after = local
        .host
        .state
        .notes_sync_runs
        .status(&local.workspace)
        .unwrap();
    assert_eq!(after.state, "resolvedLocally");
    assert!(!after.conflicts_available);
    let notebooks = local
        .get(
            "/v2/notes",
            &[
                ("workspaceId", &local.workspace),
                ("sceneId", "programming"),
            ],
        )
        .await;
    let books = notebooks["snapshot"]["notebooks"].as_array().unwrap();
    assert_eq!(books.len(), 2);
    let copy = books.iter().find(|item| item["id"] != book).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        local.note(&book, &note).await["content"],
        "  local body\n\n"
    );
    assert_eq!(
        local.note(&copy, &note).await["content"],
        "cloud <script>not executable</script>\n"
    );
    assert_eq!(
        local
            .host
            .review_conflicts(serde_json::from_value(apply).unwrap(), repository())
            .await
            .unwrap_err(),
        "notes_sync_review_changed"
    );
    assert_eq!(local.sync(repository()).await.state, "synced");
    assert!(server.request_count() > before);
    assert_eq!(cloud.sync(repository()).await.state, "synced");
    assert_eq!(
        cloud.note(&copy, &note).await["content"],
        "cloud <script>not executable</script>\n"
    );
    local.close().await;
    cloud.close().await;
}

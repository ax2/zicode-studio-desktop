use super::*;
use crate::metadata_store::MetadataStore;

#[tokio::test]
async fn creates_cited_local_notes_without_fetch_and_keeps_existing_notes() {
    let root = std::env::temp_dir().join(format!("browser-note-citation-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(public.join("index.html"), "Browser notes test").unwrap();
    std::fs::write(root.join("owner.txt"), "browser-note-citation-acceptance").unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth).await.unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let notebook: Value = client.post(format!("{}/v2/notes/notebooks",host.origin()))
        .json(&json!({"workspaceId":workspace,"sceneId":"programming","title":"Clippings"}))
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let book = notebook["notebook"]["id"].as_str().unwrap();
    let base = json!({"workspaceId":workspace,"sceneId":"programming","notebookId":book,"title":"Original note","content":"Keep exact original body"});
    let original: Value = client.post(format!("{}/v2/notes/create",host.origin())).json(&base)
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let mut cited = base.clone();
    cited["title"] = json!("Captured page"); cited["content"] = json!("Snapshot body\r\nSelected text");
    cited["source"] = json!({"url":"https://does-not-resolve.invalid/page?q=clip","capturedAt":"2026-11-09T03:30:00Z","documentRevision":"owned-document:2"});
    let saved: Value = client.post(format!("{}/v2/notes/create",host.origin())).json(&cited)
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(saved["note"]["source"]["documentRevision"],"owned-document:2");
    assert!(!saved["note"]["content"].as_str().unwrap().contains("owned-document:2"));
    assert_eq!(saved["note"]["source"]["url"],cited["source"]["url"]);
    assert_eq!(saved["note"]["source"]["capturedAt"],cited["source"]["capturedAt"]);
    assert_eq!(saved["note"]["source"]["contentHash"],content_hash(cited["content"].as_str().unwrap()));
    assert_eq!(saved["note"]["content"],"Snapshot body\nSelected text");
    for bad in [json!({"url":"file:///C:/secret","capturedAt":"2026-11-09T03:30:00Z"}),
        json!({"url":"https://example.org/","capturedAt":"bad"}),
        json!({"url":"https://user:password@example.org/","capturedAt":"2026-11-09T03:30:00Z"}),
        json!({"url":"https://example.org/","capturedAt":"2026-11-09T03:30:00Z","contentHash":"forged"})] {
        let mut invalid = cited.clone(); invalid["source"] = bad;
        assert!(client.post(format!("{}/v2/notes/create",host.origin())).json(&invalid).send().await.unwrap().status().is_client_error());
    }
    let mut invalid_revision = cited.clone(); invalid_revision["source"]["documentRevision"] = json!("x".repeat(161));
    assert!(client.post(format!("{}/v2/notes/create",host.origin())).json(&invalid_revision).send().await.unwrap().status().is_client_error());
    let source_only: Value = client.get(format!("{}/v2/notes",host.origin()))
        .query(&[("sceneId","programming"),("workspaceId",workspace),("sourceOnly","true")])
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(source_only["snapshot"]["notes"].as_array().unwrap().len(),1);
    assert_eq!(source_only["snapshot"]["notes"][0]["id"],saved["note"]["id"]);
    let existing: Value = client.get(format!("{}/v2/notes/note",host.origin()))
        .query(&[("sceneId","programming"),("workspaceId",workspace),("notebookId",book),("noteId",original["note"]["id"].as_str().unwrap())])
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(existing,original);
    let restored: Value = client.get(format!("{}/v2/notes/note",host.origin()))
        .query(&[("sceneId","programming"),("workspaceId",workspace),("notebookId",book),("noteId",saved["note"]["id"].as_str().unwrap())])
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(restored,saved);

    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/browser-analysis-note.json"))
            .unwrap();
    let mut analysis = fixture["draft"].clone();
    analysis["workspaceId"] = json!(workspace);
    analysis["sceneId"] = json!("programming");
    analysis["notebookId"] = json!(book);
    let created: Value = client
        .post(format!("{}/v2/notes/create", host.origin()))
        .json(&analysis)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    let document = &created["note"];
    assert_eq!(document["title"], analysis["title"]);
    assert_eq!(document["content"], analysis["content"]);
    let tags = document["tags"].as_array().unwrap();
    assert_eq!(tags.len(), 2);
    assert!(tags.contains(&json!("browser-analysis")));
    assert!(tags.contains(&json!("web-clip")));
    for field in ["url", "capturedAt", "documentRevision"] {
        assert_eq!(document["source"][field], analysis["source"][field]);
    }
    let analysis_id = document["id"].as_str().unwrap();
    let reopened: Value = client
        .get(format!("{}/v2/notes/note", host.origin()))
        .query(&[
            ("sceneId", "programming"),
            ("workspaceId", workspace),
            ("notebookId", book),
            ("noteId", analysis_id),
        ])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(reopened, created);
    let matching: Value = client
        .get(format!("{}/v2/notes", host.origin()))
        .query(&[
            ("sceneId", "programming"),
            ("workspaceId", workspace),
            ("sourceOnly", "true"),
            ("tag", "browser-analysis"),
        ])
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(matching["snapshot"]["notes"].as_array().unwrap().len(), 1);
    assert_eq!(matching["snapshot"]["notes"][0]["id"], analysis_id);

    host.stop_and_wait().await.unwrap();
}

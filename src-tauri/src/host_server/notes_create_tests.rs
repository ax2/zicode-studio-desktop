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
    let mut analysis_ids = Vec::new();
    for example in [&fixture, &fixture["image"]] {
        let mut analysis = example["draft"].clone();
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
        assert_eq!(document["source"]["contentHash"], content_hash(analysis["content"].as_str().unwrap()));
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
        analysis_ids.push(analysis_id.to_owned());
    }
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
    let notes = matching["snapshot"]["notes"].as_array().unwrap();
    assert_eq!(notes.len(), analysis_ids.len());
    for analysis_id in analysis_ids {
        assert!(notes.iter().any(|note| note["id"] == analysis_id));
    }

    host.stop_and_wait().await.unwrap();
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires the installed Windows English and Simplified Chinese recognizers and generated OCR fixture"]
async fn persists_reviewed_windows_ocr_text_in_an_isolated_notes_vault() {
    let fixtures = std::path::PathBuf::from(
        std::env::var_os("ZICODE_BROWSER_OCR_NOTES_FIXTURE")
            .expect("set the generated OCR fixture directory"),
    );
    let data: Value =
        serde_json::from_slice(&std::fs::read(fixtures.join("notes-payload.json")).unwrap()).unwrap();
    let recognize = |file: &str, language: Option<&str>| {
        let bytes = std::fs::read(fixtures.join(file)).unwrap();
        let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png).unwrap();
        crate::ocr::extract_decoded_text(&image, language, None, true).map(|result| result.text)
    };
    assert_eq!(
        recognize("primary.png", None).unwrap_err(),
        "No text was recognized in the image"
    );
    for name in ["primary", "embedded", "unselected"] {
        let text = recognize(&format!("{name}.png"), Some("zh-CN")).unwrap();
        assert_eq!(text, data["texts"][name].as_str().unwrap());
    }
    assert_eq!(
        recognize("english.png", Some("en-US")).unwrap(),
        data["texts"]["english"].as_str().unwrap()
    );
    let root = std::env::temp_dir().join(format!("browser-ocr-note-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(public.join("index.html"), "Isolated browser OCR Notes acceptance").unwrap();
    let start = || {
        let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
        let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
        HostServer::start(public.clone(), NativePiManager::new(4), auth)
    };
    let host = start().await.unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let workspace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let notebook: Value = client
        .post(format!("{}/v2/notes/notebooks", host.origin()))
        .json(&json!({"workspaceId":workspace,"sceneId":"programming","title":"OCR acceptance"}))
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let notebook_id = notebook["notebook"]["id"].as_str().unwrap();
    let mut draft = data["note"].clone();
    draft["workspaceId"] = json!(workspace);
    draft["sceneId"] = json!("programming");
    draft["notebookId"] = json!(notebook_id);
    let created: Value = client.post(format!("{}/v2/notes/create", host.origin()))
        .json(&draft).send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    let note = &created["note"];
    assert_eq!(note["content"], draft["content"]);
    for property in ["url", "capturedAt", "documentRevision"] {
        assert_eq!(note["source"][property], draft["source"][property]);
    }
    assert_eq!(note["source"]["contentHash"], content_hash(draft["content"].as_str().unwrap()));
    host.stop_and_wait().await.unwrap();
    let reopened_host = start().await.unwrap();
    let note_id = note["id"].as_str().unwrap();
    let reopened: Value = client.get(format!("{}/v2/notes/note", reopened_host.origin()))
        .query(&[("sceneId", "programming"), ("workspaceId", workspace), ("notebookId", notebook_id), ("noteId", note_id)])
        .send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
    assert_eq!(reopened, created);
    let body = reopened["note"]["content"].as_str().unwrap();
    for name in ["primary", "embedded"] {
        assert!(body.contains(data["texts"][name].as_str().unwrap()));
    }
    for forbidden in [data["texts"]["unselected"].as_str().unwrap(), "EXCLUDED FRAME BODY", "/unselected.png", "data:image/"] {
        assert!(!body.contains(forbidden));
    }
    assert!(body.contains("fixture-child-84") && body.contains("https://ocr-fixture.invalid/embedded"));
    reopened_host.stop_and_wait().await.unwrap();
}

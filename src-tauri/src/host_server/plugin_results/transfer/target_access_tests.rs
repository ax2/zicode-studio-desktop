use super::*;
use crate::metadata_store::{tool_access::Mutation, MetadataStore};
use crate::plugin_registry::manual_catalog::tool_access_id;

#[tokio::test]
async fn receiver_access_http_filters_before_paging_and_rejects_stale_scope() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("receiver-access-{}", uuid::Uuid::new_v4()));
    let receiver = root.join("receiver");
    std::fs::create_dir_all(receiver.join("runtime")).unwrap();
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), r#"{"purpose":"receiver search metadata acceptance, never execute","lifetime":"remove pass; retain failures"}"#).unwrap();
    std::fs::write(
        receiver.join("runtime/empty.wasm"),
        "(module (func (export \"_start\")))",
    )
    .unwrap();
    std::fs::write(receiver.join("plugin.json"), json!({
        "schemaVersion":2,"id":"com.example.receiver-access","name":"Receiver search fixture",
        "description":"Studio-owned metadata only","version":"0.1.0","publisher":"studio-test",
        "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},"runtime":{"wasi":"runtime/empty.wasm"},
        "requiredProfiles":{"tool.directory.v1":"=1.0.0-preview.1"},
        "contributes":{"capabilities":(0..210).map(|i|json!({"id":format!("compare.{i:03}"),"title":format!("Receiver {i:03}"),
            "directory":{"categoryId":if i < 105 {"text"} else {"code"}},
            "inputSchema":{"type":"object","properties":{"left":{"type":"string"},"right":{"type":"string"}},"required":["left","right"],"additionalProperties":false}})).collect::<Vec<_>>()}
    }).to_string()).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let workspace = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    let other = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::from([
            (workspace.into(), root.clone()),
            (other.into(), root.clone()),
        ]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let reference;
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for path in [project.join("tests/fixtures/devtools-text-dev57"), receiver] {
            let id = registry.install_developer(&path).unwrap();
            registry.set_enabled("programming", &id, true).unwrap();
        }
        let request: CapabilityInvokeRequest = serde_json::from_value(json!({"workspaceId":workspace,"sceneId":"programming",
            "pluginId":"com.zicode.devtools.text","capabilityId":"devtools.text.base64.encode","input":{"text":"source"},"captureResult":true})).unwrap();
        let expected = source_proof(&registry, &request).unwrap();
        reference = capture(
            &host.state,
            &registry,
            &request,
            &expected,
            &json!({"ok":true,"data":{"text":"payload"}}),
        )
        .unwrap();
    }
    let events = Arc::new(Mutex::new(Vec::new()));
    let observer = events.clone();
    host.state.capability_broker.lock().unwrap().worker_observer =
        Some(Arc::new(move |event, pid| {
            observer.lock().unwrap().push((event, pid))
        }));
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let url = format!("{}/v2/plugin-results/targets", host.origin());
    let scope = json!({"workspaceId":workspace,"sceneId":"programming","pluginId":"com.zicode.devtools.text","capabilityId":"devtools.text.base64.encode"});
    let base = json!({"scope":scope,"resultId":reference["resultId"],"query":"Receiver"});
    let post = |body: Value| {
        client
            .post(&url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    assert_eq!(
        client.post(&url).json(&base).send().await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let all: Value = post(base.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(all["total"], 420);
    assert_eq!(all["items"].as_array().unwrap().len(), 20);
    assert!(all["accessRevision"].is_null());
    assert!(all["sources"]
        .as_array()
        .unwrap()
        .iter()
        .any(
            |source| source["pluginId"] == "com.example.receiver-access" && source["count"] == 420
        ));
    assert!(all["categories"]
        .as_array()
        .unwrap()
        .iter()
        .any(|category| category["id"] == "text" && category["count"] == 210));
    assert!(all["categories"]
        .as_array()
        .unwrap()
        .iter()
        .any(|category| category["id"] == "code" && category["count"] == 210));
    let mut filtered = base.clone();
    filtered["categoryId"] = json!("code");
    filtered["pluginId"] = json!("com.example.receiver-access");
    let filtered_page: Value = post(filtered.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(filtered_page["total"], 210);
    assert!(filtered_page["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|item| item["categoryId"] == "code"));
    filtered["offset"] = json!(20);
    filtered["revision"] = filtered_page["revision"].clone();
    let second: Value = post(filtered.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(second["items"].as_array().unwrap().len(), 20);
    filtered["categoryId"] = json!("text");
    assert_eq!(post(filtered).await.unwrap().status(), StatusCode::CONFLICT);
    let mut invalid_filter = base.clone();
    invalid_filter["categoryId"] = json!("x".repeat(65));
    assert!(!post(invalid_filter).await.unwrap().status().is_success());
    let id = |i| tool_access_id("com.example.receiver-access", &format!("compare.{i:03}"));
    {
        let mut store = host.state.tool_access.lock().unwrap();
        for i in (185..210).rev() {
            store
                .mutate_tool_access(
                    "programming",
                    workspace,
                    Mutation::FavoriteSet {
                        id: id(i),
                        enabled: true,
                    },
                )
                .unwrap();
        }
        for i in [1, 209] {
            store
                .mutate_tool_access(
                    "programming",
                    workspace,
                    Mutation::RecentRecord { id: id(i) },
                )
                .unwrap();
        }
        store
            .mutate_tool_access(
                "programming",
                workspace,
                Mutation::FavoriteSet {
                    id: "missing:open".into(),
                    enabled: true,
                },
            )
            .unwrap();
    }
    let mut favorites = base.clone();
    favorites["view"] = json!("favorites");
    let page: Value = post(favorites.clone()).await.unwrap().json().await.unwrap();
    assert_eq!(page["total"], 50);
    assert_eq!(page["items"][0]["capabilityId"], "compare.209");
    assert_eq!(page["items"][0]["accessId"], id(209));
    assert!(!page.to_string().contains("inputSchema"));
    let mut seen = page["items"].as_array().unwrap().clone();
    for offset in [20, 40] {
        favorites["offset"] = json!(offset);
        favorites["revision"] = page["revision"].clone();
        favorites["accessRevision"] = page["accessRevision"].clone();
        let next: Value = post(favorites.clone()).await.unwrap().json().await.unwrap();
        seen.extend(next["items"].as_array().unwrap().clone());
    }
    let identities: std::collections::HashSet<_> = seen
        .iter()
        .map(|row| (row["capabilityId"].to_string(), row["field"].to_string()))
        .collect();
    assert_eq!(seen.len(), 50);
    assert_eq!(identities.len(), 50);
    let mut recent = base.clone();
    recent["view"] = json!("recent");
    let recent: Value = post(recent).await.unwrap().json().await.unwrap();
    assert_eq!(recent["total"], 4);
    assert_eq!(recent["items"][0]["capabilityId"], "compare.209");
    assert_eq!(recent["items"][2]["capabilityId"], "compare.001");
    let mut changed_query = favorites.clone();
    changed_query["query"] = json!("209");
    assert_eq!(
        post(changed_query).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    let mut changed_scope = base.clone();
    changed_scope["view"] = json!("favorites");
    changed_scope["scope"]["workspaceId"] = json!(other);
    assert_eq!(
        post(changed_scope).await.unwrap().status(),
        StatusCode::CONFLICT
    ); // source record belongs to first workspace
    let mut bad = base.clone();
    bad["view"] = json!("unknown");
    assert!(!post(bad).await.unwrap().status().is_success());
    let mut no_revision = base.clone();
    no_revision["offset"] = json!(20);
    assert_eq!(
        post(no_revision).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    host.state
        .tool_access
        .lock()
        .unwrap()
        .mutate_tool_access("programming", other, Mutation::RecentRecord { id: id(2) })
        .unwrap();
    assert_eq!(
        post(favorites.clone()).await.unwrap().status(),
        StatusCode::OK
    );
    host.state
        .tool_access
        .lock()
        .unwrap()
        .mutate_tool_access(
            "programming",
            workspace,
            Mutation::FavoriteSet {
                id: id(209),
                enabled: false,
            },
        )
        .unwrap();
    assert_eq!(
        post(favorites).await.unwrap().status(),
        StatusCode::CONFLICT
    );
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.example.receiver-access", false)
        .unwrap();
    let mut stale = base;
    stale["revision"] = all["revision"].clone();
    assert_eq!(post(stale).await.unwrap().status(), StatusCode::CONFLICT);
    assert!(events.lock().unwrap().is_empty());
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

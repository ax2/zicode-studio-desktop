use super::*;

#[tokio::test]
async fn real_http_manual_directory_pages_and_loads_without_worker_or_pi() {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("manual-catalog-{}", uuid::Uuid::new_v4()));
    let source = root.join("source");
    std::fs::create_dir_all(source.join("runtime")).unwrap();
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"manual tool directory HTTP acceptance; retain failure, remove pass"}"#,
    )
    .unwrap();
    std::fs::write(source.join("plugin.json"),serde_json::to_vec(&json!({
        "schemaVersion":2,"id":"com.zicode.manual-catalog","name":"Manual catalog fixture",
        "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
        "requiredProfiles":{"tool.directory.v1":"=1.0.0-preview.1"},
        "description":"Studio-owned metadata only acceptance","version":"0.1.0","publisher":"zicode",
        "runtime":{"worker":"runtime/worker.js"},
        "permissions":{"optional":[{"name":"pi.tools.register","reason":"AI only"}]},
        "contributes":{"capabilities":(0..205).map(|i|json!({"id":format!("text.{i:03}"),
            "title":format!("转换 {i:03}"),"directory":{"categoryId":if i % 2 == 0 {"text"} else {"data"},"aliases":["ＢＡＳＥ６４"],"description":"纯本地计算"},
            "inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}
        })).collect::<Vec<_>>()}
    })).unwrap()).unwrap();
    std::fs::write(
        source.join("runtime/worker.js"),
        "throw new Error('metadata must not execute');",
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::from([("workspace-a".into(), root.clone()), ("workspace-b".into(), root.clone())]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_enabled("programming", "com.zicode.manual-catalog", true)
            .unwrap();
    }
    let (events_tx, events_rx) = std::sync::mpsc::channel();
    host.state.capability_broker.lock().unwrap().worker_observer =
        Some(Arc::new(move |event, pid| {
            let _ = events_tx.send((event, pid));
        }));
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    let url = format!("{}/v2/plugin-tool-directory", host.origin());
    assert_eq!(
        client
            .get(&url)
            .query(&[("sceneId", "programming")])
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let token = &host.state.desktop_token;
    let first: Value = client
        .get(&url)
        .header("x-zicode-desktop-token", token)
        .query(&[
            ("sceneId", "programming"),
            ("query", "com.zicode.manual-catalog"),
        ])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(first["total"], 205);
    assert_eq!(first["items"].as_array().unwrap().len(), 40);
    assert!(!first.to_string().contains("inputSchema"));
    let categories: Value = client.get(&url).header("x-zicode-desktop-token", token)
        .query(&[("sceneId", "programming"), ("categoryId", "text"), ("query", "base64 纯本地")])
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(categories["total"], 103);
    assert_eq!(categories["items"].as_array().unwrap().len(), 40);
    assert!(categories["items"].as_array().unwrap().iter().all(|row| row["categoryId"] == "text"));
    assert!(categories["categories"].as_array().unwrap().iter().any(|row| row["id"] == "data" && row["count"] == 102));
    assert!(first["sources"].as_array().unwrap().iter().any(|source|
        source["pluginId"] == "com.zicode.manual-catalog" && source["count"] == 205));
    let source_filtered: Value = client.get(&url).header("x-zicode-desktop-token", token)
        .query(&[("sceneId", "programming"), ("pluginId", "com.zicode.manual-catalog"), ("query", "204")])
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(source_filtered["total"], 1);
    assert_eq!(source_filtered["items"][0]["capabilityId"], "text.204");
    assert_eq!(source_filtered["sources"], first["sources"]);
    let revision = first["revision"].as_str().unwrap();
    let second: Value = client
        .get(&url)
        .header("x-zicode-desktop-token", token)
        .query(&[
            ("sceneId", "programming"),
            ("query", "com.zicode.manual-catalog"),
            ("offset", "40"),
            ("revision", revision),
        ])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(second["items"].as_array().unwrap().len(), 40);
    assert_ne!(first["items"][0]["toolId"], second["items"][0]["toolId"]);
    use crate::metadata_store::tool_access::Mutation;
    let selected = second["items"][3]["accessId"].as_str().unwrap();
    {
        let mut store = host.state.tool_access.lock().unwrap();
        store.mutate_tool_access("programming", "workspace-a", Mutation::FavoriteSet { id: selected.into(), enabled: true }).unwrap();
        store.mutate_tool_access("programming", "workspace-a", Mutation::RecentRecord { id: selected.into() }).unwrap();
    }
    for view in ["favorites", "recent"] {
        let response: Value = client.get(&url).header("x-zicode-desktop-token", token)
            .query(&[("sceneId","programming"),("workspaceId","workspace-a"),("view",view)])
            .send().await.unwrap().json().await.unwrap();
        assert_eq!(response["total"], 1);
        assert_eq!(response["items"][0]["accessId"], selected);
        assert_eq!(response["accessRevision"], 2);
        assert!(!response.to_string().contains("inputSchema"));
        let other: Value = client.get(&url).header("x-zicode-desktop-token", token)
            .query(&[("sceneId","programming"),("workspaceId","workspace-b"),("view",view)])
            .send().await.unwrap().json().await.unwrap();
        assert_eq!(other["total"],0);
        let invalid = client.get(&url).header("x-zicode-desktop-token", token)
            .query(&[("sceneId","programming"),("workspaceId","not-registered"),("view",view)])
            .send().await.unwrap();
        assert_eq!(invalid.status(),StatusCode::BAD_REQUEST);
        let stale = client.get(&url).header("x-zicode-desktop-token", token)
            .query(&[("sceneId","programming"),("workspaceId","workspace-a"),("view",view),("accessRevision","1")])
            .send().await.unwrap();
        assert_eq!(stale.status(),StatusCode::CONFLICT);
    }
    let detail_url = format!("{url}/detail");
    let detail_query = [
        ("sceneId", "programming"),
        ("pluginId", "com.zicode.manual-catalog"),
        ("capabilityId", "text.204"),
        ("revision", revision),
    ];
    let detail: Value = client
        .get(&detail_url)
        .header("x-zicode-desktop-token", token)
        .query(&detail_query)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["capability"]["id"], "text.204");
    assert_eq!(detail["permissions"][0]["granted"], false);
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.manual-catalog", false)
        .unwrap();
    let stale = client
        .get(&detail_url)
        .header("x-zicode-desktop-token", token)
        .query(&detail_query)
        .send()
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    assert_eq!(
        stale.json::<Value>().await.unwrap()["error"]["code"],
        "catalog_changed"
    );
    let stale_call = client
        .post(format!("{}/v2/plugin-capabilities/invoke", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({
            "sceneId":"programming","workspaceId":uuid::Uuid::new_v4().to_string(),
            "pluginId":"com.zicode.manual-catalog","capabilityId":"text.204",
            "catalogRevision":revision,"input":{"text":"must not execute"}
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(stale_call.status(), StatusCode::CONFLICT);
    assert_eq!(
        stale_call.json::<Value>().await.unwrap()["error"]["code"],
        "catalog_changed"
    );
    let selection_source = root.join("selection-source");
    std::fs::create_dir_all(selection_source.join("runtime")).unwrap();
    std::fs::write(selection_source.join("runtime/tools.wasm"), b"\0asm\x01\0\0\0").unwrap();
    std::fs::write(selection_source.join("plugin.json"), serde_json::to_vec(&json!({
        "schemaVersion":2,"id":"com.zicode.selection-fixture","name":"Selection fixture",
        "description":"Studio metadata-only file selection","version":"0.1.0","publisher":"zicode",
        "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
        "requiredProfiles":{"file.input.hints.v1":"=1.0.0-preview.1"},
        "runtime":{"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2"},
        "permissions":{"optional":[{"name":"resource.read","reason":"chosen files"}]},
        "contributes":{"capabilities":[
            {"id":"only-text","inputSchema":{"type":"object"},"resourceInputMax":2,"fileInput":{"extensions":[".txt"]}},
            {"id":"any-file","inputSchema":{"type":"object"},"resourceInputMax":2,"fileInput":{"anyFile":true}},
            {"id":"legacy-unknown","inputSchema":{"type":"object"},"resourceInputMax":2}
        ]}
    })).unwrap()).unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&selection_source).unwrap();
        registry.set_enabled("programming", "com.zicode.selection-fixture", true).unwrap();
        registry.set_permission("programming", "com.zicode.selection-fixture", "resource.read", true).unwrap();
    }
    let names = json!(["one.txt", "two.zip"]).to_string();
    let selection: Value = client.get(&url).header("x-zicode-desktop-token", token)
        .query(&[("sceneId","programming"),("resourceOnly","true"),
            ("selectedFileCount","2"),("fileNames", names.as_str())])
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(selection["total"], 2);
    assert_eq!(selection["items"][0]["capabilityId"], "any-file");
    assert_eq!(selection["items"][0]["fileInputMatch"], "declared");
    assert_eq!(selection["items"][1]["capabilityId"], "legacy-unknown");
    let invalid = client.get(&url).header("x-zicode-desktop-token", token)
        .query(&[("sceneId","programming"),("resourceOnly","true"),
            ("selectedFileCount","3"),("fileNames", names.as_str())])
        .send().await.unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    let events: Vec<_> = events_rx.try_iter().collect();
    assert!(
        events.is_empty(),
        "metadata browsing must not spawn Worker: {events:?}"
    );
    host.stop_and_wait().await.unwrap();
    if let Some(path) = std::env::var_os("ZICODE_TEST_MANUAL_CATALOG_EVIDENCE") {
        std::fs::write(path,serde_json::to_vec_pretty(&json!({"passed":true,"surface":"current source Host real HTTP",
            "fixtureTools":205,"pageSize":40,"schemaOnlyOnDetail":true,"piPermissionNotRequired":true,
            "staleDetailRejected":true,"unauthorizedRejected":true,"workerEvents":0,"fullToolsAccepted":0,
            "notVerified":"UI, tool execution, DevTools algorithms, cancellation, other OS"})).unwrap()).unwrap();
    }
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

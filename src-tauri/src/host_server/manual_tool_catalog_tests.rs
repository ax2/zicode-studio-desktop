use super::*;

#[tokio::test]
async fn frozen_devtools_view_candidates_are_discoverable_through_real_host_http() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let fixture = project.join("tests/fixtures/devtools-view-operation-2026-10-18");
    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("devtools-view-host-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), r#"{"purpose":"frozen DevTools View candidate isolated Host HTTP; remove on pass"}"#).unwrap();
    let metadata = crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"), NativePiManager::new(16), auth,
        HashMap::from([("workspace-a".into(), root.clone())]), HostMode::IsolatedDesktop,
    ).await.unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (folder, plugin_id) in [
            ("agent-assist-preview-0.1.3-candidate-01", "com.zicode.devtools.agent-assist"),
            ("spring-actuator-0.1.3-candidate-01", "com.zicode.devtools.spring-actuator"),
        ] {
            assert_eq!(registry.install_developer(&fixture.join(folder)).unwrap(), plugin_id);
        }
    }
    let (events_tx, events_rx) = std::sync::mpsc::channel();
    host.state.capability_broker.lock().unwrap().worker_observer =
        Some(Arc::new(move |event, pid| { let _ = events_tx.send((event, pid)); }));
    let client = reqwest::Client::builder().no_proxy()
        .timeout(Duration::from_secs(3)).build().unwrap();
    let url = format!("{}/v2/plugin-tool-directory", host.origin());
    for (plugin_id, count) in [
        ("com.zicode.devtools.agent-assist", 2),
        ("com.zicode.devtools.spring-actuator", 4),
    ] {
        let default_page: Value = client.get(&url)
            .header("x-zicode-desktop-token", &host.state.desktop_token)
            .query(&[("sceneId", "programming"), ("pluginId", plugin_id)])
            .send().await.unwrap().json().await.unwrap();
        assert_eq!(default_page["total"], 0, "{plugin_id}");
        let page: Value = client.get(&url)
            .header("x-zicode-desktop-token", &host.state.desktop_token)
            .query(&[("sceneId", "programming"), ("pluginId", plugin_id),
                ("includeViewOperations", "true")])
            .send().await.unwrap().json().await.unwrap();
        assert_eq!(page["total"], count, "{plugin_id}");
        assert!(page["items"].as_array().unwrap().iter().all(|item|
            item["kind"] == "view-operation" && item["enabled"] == false
            && item.get("capabilityId").is_none()));
        assert!(page["sources"].as_array().unwrap().iter().any(|source|
            source["pluginId"] == plugin_id && source["count"] == count));
    }
    assert!(events_rx.try_iter().collect::<Vec<_>>().is_empty());
    host.stop_and_wait().await.unwrap();
    assert!(root.canonicalize().unwrap().starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn real_http_view_directory_is_opt_in_and_cannot_load_a_capability() {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("view-directory-http-{}", uuid::Uuid::new_v4()));
    let source = root.join("source");
    std::fs::create_dir_all(source.join("views")).unwrap();
    std::fs::create_dir_all(root.join("public")).unwrap();
    std::fs::write(root.join("owner.json"), r#"{"purpose":"isolated View directory real HTTP acceptance; remove on pass"}"#).unwrap();
    std::fs::write(source.join("plugin.json"), serde_json::to_vec(&json!({
        "schemaVersion":2,"id":"com.zicode.view-http","name":"View HTTP fixture",
        "description":"Studio-owned metadata fixture","version":"0.1.0","publisher":"zicode",
        "engines":{"zicode":">=0.4.2 <1.0.0","pluginApi":"^1.0.0"},
        "requiredProfiles":{"view.operation.directory.v1":"=1.0.0-preview.1"},
        "activationEvents":["onView:example.main"],"runtime":{},
        "permissions":{"required":[],"optional":[]},
        "contributes":{
            "activities":[{"id":"example.application","title":"Example"}],
            "views":[{"id":"example.main","activity":"example.application",
                "location":"main","title":"Main","entry":"views/main.html"}],
            "viewOperations":[{"id":"example.health","title":"Health",
                "viewId":"example.main","directory":{"categoryId":"system",
                    "aliases":["服务健康"],"description":"Show health panel"}}],
            "capabilities":[],"commands":[],"piTools":[]
        }
    })).unwrap()).unwrap();
    std::fs::write(source.join("views/main.html"), "<!doctype html><title>Example</title>").unwrap();
    let metadata = crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"), NativePiManager::new(16), auth,
        HashMap::from([("workspace-a".into(), root.clone())]), HostMode::IsolatedDesktop,
    ).await.unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
    }
    let (events_tx, events_rx) = std::sync::mpsc::channel();
    host.state.capability_broker.lock().unwrap().worker_observer =
        Some(Arc::new(move |event, pid| { let _ = events_tx.send((event, pid)); }));
    let client = reqwest::Client::builder().no_proxy()
        .timeout(Duration::from_secs(3)).build().unwrap();
    let url = format!("{}/v2/plugin-tool-directory", host.origin());
    let token = &host.state.desktop_token;
    let default_page: Value = client.get(&url).header("x-zicode-desktop-token", token)
        .query(&[("sceneId", "programming"), ("query", "服务健康")])
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(default_page["total"], 0);
    let included: Value = client.get(&url).header("x-zicode-desktop-token", token)
        .query(&[("sceneId", "programming"), ("query", "服务健康"),
            ("includeViewOperations", "true")])
        .send().await.unwrap().json().await.unwrap();
    assert_eq!(included["total"], 1);
    let operation = &included["items"][0];
    assert_eq!(operation["kind"], "view-operation");
    assert_eq!(operation["operationId"], "example.health");
    assert_eq!(operation["viewId"], "example.main");
    assert_eq!(operation["status"], "plugin_disabled");
    assert!(operation.get("capabilityId").is_none());
    assert_eq!(included["categories"][0]["count"], 1);
    let fixture_source = included["sources"].as_array().unwrap().iter()
        .find(|source| source["pluginId"] == "com.zicode.view-http").unwrap();
    assert_eq!(fixture_source["enabled"], false);
    let detail = client.get(format!("{url}/detail"))
        .header("x-zicode-desktop-token", token)
        .query(&[("sceneId", "programming"), ("pluginId", "com.zicode.view-http"),
            ("capabilityId", "example.health"),
            ("revision", included["revision"].as_str().unwrap())])
        .send().await.unwrap();
    assert_eq!(detail.status(), StatusCode::NOT_FOUND);
    assert_eq!(detail.json::<Value>().await.unwrap()["error"]["code"], "tool_unavailable");
    assert!(events_rx.try_iter().collect::<Vec<_>>().is_empty());
    host.stop_and_wait().await.unwrap();
    assert!(root.canonicalize().unwrap().starts_with(scratch.canonicalize().unwrap()));
    std::fs::remove_dir_all(root).unwrap();
}

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
        HashMap::from([
            ("workspace-a".into(), root.clone()),
            ("workspace-b".into(), root.clone()),
        ]),
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
    let plugins_url = format!("{}/v2/plugins?sceneId=programming", host.origin());
    let full_plugins: Value = client
        .get(&plugins_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let summary_plugins: Value = client
        .get(format!("{plugins_url}&summary=true"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let full = full_plugins["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|plugin| plugin["id"] == "com.zicode.manual-catalog")
        .unwrap();
    let summary = summary_plugins["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|plugin| plugin["id"] == "com.zicode.manual-catalog")
        .unwrap();
    assert_eq!(summary["enabled"], full["enabled"]);
    assert_eq!(summary["permissionGrants"], full["permissionGrants"]);
    assert_eq!(
        summary["contributes"]["capabilities"]
            .as_array()
            .unwrap()
            .len(),
        205
    );
    assert!(summary["contributes"]["capabilities"][0]
        .get("inputSchema")
        .is_none());
    assert!(summary.get("runtime").is_none());
    let full_bytes = serde_json::to_vec(&full_plugins).unwrap().len();
    let summary_bytes = serde_json::to_vec(&summary_plugins).unwrap().len();
    println!("205-capability plugin list JSON bytes: full={full_bytes} summary={summary_bytes}");
    assert!(summary_bytes < full_bytes);
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
    let categories: Value = client
        .get(&url)
        .header("x-zicode-desktop-token", token)
        .query(&[
            ("sceneId", "programming"),
            ("categoryId", "text"),
            ("query", "base64 纯本地"),
        ])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(categories["total"], 103);
    assert_eq!(categories["items"].as_array().unwrap().len(), 40);
    assert!(categories["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row["categoryId"] == "text"));
    assert!(categories["categories"]
        .as_array()
        .unwrap()
        .iter()
        .any(|row| row["id"] == "data" && row["count"] == 102));
    assert!(first["sources"]
        .as_array()
        .unwrap()
        .iter()
        .any(|source| source["pluginId"] == "com.zicode.manual-catalog" && source["count"] == 205));
    let source_filtered: Value = client
        .get(&url)
        .header("x-zicode-desktop-token", token)
        .query(&[
            ("sceneId", "programming"),
            ("pluginId", "com.zicode.manual-catalog"),
            ("query", "204"),
        ])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
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
        store
            .mutate_tool_access(
                "programming",
                "workspace-a",
                Mutation::FavoriteSet {
                    id: selected.into(),
                    enabled: true,
                },
            )
            .unwrap();
        store
            .mutate_tool_access(
                "programming",
                "workspace-a",
                Mutation::RecentRecord {
                    id: selected.into(),
                },
            )
            .unwrap();
    }
    for view in ["favorites", "recent"] {
        let response: Value = client
            .get(&url)
            .header("x-zicode-desktop-token", token)
            .query(&[
                ("sceneId", "programming"),
                ("workspaceId", "workspace-a"),
                ("view", view),
            ])
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["total"], 1);
        assert_eq!(response["items"][0]["accessId"], selected);
        assert_eq!(response["accessRevision"], 2);
        assert!(!response.to_string().contains("inputSchema"));
        let other: Value = client
            .get(&url)
            .header("x-zicode-desktop-token", token)
            .query(&[
                ("sceneId", "programming"),
                ("workspaceId", "workspace-b"),
                ("view", view),
            ])
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(other["total"], 0);
        let invalid = client
            .get(&url)
            .header("x-zicode-desktop-token", token)
            .query(&[
                ("sceneId", "programming"),
                ("workspaceId", "not-registered"),
                ("view", view),
            ])
            .send()
            .await
            .unwrap();
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        let stale = client
            .get(&url)
            .header("x-zicode-desktop-token", token)
            .query(&[
                ("sceneId", "programming"),
                ("workspaceId", "workspace-a"),
                ("view", view),
                ("accessRevision", "1"),
            ])
            .send()
            .await
            .unwrap();
        assert_eq!(stale.status(), StatusCode::CONFLICT);
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
    std::fs::write(
        selection_source.join("runtime/tools.wasm"),
        b"\0asm\x01\0\0\0",
    )
    .unwrap();
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
        registry
            .set_enabled("programming", "com.zicode.selection-fixture", true)
            .unwrap();
        registry
            .set_permission(
                "programming",
                "com.zicode.selection-fixture",
                "resource.read",
                true,
            )
            .unwrap();
    }
    let names = json!(["one.txt", "two.zip"]).to_string();
    let selection: Value = client
        .get(&url)
        .header("x-zicode-desktop-token", token)
        .query(&[
            ("sceneId", "programming"),
            ("resourceOnly", "true"),
            ("selectedFileCount", "2"),
            ("fileNames", names.as_str()),
        ])
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(selection["total"], 2);
    assert_eq!(selection["items"][0]["capabilityId"], "any-file");
    assert_eq!(selection["items"][0]["fileInputMatch"], "declared");
    assert_eq!(selection["items"][1]["capabilityId"], "legacy-unknown");
    let invalid = client
        .get(&url)
        .header("x-zicode-desktop-token", token)
        .query(&[
            ("sceneId", "programming"),
            ("resourceOnly", "true"),
            ("selectedFileCount", "3"),
            ("fileNames", names.as_str()),
        ])
        .send()
        .await
        .unwrap();
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

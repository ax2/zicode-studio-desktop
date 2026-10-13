use super::*;

#[test]
fn pi_catalog_ranks_exact_tools_before_broad_description_matches() {
    let tool = |plugin_id: &str, capability: &str, title: &str, description: &str| {
        PluginPiToolDescriptor {
            plugin_id: plugin_id.into(),
            name: capability.into(),
            title: title.into(),
            description: description.into(),
            capability: capability.into(),
            input_schema: json!({"type":"object"}),
        }
    };
    let tools = vec![
        tool("com.example.archive", "archive.list", "List archive", "Base64 archive data"),
        tool("com.example.text", "text.base64", "Base64", "Encode text"),
        tool("com.example.text", "text.base64.decode", "Decode Base64", "Decode text"),
    ];
    let query = tool_search::normalize_query("ＢＡＳＥ６４");
    let matches = ranked_matches(&tools, &SearchIndex::new(), &query);
    assert_eq!(
        matches.iter().map(|item| item.capability.as_str()).collect::<Vec<_>>(),
        vec!["text.base64", "text.base64.decode", "archive.list"]
    );
}

#[tokio::test]
async fn real_http_contract_changes_invalidate_cursor_load_and_invocation() {
    use std::fs;
    async fn post(client: &reqwest::Client, url: &str, body: &Value) -> (StatusCode, Value) {
        let response = client
            .post(url)
            .bearer_auth("synthetic-revision-token")
            .json(body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        (status, response.json().await.unwrap())
    }
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".cache/task-scratch")
        .join(format!("catalog-contract-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("public")).unwrap();
    fs::write(
        root.join("owner.json"),
        json!({"purpose":"bounded real HTTP contract revision evidence",
        "lifetime":"retain tiny package and safe receipts","pid":std::process::id()})
        .to_string(),
    )
    .unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let target = RuntimeTarget::new("revision-workspace", "revision-session", "revision-runtime");
    let runtime = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start_with_mode(
        root.join("public"),
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let source = root.join("package");
    fs::create_dir_all(source.join("runtime")).unwrap();
    fs::write(source.join("runtime/tools.wasm"), b"\0asm\x01\0\0\0").unwrap();
    let mut capabilities: Vec<_> = (0..21)
        .map(|index| {
            json!({"id":format!("revision.{index}"),
        "inputSchema":{"type":"object"}})
        })
        .collect();
    capabilities[0]["maxResultBytes"] = json!(100);
    capabilities.push(json!({"id":"unregistered","inputSchema":{"type":"object"}}));
    let tools: Vec<_> = (0..21).map(|index| json!({"name":format!("revision_{index}"),
        "description":"revision-fixture","capability":format!("revision.{index}"),"inputSchema":{"type":"object"}})).collect();
    let mut manifest = json!({"schemaVersion":2,"id":"com.synthetic.revision","name":"Revision fixture",
        "description":"fixture","version":"0.1.0","publisher":"test",
        "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
        "requiredProfiles":{"output.schema.v1":"=1.0.0-rc.1"},"runtime":{"wasi":"runtime/tools.wasm"},
        "contributes":{"capabilities":capabilities,"piTools":tools},
        "permissions":{"required":[{"name":"pi.tools.register","reason":"fixture"}]}});
    let install = |manifest: &Value| {
        fs::write(source.join("plugin.json"), manifest.to_string()).unwrap();
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_permission(
                "programming",
                "com.synthetic.revision",
                "pi.tools.register",
                true,
            )
            .unwrap();
        registry
            .set_enabled("programming", "com.synthetic.revision", true)
            .unwrap();
    };
    install(&manifest);
    host.state.plugin_tokens.lock().unwrap().insert(
        target.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(b"synthetic-revision-token"),
            target: target.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let search_url = format!("{}/v2/plugin-tools/catalog/search", host.origin());
    let load_url = format!("{}/v2/plugin-tools/catalog/load", host.origin());
    let invoke_url = format!("{}/v2/plugin-tools/invoke", host.origin());
    let search_request = json!({"schemaVersion":1,"runtimeId":target.instance_id,
        "sessionId":target.session_id,"query":"revision-fixture"});
    let mut receipts = Vec::new();
    for change in ["input", "output", "bytes"] {
        let (status, before) = post(&client, &search_url, &search_request).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(before["total"], 21);
        let revision = before["revision"].as_str().unwrap();
        let id = serde_json::to_string(&("com.synthetic.revision", "revision.0")).unwrap();
        let load_request = json!({"schemaVersion":1,"runtimeId":target.instance_id,
            "sessionId":target.session_id,"revision":revision,"toolId":id});
        assert_eq!(
            post(&client, &load_url, &load_request).await.0,
            StatusCode::OK
        );
        // A byte-identical reinstall and unrelated, unregistered capability do not invalidate tools.
        install(&manifest);
        assert_eq!(
            post(&client, &search_url, &search_request).await.1["revision"],
            before["revision"]
        );
        manifest["contributes"]["capabilities"][21]["inputSchema"]["description"] = json!(change);
        install(&manifest);
        assert_eq!(
            post(&client, &search_url, &search_request).await.1["revision"],
            before["revision"]
        );
        match change {
            "input" => {
                manifest["contributes"]["capabilities"][0]["inputSchema"]["additionalProperties"] =
                    json!(false)
            }
            "output" => {
                manifest["contributes"]["capabilities"][0]["outputSchema"] =
                    json!({"type":"object"})
            }
            _ => manifest["contributes"]["capabilities"][0]["maxResultBytes"] = json!(10),
        }
        install(&manifest);
        let mut page_request = search_request.clone();
        page_request["cursor"] = before["nextCursor"].clone();
        let (cursor_status, _) = post(&client, &search_url, &page_request).await;
        assert_eq!(cursor_status, StatusCode::BAD_REQUEST);
        let (load_status, load_error) = post(&client, &load_url, &load_request).await;
        assert_eq!(load_status, StatusCode::CONFLICT);
        assert_eq!(load_error["error"]["code"], "catalog_revision_changed");
        let invocation = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
            "toolCallId":format!("stale-{change}"),"toolName":"revision_0","input":{},
            "toolId":id,"catalogRevision":revision});
        let (invoke_status, invoke_error) = post(&client, &invoke_url, &invocation).await;
        assert_eq!(invoke_status, StatusCode::CONFLICT);
        assert_eq!(invoke_error["error"]["code"], "catalog_revision_changed");
        let (status, refreshed) = post(&client, &search_url, &search_request).await;
        assert_eq!(status, StatusCode::OK);
        assert_ne!(refreshed["revision"], before["revision"]);
        let mut refreshed_load = load_request;
        refreshed_load["revision"] = refreshed["revision"].clone();
        assert_eq!(
            post(&client, &load_url, &refreshed_load).await.0,
            StatusCode::OK
        );
        assert!(refreshed["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item.get("outputSchema").is_none()));
        receipts.push(json!({"change":change,"staleCursorStatus":cursor_status.as_u16(),
            "staleLoadStatus":load_status.as_u16(),"staleInvokeStatus":invoke_status.as_u16(),
            "refreshedLoadStatus":200,"unchangedReinstallStable":true,"unregisteredCapabilityStable":true}));
    }
    manifest["requiredProfiles"]["tool.directory.v1"] = json!("=1.0.0-preview.1");
    manifest["contributes"]["capabilities"][0]["directory"] = json!({
        "categoryId":"text","aliases":["编码旧别名"],"description":"本地文本工具"
    });
    install(&manifest);
    let alias_search = json!({"schemaVersion":1,"runtimeId":target.instance_id,
        "sessionId":target.session_id,"query":"编码旧别名"});
    let (status, alias_page) = post(&client, &search_url, &alias_search).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(alias_page["total"], 1);
    assert_eq!(alias_page["items"][0]["capability"], "revision.0");
    let old_revision = alias_page["revision"].as_str().unwrap().to_owned();
    manifest["contributes"]["capabilities"][0]["directory"]["aliases"] = json!(["编码新别名"]);
    install(&manifest);
    let (status, stale_alias) = post(&client, &search_url, &alias_search).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(stale_alias["total"], 0);
    assert_ne!(stale_alias["revision"], old_revision);
    let mut new_alias_search = alias_search.clone();
    new_alias_search["query"] = json!("编码新别名");
    let current_alias_page = post(&client, &search_url, &new_alias_search).await.1;
    assert_eq!(current_alias_page["total"], 1);
    manifest["contributes"]["capabilities"][21]["directory"] = json!({
        "categoryId":"text","aliases":["未注册别名"]
    });
    install(&manifest);
    assert_eq!(post(&client, &search_url, &new_alias_search).await.1["revision"],
        current_alias_page["revision"]);
    let stale_load = json!({"schemaVersion":1,"runtimeId":target.instance_id,
        "sessionId":target.session_id,"revision":old_revision,
        "toolId":serde_json::to_string(&("com.synthetic.revision", "revision.0")).unwrap()});
    assert_eq!(post(&client, &load_url, &stale_load).await.0, StatusCode::CONFLICT);
    receipts.push(json!({"change":"directory-alias","oldAliasRemoved":true,
        "newRevision":true,"unregisteredDirectoryStable":true,"staleLoadStatus":409}));
    host.state.runtimes.stop(&target).unwrap();
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    fs::write(
        root.join("receipts.json"),
        serde_json::to_vec_pretty(&receipts).unwrap(),
    )
    .unwrap();
    println!("contract-revision evidence={}; 3 changes x stale cursor/load/invoke rejected; refreshed load passed", root.display());
}

#[test]
fn cursors_are_bound_to_secret_runtime_query_and_revision() {
    let cursor = encode_cursor("host-secret", "runtime-a", "revision-a", "json", 20);
    assert_eq!(
        decode_cursor(&cursor, "host-secret", "runtime-a", "revision-a", "json").unwrap(),
        20
    );
    for (secret, binding, revision, query) in [
        ("other", "runtime-a", "revision-a", "json"),
        ("host-secret", "runtime-b", "revision-a", "json"),
        ("host-secret", "runtime-a", "revision-b", "json"),
        ("host-secret", "runtime-a", "revision-a", "sha"),
    ] {
        assert!(decode_cursor(&cursor, secret, binding, revision, query).is_err());
    }
    assert!(decode_cursor(
        "malformed",
        "host-secret",
        "runtime-a",
        "revision-a",
        "json"
    )
    .is_err());
    assert!(bounded(json!({"schema":"x".repeat(MAX_LOAD_BYTES)}), MAX_LOAD_BYTES).is_err());
}

#[tokio::test]
async fn real_http_catalog_pages_thousand_authorized_tools_and_rechecks_grants() {
    use std::fs;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".cache/task-scratch")
        .join(format!("pi-catalog-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("public")).unwrap();
    fs::write(root.join("owner.json"), serde_json::to_vec(&json!({"owner":"pi-tool-catalog-host","purpose":"isolated synthetic 1000-tool real HTTP conformance; not Worker implementation","lifetime":"remove on success, retain on failure"})).unwrap()).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let target = RuntimeTarget::new("catalog-workspace", "catalog-session", "catalog-runtime");
    let runtime = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start_with_mode(
        root.join("public"),
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    for package in 0..10 {
        let source = root.join(format!("source-{package}"));
        fs::create_dir_all(source.join("runtime")).unwrap();
        fs::write(source.join("runtime/tools.wasm"), b"\0asm\x01\0\0\0").unwrap();
        let schema = json!({"type":"object","additionalProperties":false,"properties":{"text":{"type":"string"}}});
        let capabilities: Vec<_> = (0..100).map(|index| json!({"id":format!("catalog.{package}.{index}"),"title":"Catalog fixture","inputSchema":schema})).collect();
        let tools: Vec<_> = (0..100).map(|index| json!({"name":format!("catalog_{package}_{index}"),"title":"Catalog fixture","description":"catalog-fixture JSON text","capability":format!("catalog.{package}.{index}"),"inputSchema":schema})).collect();
        let id = format!("com.synthetic.catalog{package}");
        fs::write(source.join("plugin.json"), serde_json::to_vec(&json!({"schemaVersion":1,"id":id,"name":"Synthetic catalog","description":"catalog-fixture","version":"0.1.0","publisher":"test","runtime":{"wasi":"runtime/tools.wasm"},"contributes":{"capabilities":capabilities,"piTools":tools},"permissions":{"required":[{"name":"pi.tools.register","reason":"catalog fixture"}]}})).unwrap()).unwrap();
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_permission("programming", &id, "pi.tools.register", true)
            .unwrap();
        registry.set_enabled("programming", &id, true).unwrap();
    }
    // Bind the same production token path without spawning a Pi process or writing user data.
    let token = "isolated-runtime-token";
    host.state.plugin_tokens.lock().unwrap().insert(
        target.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(token.as_bytes()),
            target: target.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let search_url = format!("{}/v2/plugin-tools/catalog/search", host.origin());
    let load_url = format!("{}/v2/plugin-tools/catalog/load", host.origin());
    let mut request = json!({"schemaVersion":1,"runtimeId":target.instance_id,"sessionId":target.session_id,"query":"catalog-fixture JSON"});
    assert_eq!(
        client
            .post(&search_url)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let mut ids = HashSet::new();
    let mut first_cursor = None;
    let mut revision: String;
    let mut last_id = String::new();
    loop {
        let response = client
            .post(&search_url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let page: Value = response.json().await.unwrap();
        assert_eq!(page["total"], 1000);
        revision = page["revision"].as_str().unwrap().into();
        let items = page["items"].as_array().unwrap();
        assert!(items.len() <= PAGE_SIZE);
        for item in items {
            last_id = item["toolId"].as_str().unwrap().into();
            assert!(ids.insert(last_id.clone()));
            assert!(item.get("inputSchema").is_none());
            assert!(item["toolVersion"].is_null());
        }
        if first_cursor.is_none() {
            first_cursor = page["nextCursor"].as_str().map(str::to_owned);
        }
        if page["nextCursor"].is_null() {
            break;
        }
        request["cursor"] = page["nextCursor"].clone();
    }
    assert_eq!(ids.len(), 1000);
    let load_request = json!({"schemaVersion":1,"runtimeId":target.instance_id,"sessionId":target.session_id,"revision":revision,"toolId":last_id});
    let loaded = client
        .post(&load_url)
        .bearer_auth(token)
        .json(&load_request)
        .send()
        .await
        .unwrap();
    assert_eq!(loaded.status(), StatusCode::OK);
    assert_eq!(
        loaded.json::<Value>().await.unwrap()["tool"]["inputSchema"]["type"],
        "object"
    );
    request["cursor"] = json!(first_cursor);
    request["query"] = json!("different query");
    assert_eq!(
        client
            .post(&search_url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    request["query"] = json!("catalog-fixture JSON");
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission(
            "programming",
            "com.synthetic.catalog9",
            "pi.tools.register",
            false,
        )
        .unwrap();
    assert_eq!(
        client
            .post(&search_url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        client
            .post(&load_url)
            .bearer_auth(token)
            .json(&load_request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    let stale_invoke = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "toolCallId":"stale-catalog","toolName":"catalog_9_99","input":{},
        "toolId":last_id,"catalogRevision":revision});
    assert_eq!(
        client
            .post(format!("{}/v2/plugin-tools/invoke", host.origin()))
            .bearer_auth(token)
            .json(&stale_invoke)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::CONFLICT
    );
    request.as_object_mut().unwrap().remove("cursor");
    assert_eq!(
        client
            .post(&search_url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["total"],
        900
    );
    request["sessionId"] = json!("another-session");
    assert_eq!(
        client
            .post(&search_url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    request["sessionId"] = json!(target.session_id);
    host.state.runtimes.stop(&target).unwrap();
    assert_eq!(
        client
            .post(&search_url)
            .bearer_auth(token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::GONE
    );
    drop(runtime);
    host.stop_and_wait().await.unwrap();
    fs::remove_dir_all(root).unwrap();
}

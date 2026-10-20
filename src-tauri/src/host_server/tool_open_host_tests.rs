use super::*;
use crate::metadata_store::MetadataStore;
use std::fs;

#[tokio::test]
#[ignore = "requires ZICODE_TEST_INSPECT_012_DIR and ZICODE_TEST_INSPECT_012_RECEIPT; run alone"]
async fn current_inspect_tool_open_candidate_survives_real_host_view_lifecycle() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let candidate = PathBuf::from(std::env::var_os("ZICODE_TEST_INSPECT_012_DIR").unwrap())
        .canonicalize()
        .unwrap();
    let receipt = PathBuf::from(std::env::var_os("ZICODE_TEST_INSPECT_012_RECEIPT").unwrap())
        .canonicalize()
        .unwrap();
    let verify = |directory: &std::path::Path| {
        let output = std::process::Command::new("bun")
            .current_dir(&project)
            .arg("run")
            .arg("verify:devtools-package")
            .arg(directory)
            .arg(&receipt)
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let report: Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(report["verified"], true);
        assert_eq!(report["fileCount"], 616);
        assert_eq!(report["directoryIndex"]["status"], "matched");
    };
    verify(&candidate);

    let scratch = project.join(".cache/task-scratch");
    let root = scratch.join(format!("inspect-012-tool-open-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "Inspect 0.1.2 isolated Host").unwrap();
    fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Inspect 0.1.2 real Host/View acceptance","removeOnSuccess":true}"#,
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin_id = "com.zicode.devtools.inspect";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&candidate).unwrap(), plugin_id);
    }
    let installed = root.join("test-plugin-registry/developer").join(plugin_id);
    verify(&installed);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let list_url = format!("{}/v2/plugins?sceneId=programming&summary=true", host.origin());
    let view_url = format!(
        "{}/v2/plugin-views/source?sceneId=programming&pluginId={plugin_id}&viewId=devtools.inspect.main",
        host.origin()
    );
    let list: Value = client.get(&list_url).send().await.unwrap().json().await.unwrap();
    let plugin = list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == plugin_id)
        .unwrap();
    assert_eq!(plugin["version"], "0.1.2");
    assert_eq!(plugin["enabled"], false);
    assert_eq!(plugin["toolOpenProfile"], true);
    let capabilities = plugin["contributes"]["capabilities"].as_array().unwrap();
    assert_eq!(capabilities.len(), 8);
    assert!(capabilities.iter().all(|capability| capability.get("inputSchema").is_none()));
    assert_eq!(
        client
            .get(&view_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin_id, true)
        .unwrap();
    let view: Value = client
        .get(&view_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view["view"]["viewId"], "devtools.inspect.main");
    assert!(view["view"]["html"]
        .as_str()
        .unwrap()
        .contains("navigation.onOpenTool"));
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin_id, false)
        .unwrap();
    assert_eq!(
        client
            .get(&view_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    host.stop_and_wait().await.unwrap();
    assert!(root.canonicalize().unwrap().starts_with(scratch.canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn tool_open_profile_survives_real_host_install_listing_and_view_lifecycle() {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("tool-open-host-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/studio-tool-open-profile");
    fs::create_dir_all(&public).unwrap();
    fs::write(public.join("index.html"), "Studio tool open fixture").unwrap();
    fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Studio tool.open Host acceptance","removeOnSuccess":true}"#,
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let plugin_id = "com.zicode.studio.tool-open-fixture";
    let list_url = format!(
        "{}/v2/plugins?sceneId=programming&summary=true",
        host.origin()
    );
    let view_url = format!(
        "{}/v2/plugin-views/source?sceneId=programming&pluginId={plugin_id}&viewId=studio.fixture.main",
        host.origin()
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&source).unwrap(), plugin_id);
    }
    let listed: Value = client
        .get(&list_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let plugin = listed["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|plugin| plugin["id"] == plugin_id)
        .unwrap();
    assert_eq!(plugin["enabled"], false);
    assert_eq!(plugin["toolOpenProfile"], true);
    assert_eq!(
        plugin["contributes"]["capabilities"][0]["id"],
        "studio.fixture.echo"
    );
    assert!(plugin["contributes"]["capabilities"][0]
        .get("inputSchema")
        .is_none());
    assert_eq!(
        client
            .get(&view_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
    }
    let enabled_list: Value = client
        .get(&list_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let enabled_plugin = enabled_list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|plugin| plugin["id"] == plugin_id)
        .unwrap();
    assert_eq!(enabled_plugin["enabled"], true);
    assert_eq!(enabled_plugin["toolOpenProfile"], true);
    let view: Value = client
        .get(&view_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view["view"]["viewId"], "studio.fixture.main");
    assert!(view["view"]["html"]
        .as_str()
        .unwrap()
        .contains("navigation.onOpenTool"));
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, false)
            .unwrap();
    }
    assert_eq!(
        client
            .get(&view_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn view_capability_can_prepare_without_a_visible_directory_search_result() {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!("view-call-host-{}", uuid::Uuid::new_v4()));
    let source = root.join("plugin");
    fs::create_dir_all(source.join("runtime")).unwrap();
    fs::create_dir_all(source.join("views")).unwrap();
    fs::create_dir_all(root.join("public")).unwrap();
    fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Studio View call Host handshake; remove on success"}"#,
    )
    .unwrap();
    let plugin_id = "com.zicode.studio.view-call-fixture";
    fs::write(
        source.join("plugin.json"),
        serde_json::to_vec(&json!({
            "schemaVersion":1,"id":plugin_id,"name":"Studio View Call Fixture",
            "description":"Synthetic Studio fixture","version":"0.1.0","publisher":"zicode",
            "runtime":{"worker":"runtime/worker.js"},
            "permissions":{"required":[],"optional":[]},
            "contributes":{
                "activities":[{"id":"fixture","title":"Fixture"}],
                "views":[{"id":"fixture.main","activity":"fixture","location":"main",
                    "title":"Fixture","entry":"views/main.html"}],
                "capabilities":[{"id":"fixture.run","title":"Run",
                    "inputSchema":{"type":"object","properties":{"value":{"type":"string"}},
                        "required":["value"],"additionalProperties":false}}]
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        source.join("runtime/worker.js"),
        "zicode.capabilities.register('fixture.run', () => { while (true) {} });",
    )
    .unwrap();
    fs::write(source.join("views/main.html"), "<main>Fixture</main>").unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::from([("workspace-a".into(), root.clone())]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
    }
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let token = host.desktop_token();
    let directory: Value = client
        .get(format!(
            "{}/v2/plugin-tool-directory?sceneId=programming&pluginId={plugin_id}&query=absent",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(directory["items"].as_array().unwrap().len(), 0);
    let revision = directory["revision"].as_str().unwrap();
    let view: Value = client
        .get(format!(
        "{}/v2/plugin-views/source?sceneId=programming&pluginId={plugin_id}&viewId=fixture.main",
        host.origin()))
        .header("x-zicode-desktop-token", token)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view["catalogRevision"], revision);
    let detail: Value = client.get(format!(
        "{}/v2/plugin-tool-directory/detail?sceneId=programming&pluginId={plugin_id}&capabilityId=fixture.run&revision={revision}",
        host.origin()))
        .header("x-zicode-desktop-token", token).send().await.unwrap().json().await.unwrap();
    assert_eq!(detail["capability"]["id"], "fixture.run");
    let request = json!({"sceneId":"programming","workspaceId":"workspace-a",
        "pluginId":plugin_id,"capabilityId":"fixture.run","catalogRevision":revision,
        "input":{"value":"view"},"captureResult":false});
    let prepared: Value = client
        .post(format!(
            "{}/v2/plugin-capabilities/prepare-call",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&request)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(prepared["profile"], "manual.tool.call.v1");
    let call_id = prepared["callId"].as_str().unwrap();
    let control = json!({"schemaVersion":1,"callId":call_id,
        "scope":{"sceneId":"programming","workspaceId":"workspace-a",
            "pluginId":plugin_id,"capabilityId":"fixture.run"}});
    let cancelled: Value = client
        .post(format!(
            "{}/v2/plugin-capabilities/cancel-call",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cancelled["status"], "cancel_requested");
    let status: Value = client
        .post(format!(
            "{}/v2/plugin-capabilities/call-status",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(status["executionFinished"], false);
    if let Some(executable) = std::env::var_os("ZICODE_VIEW_TEST_WORKER_EXE") {
        let executable = PathBuf::from(executable);
        let expected = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/debug/zicode-studio-desktop.exe")
            .canonicalize()
            .unwrap();
        assert_eq!(executable.canonicalize().unwrap(), expected);
        let digest = sha256_hex(&fs::read(&executable).unwrap());
        let (events_tx, events_rx) = std::sync::mpsc::channel();
        {
            let mut broker = host.state.capability_broker.lock().unwrap();
            broker.worker_executable = Some(executable);
            broker.worker_observer = Some(Arc::new(move |event, pid| {
                let _ = events_tx.send((event, pid));
            }));
        }
        let running_handle: Value = client
            .post(format!(
                "{}/v2/plugin-capabilities/prepare-call",
                host.origin()
            ))
            .header("x-zicode-desktop-token", token)
            .json(&request)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let running_id = running_handle["callId"].as_str().unwrap();
        let mut invocation = request.clone();
        invocation["callId"] = json!(running_id);
        let invoke_client = client.clone();
        let invoke_url = format!("{}/v2/plugin-capabilities/invoke", host.origin());
        let invoke_token = token.to_owned();
        let running = tokio::spawn(async move {
            invoke_client
                .post(invoke_url)
                .header("x-zicode-desktop-token", invoke_token)
                .json(&invocation)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()
        });
        let (started, events_rx) = tokio::task::spawn_blocking(move || {
            let event = events_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            (event, events_rx)
        })
        .await
        .unwrap();
        assert_eq!(started.0, "started");
        let mut running_control = control.clone();
        running_control["callId"] = json!(running_id);
        let ack: Value = client
            .post(format!(
                "{}/v2/plugin-capabilities/cancel-call",
                host.origin()
            ))
            .header("x-zicode-desktop-token", token)
            .json(&running_control)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(ack["status"], "cancel_requested");
        assert_eq!(ack["executionFinished"], false);
        let outcome = running.await.unwrap();
        assert_eq!(outcome["error"]["code"], "worker_cancelled");
        let terminal: Value = client
            .post(format!(
                "{}/v2/plugin-capabilities/call-status",
                host.origin()
            ))
            .header("x-zicode-desktop-token", token)
            .json(&running_control)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(terminal["status"], "finished");
        assert_eq!(terminal["outcome"], "worker_cancelled");
        let mut events = Vec::new();
        while events.len() < 4
            && !["reaped", "pipes_closed"]
                .iter()
                .all(|event| events.contains(&(*event, started.1)))
        {
            events.push(events_rx.recv_timeout(Duration::from_secs(5)).unwrap());
        }
        for event in ["reaped", "pipes_closed"] {
            assert!(events.contains(&(event, started.1)), "{events:?}");
        }
        println!(
            "view call real Worker cancelled; exe sha256={digest}; pid={}",
            started.1
        );
    }
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, false)
            .unwrap();
    }
    let stale = client
        .post(format!(
            "{}/v2/plugin-capabilities/prepare-call",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(stale.status(), StatusCode::CONFLICT);
    let stale: Value = stale.json().await.unwrap();
    assert_eq!(stale["error"]["code"], "catalog_changed");
    let after_revocation: Value = client
        .post(format!(
            "{}/v2/plugin-capabilities/cancel-call",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&control)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(after_revocation["status"], "cancel_requested");
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

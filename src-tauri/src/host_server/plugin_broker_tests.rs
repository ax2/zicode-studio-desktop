use super::*;
use crate::metadata_store::MetadataStore;
use std::collections::BTreeMap;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires fetched embedded Pi and built extension resources"]
async fn embedded_pi_invokes_the_real_host_plugin_broker() {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let binary = manifest
        .join("resources/pi")
        .join(if cfg!(windows) { "pi.exe" } else { "pi" });
    let extension = manifest
        .join("../extensions/dist/plugin-broker.mjs")
        .canonicalize()
        .expect("run bun run build:extensions before this integration test");
    let extension = crate::process_command::working_directory(&extension);
    assert!(
        binary.is_file(),
        "run bun run fetch:pi before this integration test"
    );
    let root = std::env::temp_dir().join(format!("zicode-pi-host-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let workspace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let vault = "11111111-1111-4111-8111-111111111111";
    let notes = root
        .join("plugin-data/com.zicode.notes/vaults")
        .join(workspace)
        .join(vault)
        .join("src/content/notes");
    std::fs::create_dir_all(&notes).unwrap();
    std::fs::write(notes.join("roundtrip.md"), "---\nid: \"22222222-2222-4222-8222-222222222222\"\ntitle: \"Full Pi Host fixture\"\n---\n\nUnique roundtrip evidence.").unwrap();
    let observer = root.join("observer.ts");
    let module_url = reqwest::Url::from_file_path(&extension).unwrap();
    std::fs::write(&observer, format!(r#"import {{ setupPluginBroker }} from {};
export default function (pi) {{
  const tools = new Map();
  setupPluginBroker(new Proxy(pi, {{ get(target, key) {{
    if (key === "registerTool") return tool => {{ tools.set(tool.name, tool); target.registerTool(tool); }};
    return target[key];
  }} }}));
  pi.registerCommand("host-roundtrip", {{ handler: async (_args, ctx) => {{
    const page = (await tools.get("studio_plugin_search").execute("search-notes", {{query:"notes"}}, new AbortController().signal)).details;
    const item = page.items.find(tool => tool.name === "notes_search");
    if (!item) throw new Error("Notes tool is unavailable");
    await tools.get("studio_plugin_load").execute("load-notes", {{toolId:item.toolId, revision:page.revision}}, new AbortController().signal);
    const tool = tools.get("notes_search");
    const result = await tool.execute("real-host-call", {{ query: "Unique roundtrip" }}, new AbortController().signal);
    if (result.details?.matches?.[0]?.title !== "Full Pi Host fixture") throw new Error("Host result mismatch");
    ctx.ui.notify("real Pi Host roundtrip verified", "info");
  }} }});
}}
"#, serde_json::to_string(module_url.as_str()).unwrap())).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let target = RuntimeTarget::new(workspace, "real-session", "real-instance");
    let mut launch = NativeLaunchSpec {
        binary,
        cwd: root.clone(),
        session_path: None,
        extensions: vec![observer],
        pi_version: crate::pi_launch::locked_pi_version().into(),
        path_env: std::env::var("PATH").unwrap_or_default(),
        disable_auto_discovery: false,
        environment: BTreeMap::from([
            ("HOME".into(), root.to_string_lossy().into_owned()),
            ("USERPROFILE".into(), root.to_string_lossy().into_owned()),
            (
                "PI_CODING_AGENT_DIR".into(),
                root.join("agent").to_string_lossy().into_owned(),
            ),
        ]),
    };
    configure_plugin_broker_for_state(&host.state, &target, &mut launch).unwrap();
    assert!(launch.environment["NO_PROXY"].split(',').any(|entry| entry == "127.0.0.1"));
    assert_eq!(launch.environment["no_proxy"], launch.environment["NO_PROXY"]);
    assert_eq!(launch.environment["PI_DESKTOP_PLUGIN_CATALOG"], "1");
    assert_eq!(launch.environment["PI_DESKTOP_PLUGIN_TOOLS"], "[]");
    let mut events = host.state.runtimes.subscribe();
    host.state.runtimes.spawn(target.clone(), launch).unwrap();
    let accepted = host
        .state
        .runtimes
        .request(
            &target,
            json!({ "type": "prompt", "message": "/host-roundtrip" }),
            Some("host-roundtrip-request"),
            Duration::from_secs(20),
        )
        .await
        .unwrap();
    assert_eq!(accepted["success"], true);
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let frame = events.recv().await.unwrap();
            if frame.target == target
                && frame.event["type"] == "extension_ui_request"
                && frame.event["message"] == "real Pi Host roundtrip verified"
            {
                break;
            }
        }
    })
    .await
    .expect("Pi did not confirm the real Host search result");
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn runtime_plugin_http_enforces_identity_expiry_liveness_and_current_grants() {
    let root = std::env::temp_dir().join(format!("zicode-plugin-http-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let workspace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    let vault = "11111111-1111-4111-8111-111111111111";
    let notes = root
        .join("plugin-data/com.zicode.notes/vaults")
        .join(workspace)
        .join(vault)
        .join("src/content/notes");
    std::fs::create_dir_all(&notes).unwrap();
    std::fs::write(notes.join("broker.md"), "---\nid: \"22222222-2222-4222-8222-222222222222\"\ntitle: \"Broker fixture\"\n---\n\nRoundtrip boundary.").unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let target = RuntimeTarget::new(workspace, "session-fixture", "instance-fixture");
    let runtime = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start(public, runtimes, auth).await.unwrap();
    let mut launch = NativeLaunchSpec {
        binary: root.join("unused-pi"),
        cwd: root.clone(),
        session_path: None,
        extensions: vec![],
        pi_version: "fixture".into(),
        path_env: String::new(),
        disable_auto_discovery: false,
        environment: BTreeMap::new(),
    };
    configure_plugin_broker_for_state(&host.state, &target, &mut launch).unwrap();
    let token = launch.environment["PI_DESKTOP_PLUGIN_BROKER_TOKEN"].clone();
    assert!(host.state.plugin_tokens.lock().unwrap()[&target.instance_id].token_hash != token);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-tools/invoke", host.origin());
    let request = json!({ "runtimeId": target.instance_id, "sessionId": target.session_id,
        "toolCallId": "fixture-call", "toolName": "notes_search", "input": { "query": "Roundtrip" } });

    let missing = client.post(&endpoint).json(&request).send().await.unwrap();
    assert_eq!(missing.status(), reqwest::StatusCode::UNAUTHORIZED);
    let wrong = client
        .post(&endpoint)
        .bearer_auth("invalid-fixture")
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), reqwest::StatusCode::UNAUTHORIZED);
    let mut other_session = request.clone();
    other_session["sessionId"] = json!("other-session");
    let mismatch = client
        .post(&endpoint)
        .bearer_auth(&token)
        .json(&other_session)
        .send()
        .await
        .unwrap();
    assert_eq!(mismatch.status(), reqwest::StatusCode::UNAUTHORIZED);
    let valid = client
        .post(&endpoint)
        .bearer_auth(&token)
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(valid.status(), reqwest::StatusCode::OK);
    let result: Value = valid.json().await.unwrap();
    assert_eq!(result["result"]["matches"][0]["title"], "Broker fixture");

    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.notes", false)
        .unwrap();
    let revoked = client
        .post(&endpoint)
        .bearer_auth(&token)
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), reqwest::StatusCode::NOT_FOUND);
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", "com.zicode.notes", true)
        .unwrap();
    host.state.runtimes.stop(&target).unwrap();
    let stopped = client
        .post(&endpoint)
        .bearer_auth(&token)
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(stopped.status(), reqwest::StatusCode::GONE);
    host.state
        .plugin_tokens
        .lock()
        .unwrap()
        .get_mut(&target.instance_id)
        .unwrap()
        .expires_at = UNIX_EPOCH;
    let expired = client
        .post(&endpoint)
        .bearer_auth(&token)
        .json(&request)
        .send()
        .await
        .unwrap();
    assert_eq!(expired.status(), reqwest::StatusCode::UNAUTHORIZED);
    drop(runtime);
    drop(launch);
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

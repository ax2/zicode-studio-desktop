use super::*;
use crate::metadata_store::MetadataStore;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[test]
#[ignore = "requires receiver test-signed candidates and frozen Worker executable"]
fn actual_signed_candidate_lifecycle_rejects_tampered_rollback_and_preserves_data() {
    let root = PathBuf::from(std::env::var_os("ZICODE_TEST_SIGNED_ROOT").unwrap());
    let case = root.join(format!("case-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&case).unwrap();
    let registry_root = case.join("registry");
    let mut registry = crate::plugin_registry::PluginRegistry::open(registry_root.clone()).unwrap();
    let first = root.join("first.zicode-plugin");
    let second = root.join("second.zicode-plugin");
    let tampered = root.join("tampered.zicode-plugin");
    let plugin_id = "com.zicode.devtools.text";
    let preview = registry.preview_signed(&first).unwrap();
    assert!(!preview.trusted);
    assert!(registry
        .install_signed(&first, false)
        .unwrap_err()
        .contains("trust confirmation"));
    registry.install_signed(&first, true).unwrap();
    registry
        .set_enabled("programming", plugin_id, true)
        .unwrap();
    let mut broker =
        crate::plugin_capabilities::CapabilityBroker::new(registry_root.clone()).unwrap();
    broker.worker_executable = Some(PathBuf::from(
        std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap(),
    ));
    let invocation = || crate::plugin_capabilities::CapabilityInvocation {
        caller: "chat".into(),
        scene_id: "programming".into(),
        workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
        plugin_id: plugin_id.into(),
        capability_id: "devtools.text.base64.encode".into(),
        tool_call_id: None,
        idempotency_scope: None,
        input: json!({"text":"hello"}),
    };
    assert_eq!(
        broker.invoke(&registry, invocation()).unwrap()["data"]["text"],
        "aGVsbG8="
    );
    let data = case.join("plugin-data").join(plugin_id);
    std::fs::create_dir_all(&data).unwrap();
    std::fs::write(
        data.join("user-result.txt"),
        "User-approved retained result",
    )
    .unwrap();
    assert!(registry.install_signed(&tampered, false).is_err());
    assert_eq!(
        registry
            .list("programming")
            .into_iter()
            .find(|p| p.manifest.id == plugin_id)
            .unwrap()
            .manifest
            .version,
        "0.1.0"
    );
    registry.install_signed(&second, false).unwrap();
    assert_eq!(
        registry
            .list("programming")
            .into_iter()
            .find(|p| p.manifest.id == plugin_id)
            .unwrap()
            .manifest
            .version,
        "0.1.1"
    );
    assert_eq!(
        broker.invoke(&registry, invocation()).unwrap()["data"]["text"],
        "aGVsbG8="
    );
    assert!(registry
        .install_signed(&first, false)
        .unwrap_err()
        .contains("explicit rollback"));
    let retained_module = registry_root
        .join("signed-versions")
        .join(plugin_id)
        .join("0.1.0/runtime/tools.wasm");
    let original = std::fs::read(&retained_module).unwrap();
    let mut altered = original.clone();
    let last = altered.len() - 1;
    altered[last] ^= 1;
    std::fs::write(&retained_module, altered).unwrap();
    assert!(
        registry.rollback_signed(plugin_id, "0.1.0").is_err(),
        "Tampered retained module must not be activated"
    );
    assert_eq!(
        registry
            .list("programming")
            .into_iter()
            .find(|p| p.manifest.id == plugin_id)
            .unwrap()
            .manifest
            .version,
        "0.1.1"
    );
    std::fs::write(&retained_module, original).unwrap();
    registry.rollback_signed(plugin_id, "0.1.0").unwrap();
    assert_eq!(
        broker.invoke(&registry, invocation()).unwrap()["data"]["text"],
        "aGVsbG8="
    );
    let active_module = registry_root
        .join("signed")
        .join(plugin_id)
        .join("runtime/tools.wasm");
    let active_original = std::fs::read(&active_module).unwrap();
    let mut cached = invocation();
    cached.idempotency_scope = Some("signed-integrity-test".into());
    cached.tool_call_id = Some("cached-result".into());
    broker.invoke(&registry, cached.clone()).unwrap();
    std::fs::write(&active_module, b"tampered module").unwrap();
    assert!(registry
        .plugin_runtime_entry("programming", plugin_id)
        .is_err());
    assert!(
        broker.invoke(&registry, cached).is_err(),
        "Cached results must recheck signed integrity"
    );
    assert!(registry
        .view_document("programming", plugin_id, "devtools.text.main")
        .is_err());
    registry.reload_developer_plugins().unwrap();
    assert!(registry
        .capability("programming", plugin_id, "devtools.text.base64.encode")
        .is_none());
    std::fs::write(&active_module, active_original).unwrap();
    registry.reload_developer_plugins().unwrap();
    let active_view = registry_root
        .join("signed")
        .join(plugin_id)
        .join("views/main.html");
    let view_original = std::fs::read(&active_view).unwrap();
    std::fs::write(&active_view, "tampered view").unwrap();
    assert!(registry
        .view_document("programming", plugin_id, "devtools.text.main")
        .is_err());
    std::fs::write(&active_view, view_original).unwrap();
    let metadata_path = registry_root
        .join("signed-metadata")
        .join(format!("{plugin_id}.json"));
    let metadata_original = std::fs::read(&metadata_path).unwrap();
    let mut metadata: Value = serde_json::from_slice(&metadata_original).unwrap();
    metadata["integrity"]["files"][0]["sha256"] = json!("0".repeat(64));
    std::fs::write(&metadata_path, serde_json::to_vec(&metadata).unwrap()).unwrap();
    assert!(
        registry
            .plugin_runtime_entry("programming", plugin_id)
            .is_err(),
        "Changed proof must fail signature verification"
    );
    metadata.as_object_mut().unwrap().remove("integrity");
    std::fs::write(&metadata_path, serde_json::to_vec(&metadata).unwrap()).unwrap();
    registry.reload_developer_plugins().unwrap();
    assert!(registry
        .capability("programming", plugin_id, "devtools.text.base64.encode")
        .is_none());
    registry.install_signed(&first, false).unwrap();
    assert_eq!(
        broker.invoke(&registry, invocation()).unwrap()["data"]["text"],
        "aGVsbG8="
    );
    assert!(
        data.join("user-result.txt").is_file(),
        "Legacy repair preserves data"
    );
    registry.uninstall_developer(plugin_id).unwrap();
    assert!(registry
        .capability("programming", plugin_id, "devtools.text.base64.encode")
        .is_none());
    assert_eq!(
        std::fs::read_to_string(data.join("user-result.txt")).unwrap(),
        "User-approved retained result"
    );
    registry.install_signed(&first, false).unwrap();
    registry
        .revoke_signed_publisher(&preview.publisher_key_id)
        .unwrap();
    assert!(registry
        .install_signed(&second, false)
        .unwrap_err()
        .contains("revoked"));
    assert!(registry
        .capability("programming", plugin_id, "devtools.text.base64.encode")
        .is_none());
    assert!(data.join("user-result.txt").is_file());
    eprintln!("Actual signed candidate lifecycle verified (ephemeral receiver test key)");
    drop(broker);
    drop(registry);
    std::fs::remove_dir_all(case).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_WORKER_EXE pointing to the same-source delivered app"]
async fn devtools_candidate_invokes_real_worker_through_authenticated_http_host() {
    let executable = PathBuf::from(
        std::env::var_os("ZICODE_TEST_WORKER_EXE")
            .expect("Set ZICODE_TEST_WORKER_EXE to the delivered Studio executable"),
    );
    assert!(
        executable.is_file(),
        "Delivered Worker executable is missing"
    );
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let source = project.join("tests/fixtures/devtools-text-dev57");
    let evidence: Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-text-dev57.acceptance.json")).unwrap(),
    )
    .unwrap();
    for file in evidence["files"].as_array().unwrap() {
        let bytes = std::fs::read(source.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["bytes"].as_u64().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(&bytes)),
            file["sha256"].as_str().unwrap()
        );
    }
    let root = project
        .join(".cache/task-scratch")
        .join(format!("devtools-http-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose":"actual candidate HTTP/Worker acceptance", "lifetime":"remove on success; retain failure evidence", "pid":std::process::id()}).to_string(),
    ).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin_id = "com.zicode.devtools.text";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&source).unwrap(), plugin_id);
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let request = json!({
        "sceneId":"programming", "workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "pluginId":plugin_id, "capabilityId":"devtools.text.base64.encode",
        "input":{"text":"hello"}
    });
    assert_eq!(
        client
            .post(&endpoint)
            .json(&request)
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    let mut input = " {\"b\":2,\"a\":1} ".to_string();
    for (capability, expected) in [
        ("json.format", "{\n  \"a\": 1,\n  \"b\": 2\n}"),
        ("base64.encode", "ewogICJhIjogMSwKICAiYiI6IDIKfQ=="),
        ("base64.decode", "{\n  \"a\": 1,\n  \"b\": 2\n}"),
        ("json.minify", "{\"a\":1,\"b\":2}"),
    ] {
        let mut call = request.clone();
        call["capabilityId"] = json!(format!("devtools.text.{capability}"));
        call["input"]["text"] = json!(input);
        let started = std::time::Instant::now();
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&call)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK, "{capability}");
        let result: Value = response.json().await.unwrap();
        assert_eq!(result["result"]["ok"], true, "{capability}: {result}");
        assert_eq!(result["result"]["data"]["text"], expected);
        input = expected.to_string();
        eprintln!(
            "actual HTTP/Worker {capability}: {}ms",
            started.elapsed().as_millis()
        );
    }
    let mut digest = request.clone();
    digest["capabilityId"] = json!("devtools.text.sha256");
    digest["input"]["text"] = json!("abc");
    let response = client
        .post(&endpoint)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&digest)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let result: Value = response.json().await.unwrap();
    assert_eq!(
        result["result"]["data"]["text"],
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    let mut invalid = request.clone();
    invalid["capabilityId"] = json!("devtools.text.base64.decode");
    invalid["input"]["text"] = json!("%%%");
    let response = client
        .post(&endpoint)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&invalid)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let result: Value = response.json().await.unwrap();
    assert_eq!(result["result"]["ok"], false);
    assert_eq!(result["result"]["error"]["code"], "INVALID_ENCODING");
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin_id, false)
        .unwrap();
    let response = client
        .post(&endpoint)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&request)
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_WORKER_EXE and its frozen Pi/broker resources"]
async fn embedded_pi_invokes_candidate_worker_and_rejects_revoked_cached_tool() {
    let fill_budget = std::env::var_os("ZICODE_TEST_FILL_PLUGIN_BUDGET").is_some();
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let delivery = executable.parent().unwrap();
    let build: Value =
        serde_json::from_slice(&std::fs::read(delivery.join("BUILD.json")).unwrap()).unwrap();
    for relative in [
        "ZiCode Studio Desktop.exe",
        "pi/pi.exe",
        "extensions/plugin-broker.mjs",
    ] {
        let record = build["files"]
            .as_array()
            .unwrap()
            .iter()
            .find(|file| file["path"] == relative)
            .expect("Frozen runtime evidence missing");
        let bytes = std::fs::read(delivery.join(relative)).unwrap();
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)).to_uppercase(),
            record["sha256"]
        );
    }
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("devtools-pi-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(root.join("owner.json"), json!({"purpose":"actual candidate Pi/Host/Worker acceptance", "pid":std::process::id(), "lifetime":"remove on success; retain failure evidence"}).to_string()).unwrap();
    let extension = crate::process_command::working_directory(
        &std::env::var_os("ZICODE_TEST_CATALOG_EXTENSION")
            .map(PathBuf::from)
            .unwrap_or_else(|| delivery.join("extensions/plugin-broker.mjs"))
            .canonicalize()
            .unwrap(),
    );
    let observer = root.join("observer.ts");
    let module_url = reqwest::Url::from_file_path(&extension).unwrap();
    std::fs::write(&observer, format!(r#"import {{ setupPluginBroker }} from {};
export default function (pi) {{
  const generic = process.env.ZICODE_TEST_FILL_PLUGIN_BUDGET === "1";
  const tools = new Map();
  const catalog = new Map();
  setupPluginBroker(new Proxy(pi, {{ get(target, key) {{
    if (key === "registerTool") return tool => {{ tools.set(tool.name, tool); target.registerTool(tool); }};
    return target[key];
  }} }}));
  pi.registerCommand("devtools-accept", {{ handler: async (phase, ctx) => {{
    const before = pi.getActiveTools();
    if (phase !== "revoked") {{
      if (phase === "run" && (generic ? tools.size !== 131 : ![2, 3].includes(tools.size))) throw new Error("Unexpected startup tool count");
      const page = (await tools.get("studio_plugin_search").execute("discover-" + phase, {{query:"com.zicode.devtools.text"}}, new AbortController().signal)).details;
      if (page.items.length !== 5) throw new Error("Expected five discoverable candidate tools");
      for (const item of page.items) {{
        const admission = (await tools.get("studio_plugin_load").execute("load-" + item.name, {{toolId:item.toolId, revision:page.revision}}, new AbortController().signal)).details;
        catalog.set(item.name, {{toolId:item.toolId, revision:page.revision}});
        if (generic) {{
          if (admission.mode !== "generic" || admission.callTool !== "studio_plugin_call" || pi.getAllTools().some(tool => tool.name === item.name)) throw new Error("Generic fallback did not preserve the typed tool budget");
        }} else if (!pi.getAllTools().some(tool => tool.name === item.name) || !pi.getActiveTools().includes(item.name)) throw new Error("Actual SDK dynamic registration failed");
      }}
      if (!before.every(name => pi.getActiveTools().includes(name))) throw new Error("Existing active tools were lost");
      const cancelled = new AbortController(); cancelled.abort();
      try {{
        await tools.get("studio_plugin_search").execute("cancelled-search", {{query:"json"}}, cancelled.signal);
        throw new Error("Cancelled search unexpectedly succeeded");
      }} catch (error) {{ if (error.name !== "AbortError") throw error; }}
    }}
    const execute = async (name, id, text) => {{
      const selection = catalog.get(name);
      return generic
        ? (await tools.get("studio_plugin_call").execute(phase + "-" + id, {{...selection, input:{{text}}}}, new AbortController().signal)).details
        : (await tools.get(name).execute(phase + "-" + id, {{text}}, new AbortController().signal)).details;
    }};
    if (phase === "restored") {{
      try {{
        if (generic) {{
          await tools.get("studio_plugin_call").execute("run-candidate-cache", {{...catalog.get("devtools_text_base64_encode"), input:{{text:"hello"}}}}, new AbortController().signal);
        }} else {{
          await tools.get("devtools_text_base64_encode").execute("run-candidate-cache", {{text:"hello"}}, new AbortController().signal);
        }}
        throw new Error("Old authority cache unexpectedly succeeded");
      }} catch (error) {{ if (!String(error).includes("[idempotency_authority_changed]")) throw error; }}
    }}
    if (phase === "revoked") {{
      try {{
        await execute("devtools_text_base64_encode", "candidate-cache", "hello");
        throw new Error("Revoked cached tool unexpectedly succeeded");
      }} catch (error) {{ if (!String(error).includes("[catalog_revision_changed]")) throw error; }}
    }} else {{
      let text = " {{\"b\":2,\"a\":1}} ";
      for (const [name, expected] of [
        ["json_format", "{{\n  \"a\": 1,\n  \"b\": 2\n}}"],
        ["base64_encode", "ewogICJhIjogMSwKICAiYiI6IDIKfQ=="],
        ["base64_decode", "{{\n  \"a\": 1,\n  \"b\": 2\n}}"],
        ["json_minify", "{{\"a\":1,\"b\":2}}"]
      ]) {{
        const result = await execute("devtools_text_" + name, "candidate-" + name, text);
        if (result.ok !== true || result.data?.text !== expected) throw new Error("Candidate chain mismatch: " + name);
        text = result.data.text;
      }}
      const digest = await execute("devtools_text_sha256", "candidate-sha", "abc");
      if (digest.data?.text !== "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") throw new Error("Digest mismatch");
      const invalid = await execute("devtools_text_base64_decode", "candidate-invalid", "%%%");
      if (invalid.ok !== false || invalid.error?.code !== "INVALID_ENCODING") throw new Error("Business error mismatch");
      const cached = await execute("devtools_text_base64_encode", "candidate-cache", "hello");
      if (cached.data?.text !== "aGVsbG8=") throw new Error("Cache fixture mismatch");
    }}
    ctx.ui.notify("candidate Pi verified: " + phase, "info");
  }} }});
}}
"#, serde_json::to_string(module_url.as_str()).unwrap())).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin_id = "com.zicode.devtools.text";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .install_developer(&project.join("tests/fixtures/devtools-text-dev57"))
            .unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
        assert!(!registry
            .pi_tools("programming")
            .iter()
            .any(|tool| tool.plugin_id == plugin_id));
        registry
            .set_permission("programming", plugin_id, "pi.tools.register", true)
            .unwrap();
        assert_eq!(
            registry
                .pi_tools("programming")
                .iter()
                .filter(|tool| tool.plugin_id == plugin_id)
                .count(),
            5
        );
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable.clone());
    worker_test_observer::attach(&mut host.state.capability_broker.lock().unwrap()).unwrap();
    let target = RuntimeTarget::new(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "candidate-session",
        "candidate-instance",
    );
    let mut launch = NativeLaunchSpec {
        binary: delivery.join("pi/pi.exe"),
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
            ("NO_PROXY".into(), "127.0.0.1,localhost".into()),
        ]),
    };
    configure_plugin_broker_for_state(&host.state, &target, &mut launch).unwrap();
    if fill_budget {
        let tools: Vec<_> = (0..128).map(|index| json!({
            "pluginId":"com.synthetic.budget","capability":format!("budget.{index}"),
            "name":format!("budget_{index}"),"title":"Budget fixture",
            "description":"Never invoked","inputSchema":{"type":"object"}
        })).collect();
        launch.environment.insert("PI_DESKTOP_PLUGIN_TOOLS".into(), serde_json::to_string(&tools).unwrap());
        launch.environment.insert("ZICODE_TEST_FILL_PLUGIN_BUDGET".into(), "1".into());
    }
    let mut events = host.state.runtimes.subscribe();
    host.state.runtimes.spawn(target.clone(), launch).unwrap();
    for phase in ["run", "revoked", "restored"] {
        if phase != "run" {
            host.state
                .plugins
                .lock()
                .unwrap()
                .set_permission(
                    "programming",
                    plugin_id,
                    "pi.tools.register",
                    phase == "restored",
                )
                .unwrap();
        }
        let accepted = host
            .state
            .runtimes
            .request(
                &target,
                json!({"type":"prompt", "message":format!("/devtools-accept {phase}")}),
                Some(&format!("candidate-{phase}")),
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
                    && frame.event["message"] == format!("candidate Pi verified: {phase}")
                {
                    break;
                }
            }
        })
        .await
        .expect("Pi did not confirm candidate result/revocation");
        eprintln!("actual candidate Pi phase verified: {phase}");
    }
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

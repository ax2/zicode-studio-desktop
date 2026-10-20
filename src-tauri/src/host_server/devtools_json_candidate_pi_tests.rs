use super::*;
use crate::metadata_store::MetadataStore;
use std::collections::BTreeMap;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen JSON candidate, current Debug Worker and embedded Pi; run alone"]
async fn frozen_json_candidate_search_load_execute_and_revoke_in_embedded_pi() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let source = project.join("tests/fixtures/devtools-json-object-candidate06");
    let receipt = project.join("tests/fixtures/devtools-json-object-candidate06.verification.json");
    let output = std::process::Command::new("bun")
        .current_dir(&project)
        .arg("run")
        .arg("verify:devtools-package")
        .arg(&source)
        .arg(&receipt)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let verified: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(verified["verified"], true);
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap())
        .canonicalize()
        .unwrap();
    let delivery = executable.parent().unwrap();
    let pi_name = if cfg!(windows) { "pi.exe" } else { "pi" };
    let prepared_resources =
        std::env::var("ZICODE_TEST_PREPARED_RESOURCES").is_ok_and(|value| value == "1");
    let prepared_pi = project.join("src-tauri/resources/pi").join(pi_name);
    let bundled_pi = delivery.join("pi").join(pi_name);
    let pi_binary = if prepared_resources || !bundled_pi.is_file() {
        prepared_pi
    } else {
        bundled_pi
    };
    assert!(
        pi_binary.is_file(),
        "missing embedded Pi: {}",
        pi_binary.display()
    );
    let broker_bundle = project.join("extensions/dist/plugin-broker.mjs");
    assert!(broker_bundle.is_file());
    let root = project
        .join(".cache/task-scratch")
        .join(format!("json-candidate-pi-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose":"JSON candidate embedded Pi acceptance",
            "lifetime":"remove on success; retain failure evidence"})
        .to_string(),
    )
    .unwrap();
    let extension =
        crate::process_command::working_directory(&broker_bundle.canonicalize().unwrap());
    let module_url = reqwest::Url::from_file_path(&extension).unwrap();
    let observer = root.join("observer.ts");
    let script = r#"import { setupPluginBroker } from __BROKER_MODULE__;
export default function(pi) {
  const tools = new Map();
  setupPluginBroker(new Proxy(pi, { get(target, key) {
    if (key === "registerTool") return tool => { tools.set(tool.name, tool); target.registerTool(tool); };
    return target[key];
  }}));
  pi.registerCommand("json-candidate-check", { handler: async (phase, ctx) => {
    const toolName = "devtools_json_object_inspect";
    if (phase === "run") {
      const page = (await tools.get("studio_plugin_search").execute("json-search",
        {query:"com.zicode.devtools.json-object"}, new AbortController().signal)).details;
      const item = page.items.find(item => item.name === toolName);
      if (!item) throw new Error("JSON provider tool was not discoverable");
      await tools.get("studio_plugin_load").execute("json-load",
        {toolId:item.toolId,revision:page.revision}, new AbortController().signal);
      if (!pi.getAllTools().some(tool => tool.name === toolName))
        throw new Error("JSON provider tool did not load dynamically");
      const result = (await tools.get(toolName).execute("json-run",
        {value:{name:"Zi",enabled:true}}, new AbortController().signal)).details;
      if (result.ok !== true || result.data?.value?.name !== "Zi" ||
          result.studioResult?.resultRef?.schemaVersion !== 2 ||
          result.studioResult?.resultRef?.mimeType !== "application/json" ||
          !result.studioResult?.resultRef?.resultId)
        throw new Error("JSON provider Pi result was not captured as an object");
      ctx.ui.notify("json candidate Pi verified: run", "info");
    } else if (phase === "revoked") {
      try {
        await tools.get(toolName).execute("json-revoked",
          {value:{name:"Zi"}}, new AbortController().signal);
        throw new Error("Revoked JSON tool unexpectedly ran");
      } catch (error) {
        if (!String(error).includes("[catalog_revision_changed]")) throw error;
      }
      ctx.ui.notify("json candidate Pi verified: revoked", "info");
    } else throw new Error("Unknown check phase");
  }});
}
"#
    .replace("__BROKER_MODULE__", &serde_json::to_string(module_url.as_str()).unwrap());
    std::fs::write(&observer, script).unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin = "com.zicode.devtools.json-object";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&source).unwrap(), plugin);
        registry.set_enabled("programming", plugin, true).unwrap();
        assert!(registry
            .pi_tools("programming")
            .iter()
            .all(|tool| tool.plugin_id != plugin));
        registry
            .set_permission("programming", plugin, "pi.tools.register", true)
            .unwrap();
        assert_eq!(
            registry
                .pi_tools("programming")
                .iter()
                .filter(|tool| tool.plugin_id == plugin)
                .count(),
            1
        );
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable.clone());
    let target = RuntimeTarget::new(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "json-candidate-session",
        "json-candidate-instance",
    );
    let mut launch = NativeLaunchSpec {
        binary: pi_binary.clone(),
        cwd: root.clone(),
        session_path: None,
        extensions: vec![observer],
        pi_version: crate::pi_launch::locked_pi_version().into(),
        path_env: std::env::var("PATH").unwrap_or_default(),
        disable_auto_discovery: true,
        environment: BTreeMap::from([
            (
                "PI_CODING_AGENT_DIR".into(),
                root.join("agent").to_string_lossy().into_owned(),
            ),
            ("NO_PROXY".into(), "127.0.0.1,localhost".into()),
        ]),
    };
    configure_plugin_broker_for_state(&host.state, &target, &mut launch).unwrap();
    let mut events = host.state.runtimes.subscribe();
    host.state.runtimes.spawn(target.clone(), launch).unwrap();
    for phase in ["run", "revoked"] {
        if phase == "revoked" {
            host.state
                .plugins
                .lock()
                .unwrap()
                .set_permission("programming", plugin, "pi.tools.register", false)
                .unwrap();
        }
        let accepted = host
            .state
            .runtimes
            .request(
                &target,
                json!({"type":"prompt","message":format!("/json-candidate-check {phase}")}),
                Some(&format!("json-candidate-{phase}")),
                Duration::from_secs(30),
            )
            .await
            .unwrap();
        assert_eq!(accepted["success"], true);
        tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let frame = events.recv().await.unwrap();
                if frame.target == target
                    && frame.event["type"] == "extension_ui_request"
                    && frame.event["message"] == format!("json candidate Pi verified: {phase}")
                {
                    break;
                }
            }
        })
        .await
        .expect("Pi did not verify JSON candidate phase");
    }
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
    if let Some(path) = std::env::var_os("ZICODE_TEST_JSON_PI_RECEIPT") {
        let evidence = json!({
            "passed":true,
            "mechanismPassed":true,
            "preparedResources":prepared_resources,
            "candidateFamily":"json-object",
            "candidateIndexSha256":verified["indexSha256"],
            "capabilityCount":2,
            "piToolCount":1,
            "phaseCount":2,
            "jsonResultCaptured":true,
            "fullCandidateAccepted":false,
            "workerSha256":sha256_hex(&std::fs::read(executable).unwrap()),
            "piSha256":sha256_hex(&std::fs::read(pi_binary).unwrap()),
            "brokerSha256":sha256_hex(&std::fs::read(broker_bundle).unwrap())
        });
        std::fs::write(path, serde_json::to_vec_pretty(&evidence).unwrap()).unwrap();
    }
}

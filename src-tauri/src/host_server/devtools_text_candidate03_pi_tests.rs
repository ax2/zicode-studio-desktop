use super::*;
use crate::metadata_store::MetadataStore;
use std::collections::BTreeMap;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_WORKER_EXE and current debug pi/plugin-broker resources"]
async fn text_candidate03_new_tools_run_through_embedded_pi() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let delivery = executable.parent().unwrap();
    assert!(delivery.join("pi/pi.exe").is_file(), "missing embedded Pi");
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let broker_bundle = project.join("extensions/dist/plugin-broker.mjs");
    assert!(broker_bundle.is_file(), "build current plugin broker first");
    let source = project.join("tests/fixtures/devtools-text-candidate03");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("text-candidate03-pi-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({
            "purpose":"Text candidate03 real embedded Pi acceptance",
            "lifetime":"remove on success; retain failure evidence",
            "pid":std::process::id()
        })
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
  pi.registerCommand("candidate03-check", { handler: async (phase, ctx) => {
    if (phase === "run") {
      const page = (await tools.get("studio_plugin_search").execute("discover-text03",
        {query:"com.zicode.devtools.text"}, new AbortController().signal)).details;
      const wanted = ["devtools_text_json_validate", "devtools_text_sql_format"];
      if (page.items.length !== 7) throw new Error("Expected seven candidate tools");
      for (const name of wanted) {
        const item = page.items.find(item => item.name === name);
        if (!item) throw new Error("Missing candidate tool: " + name);
        await tools.get("studio_plugin_load").execute("load-" + name,
          {toolId:item.toolId,revision:page.revision}, new AbortController().signal);
        if (!pi.getAllTools().some(tool => tool.name === name))
          throw new Error("Dynamic Pi tool was not registered: " + name);
      }
      const sqlCall = await tools.get("devtools_text_sql_format").execute("text03-sql",
        {text:"select id,name from users where active=true"}, new AbortController().signal);
      const sql = sqlCall.details;
      if (sql.ok !== true || sql.data?.text !== "SELECT id, name\nFROM users\nWHERE active = TRUE")
        throw new Error("SQL candidate result mismatch");
      if (sql.studioResult?.pluginId !== "com.zicode.devtools.text" ||
          sql.studioResult?.capabilityId !== "devtools.text.sql.format" ||
          !sql.studioResult?.resultRef?.resultId)
        throw new Error("Pi SQL result was not captured for desktop transfer");
      const json = (await tools.get("devtools_text_json_validate").execute("text03-json",
        {text:"{\"name\":\"Zi\"}"}, new AbortController().signal)).details;
      if (json.ok !== true || json.data?.text !== "JSON 有效（插件兼容规则）")
        throw new Error("JSON candidate result mismatch");
      const invalid = (await tools.get("devtools_text_json_validate").execute("text03-invalid",
        {text:"not-json"}, new AbortController().signal)).details;
      if (invalid.ok !== false || invalid.error?.code !== "INVALID_INPUT")
        throw new Error("JSON candidate business error mismatch");
      if (invalid.studioResult) throw new Error("Business error was captured as success");
      ctx.ui.notify("candidate03 Pi verified: run:" + sql.studioResult.resultRef.resultId, "info");
    } else if (phase === "revoked") {
      try {
        await tools.get("devtools_text_sql_format").execute("text03-revoked",
          {text:"select 1"}, new AbortController().signal);
        throw new Error("Revoked tool unexpectedly ran");
      } catch (error) {
        if (!String(error).includes("[catalog_revision_changed]")) throw error;
      }
    } else throw new Error("Unknown candidate phase");
    if (phase === "revoked") ctx.ui.notify("candidate03 Pi verified: revoked", "info");
  }});
}
"#
    .replace(
        "__BROKER_MODULE__",
        &serde_json::to_string(module_url.as_str()).unwrap(),
    );
    std::fs::write(&observer, script).unwrap();
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
        assert_eq!(
            registry
                .pi_tools("programming")
                .iter()
                .filter(|tool| tool.plugin_id == plugin_id)
                .count(),
            0
        );
        registry
            .set_permission("programming", plugin_id, "pi.tools.register", true)
            .unwrap();
        assert_eq!(
            registry
                .pi_tools("programming")
                .iter()
                .filter(|tool| tool.plugin_id == plugin_id)
                .count(),
            7
        );
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable.clone());
    let target = RuntimeTarget::new(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "text-candidate03-session",
        "text-candidate03-instance",
    );
    let mut launch = NativeLaunchSpec {
        binary: delivery.join("pi/pi.exe"),
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
    let broker_token = launch.environment["PI_DESKTOP_PLUGIN_BROKER_TOKEN"].clone();
    let mut events = host.state.runtimes.subscribe();
    host.state.runtimes.spawn(target.clone(), launch).unwrap();
    for phase in ["run", "revoked"] {
        if phase == "revoked" {
            host.state
                .plugins
                .lock()
                .unwrap()
                .set_permission("programming", plugin_id, "pi.tools.register", false)
                .unwrap();
        }
        let accepted = host
            .state
            .runtimes
            .request(
                &target,
                json!({"type":"prompt", "message":format!("/candidate03-check {phase}")}),
                Some(&format!("candidate03-{phase}")),
                Duration::from_secs(30),
            )
            .await
            .unwrap();
        assert_eq!(accepted["success"], true);
        let message = tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                let frame = events.recv().await.unwrap();
                if frame.target == target
                    && frame.event["type"] == "extension_ui_request"
                    && frame.event["message"].as_str().is_some_and(|text| {
                        text.starts_with(&format!("candidate03 Pi verified: {phase}"))
                    })
                {
                    break frame.event["message"].as_str().unwrap().to_owned();
                }
            }
        })
        .await
        .expect("Pi did not confirm candidate phase");
        if phase == "run" {
            let result_id = message
                .strip_prefix("candidate03 Pi verified: run:")
                .unwrap();
            let client = reqwest::Client::builder().no_proxy().build().unwrap();
            let scope = json!({"workspaceId":target.workspace_id,"sceneId":"programming",
                "pluginId":plugin_id,"capabilityId":"devtools.text.sql.format"});
            let prepare = json!({"scope":scope,"resultId":result_id,
                "target":{"pluginId":plugin_id,"capabilityId":"devtools.text.base64.encode"},
                "field":"text"});
            let prepare_url = format!("{}/v2/plugin-results/prepare-transfer", host.origin());
            assert_eq!(
                client
                    .post(&prepare_url)
                    .bearer_auth(&broker_token)
                    .json(&prepare)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                reqwest::StatusCode::FORBIDDEN
            );
            let prepared: Value = client
                .post(&prepare_url)
                .header("x-zicode-desktop-token", host.desktop_token())
                .json(&prepare)
                .send()
                .await
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(
                prepared["preview"]["text"],
                "SELECT id, name\nFROM users\nWHERE active = TRUE"
            );
            let url = format!("{}/v2/plugin-results/commit-transfer", host.origin());
            let mut commit = json!({"scope":scope,"grantId":prepared["grantId"],"confirmed":false});
            assert_eq!(
                client
                    .post(&url)
                    .header("x-zicode-desktop-token", host.desktop_token())
                    .json(&commit)
                    .send()
                    .await
                    .unwrap()
                    .status(),
                reqwest::StatusCode::CONFLICT
            );
            commit["confirmed"] = json!(true);
            let response = client
                .post(&url)
                .header("x-zicode-desktop-token", host.desktop_token())
                .json(&commit)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::OK);
            let sent: Value = response.json().await.unwrap();
            assert_eq!(
                sent["result"]["data"]["text"],
                "U0VMRUNUIGlkLCBuYW1lCkZST00gdXNlcnMKV0hFUkUgYWN0aXZlID0gVFJVRQ=="
            );
        }
    }
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

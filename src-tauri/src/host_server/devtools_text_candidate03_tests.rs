use super::*;
use crate::metadata_store::MetadataStore;
use sha2::{Digest, Sha256};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires ZICODE_TEST_WORKER_EXE pointing to the current Studio debug EXE"]
async fn text_candidate03_new_tools_run_through_authenticated_host_worker() {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    assert!(executable.is_file());
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let source = project.join("tests/fixtures/devtools-text-candidate03");
    let receipt: Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-text-candidate03.verification.json"))
            .unwrap(),
    )
    .unwrap();
    for file in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(source.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["size"].as_u64().unwrap());
        assert_eq!(
            format!("{:x}", Sha256::digest(bytes)),
            file["sha256"].as_str().unwrap()
        );
    }

    let root = project
        .join(".cache/task-scratch")
        .join(format!("text-candidate03-http-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({
            "purpose":"Text candidate03 Host/Worker acceptance",
            "lifetime":"remove on success; retain failure evidence",
            "pid":std::process::id()
        })
        .to_string(),
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let target = RuntimeTarget::new(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "text-candidate03-session",
        "text-candidate03-runtime",
    );
    let _runtime = runtimes.register_in_memory(target.clone()).unwrap();
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
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
                .capabilities("programming")
                .iter()
                .filter(|capability| capability.plugin_id == plugin_id)
                .count(),
            7
        );
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable);
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let endpoint = format!("{}/v2/plugin-capabilities/invoke", host.origin());
    let invoke = |capability: &str, text: &str| {
        json!({
            "sceneId":"programming",
            "workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "pluginId":plugin_id,
            "capabilityId":capability,
            "input":{"text":text}
        })
    };
    let sql = invoke(
        "devtools.text.sql.format",
        "select id,name from users where active=true",
    );
    assert_eq!(
        client
            .post(&endpoint)
            .json(&sql)
            .send()
            .await
            .unwrap()
            .status(),
        reqwest::StatusCode::FORBIDDEN
    );
    let mut sql_result_ref = Value::Null;
    for (mut request, expected) in [
        (
            invoke("devtools.text.json.validate", "{\"name\":\"Zi\"}"),
            "JSON 有效（插件兼容规则）",
        ),
        (
            sql.clone(),
            "SELECT id, name\nFROM users\nWHERE active = TRUE",
        ),
    ] {
        if request["capabilityId"] == "devtools.text.sql.format" {
            request["captureResult"] = json!(true);
        }
        let response = client
            .post(&endpoint)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&request)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        let result: Value = response.json().await.unwrap();
        assert_eq!(result["result"]["ok"], true, "{result}");
        assert_eq!(result["result"]["data"]["text"], expected);
        if request["capabilityId"] == "devtools.text.sql.format" {
            sql_result_ref = result["resultRef"].clone();
            assert!(sql_result_ref["resultId"].is_string(), "{result}");
        }
    }
    let source_scope = json!({"workspaceId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "sceneId":"programming","pluginId":plugin_id,
        "capabilityId":"devtools.text.sql.format"});
    let prepare = json!({"scope":source_scope,"resultId":sql_result_ref["resultId"],
        "target":{"pluginId":plugin_id,"capabilityId":"devtools.text.base64.encode"},
        "field":"text"});
    let response = client
        .post(format!(
            "{}/v2/plugin-results/prepare-transfer",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&prepare)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let prepared: Value = response.json().await.unwrap();
    assert_eq!(
        prepared["preview"]["text"],
        "SELECT id, name\nFROM users\nWHERE active = TRUE"
    );
    let mut commit = json!({"scope":source_scope,"grantId":prepared["grantId"],
        "confirmed":false});
    let commit_url = format!("{}/v2/plugin-results/commit-transfer", host.origin());
    let response = client
        .post(&commit_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&commit)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::CONFLICT);
    commit["confirmed"] = json!(true);
    let response = client
        .post(&commit_url)
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
    assert!(sent["resultRef"]["resultId"].is_string());
    let invalid = invoke("devtools.text.json.validate", "not-json");
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
    assert_eq!(result["result"]["error"]["code"], "INVALID_INPUT");
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", plugin_id, "pi.tools.register", true)
        .unwrap();
    let token = "text-candidate03-catalog-token";
    host.state.plugin_tokens.lock().unwrap().insert(
        target.instance_id.clone(),
        RuntimePluginToken {
            token_hash: sha256_hex(token.as_bytes()),
            target: target.clone(),
            expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
        },
    );
    let search_url = format!("{}/v2/plugin-tools/catalog/search", host.origin());
    let load_url = format!("{}/v2/plugin-tools/catalog/load", host.origin());
    let invoke_url = format!("{}/v2/plugin-tools/invoke", host.origin());
    let search = json!({"schemaVersion":1,"runtimeId":target.instance_id,
        "sessionId":target.session_id,"query":"SQL 格式化"});
    let response = client
        .post(&search_url)
        .bearer_auth(token)
        .json(&search)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let page: Value = response.json().await.unwrap();
    let sql_tool = page["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| {
            item["pluginId"] == plugin_id && item["capability"] == "devtools.text.sql.format"
        })
        .unwrap();
    let load = json!({"schemaVersion":1,"runtimeId":target.instance_id,
        "sessionId":target.session_id,"revision":page["revision"],
        "toolId":sql_tool["toolId"]});
    let response = client
        .post(&load_url)
        .bearer_auth(token)
        .json(&load)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let loaded: Value = response.json().await.unwrap();
    assert_eq!(loaded["tool"]["inputSchema"]["type"], "object");
    let call = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,
        "toolCallId":"text-candidate03-sql","toolName":sql_tool["name"],
        "toolId":sql_tool["toolId"],"catalogRevision":page["revision"],
        "input":{"text":"select id,name from users where active=true"}});
    let response = client
        .post(&invoke_url)
        .bearer_auth(token)
        .json(&call)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    let result: Value = response.json().await.unwrap();
    assert_eq!(
        result["result"]["data"]["text"],
        "SELECT id, name\nFROM users\nWHERE active = TRUE"
    );
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_enabled("programming", plugin_id, false)
        .unwrap();
    let response = client
        .post(&endpoint)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&sql)
        .send()
        .await
        .unwrap();
    assert!(!response.status().is_success());
    host.stop_and_wait().await.unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

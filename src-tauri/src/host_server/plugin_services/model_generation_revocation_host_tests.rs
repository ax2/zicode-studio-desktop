use crate::host_server::{HostMode, HostServer};
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::remote_auth::RemoteAuth;
use crate::runtime_coordinator::RuntimeTarget;
use serde_json::{json, Value};
use sha2::Digest;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const WORKSPACE_ID: &str = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PLUGIN_A: &str = "com.example.model-revoke-a";
const PLUGIN_B: &str = "com.example.model-revoke-b";

fn create_plugin_package(root: &Path, plugin_id: &str) -> PathBuf {
    let package = root.join(plugin_id.replace('.', "-"));
    fs::create_dir_all(&package).unwrap();
    fs::write(
        package.join("plugin.json"),
        serde_json::to_vec(&json!({
            "schemaVersion": 2,
            "id": plugin_id,
            "name": plugin_id,
            "description": "Host model revocation isolation fixture",
            "version": "0.1.0",
            "publisher": "test",
            "engines": { "zicode": ">=0.1.0 <1.0.0", "pluginApi": "^1.0.0" },
            "requiredProfiles": {
                "model.catalog.read.v1": "=1.0.0-preview.1",
                "model.generate.v1": "=1.0.0-preview.1"
            },
            "contributes": { "commands": [], "capabilities": [], "views": [], "piTools": [] },
            "permissions": { "required": [
                { "name": "model.catalog.read", "reason": "List test models" },
                { "name": "model.generate", "reason": "Generate test output" }
            ], "optional": [] }
        }))
        .unwrap(),
    )
    .unwrap();
    package
}

fn read_model_request(stream: &mut TcpStream) -> Value {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut headers = String::new();
    loop {
        let mut line = String::new();
        assert_ne!(reader.read_line(&mut line).unwrap(), 0);
        if line == "\r\n" {
            break;
        }
        headers.push_str(&line);
    }
    assert!(headers.starts_with("POST /v1/chat/completions HTTP/1.1\r\n"));
    let content_length = headers
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().unwrap())
        })
        .unwrap_or_default();
    assert!(content_length > 0);
    let mut body = vec![0; content_length];
    reader.read_exact(&mut body).unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn write_model_response(stream: &mut TcpStream, text: &str) {
    let body = serde_json::to_vec(&json!({
        "choices":[{"message":{"content":text}}]
    }))
    .unwrap();
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .unwrap();
    stream.write_all(&body).unwrap();
}

async fn set_generation_permission(
    client: &reqwest::Client,
    host: &HostServer,
    token: &str,
    plugin_id: &str,
    granted: bool,
) {
    let response = client
        .post(format!("{}/v2/plugins/permission", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({
            "sceneId": "programming",
            "pluginId": plugin_id,
            "permission": "model.generate",
            "granted": granted
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
}

async fn set_plugin_enabled(
    client: &reqwest::Client,
    host: &HostServer,
    token: &str,
    plugin_id: &str,
    enabled: bool,
) {
    let response = client
        .post(format!("{}/v2/plugins/enablement", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&json!({
            "sceneId": "programming",
            "pluginId": plugin_id,
            "enabled": enabled
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
}

async fn prepare_grant(
    client: &reqwest::Client,
    host: &HostServer,
    token: &str,
    plugin_id: &str,
    operation_id: &str,
) -> String {
    let identity = json!({
        "schemaVersion": 1,
        "workspaceId": WORKSPACE_ID,
        "runtimeId": "model-revocation-runtime",
        "sessionId": "model-revocation-session",
        "pluginId": plugin_id
    });
    let catalog_request = json!({
        "schemaVersion": 1,
        "runtimeId": "model-revocation-runtime",
        "sessionId": "model-revocation-session",
        "pluginId": plugin_id
    });
    let catalog: Value = client
        .post(format!("{}/v2/plugin-services/models", host.origin()))
        .header("x-zicode-desktop-token", token)
        .json(&catalog_request)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let model_ref = catalog["result"]["models"][0]["modelRef"]
        .as_str()
        .unwrap_or_else(|| panic!("model catalog unavailable for {plugin_id}: {catalog}"));
    let mut prepare = identity;
    prepare["modelRef"] = json!(model_ref);
    prepare["goal"] = json!(format!("Generate for {plugin_id}"));
    prepare["materials"] = json!([]);
    prepare["maxOutputTokens"] = json!(32);
    prepare["deadlineMs"] = json!(10_000);
    prepare["operationId"] = json!(operation_id);
    let response: Value = client
        .post(format!(
            "{}/v2/plugin-services/model-generation/prepare",
            host.origin()
        ))
        .header("x-zicode-desktop-token", token)
        .json(&prepare)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    response["grantId"].as_str().unwrap().to_owned()
}

fn spawn_commit(
    client: reqwest::Client,
    host_origin: String,
    token: String,
    plugin_id: String,
    operation_id: String,
    grant_id: String,
) -> tokio::task::JoinHandle<reqwest::Response> {
    tokio::spawn(async move {
        client
            .post(format!(
                "{host_origin}/v2/plugin-services/model-generation/commit"
            ))
            .header("x-zicode-desktop-token", token)
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": WORKSPACE_ID,
                "runtimeId": "model-revocation-runtime",
                "sessionId": "model-revocation-session",
                "pluginId": plugin_id,
                "operationId": operation_id,
                "grantId": grant_id,
                "confirmed": true
            }))
            .send()
            .await
            .unwrap()
    })
}

#[tokio::test]
async fn revoking_one_plugin_during_host_model_requests_preserves_the_other() {
    const CHILD: &str = "ZICODE_MODEL_REVOCATION_HOST_TEST_CHILD";
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    if std::env::var_os(CHILD).is_none() {
        let root = scratch.join(format!("model-revoke-host-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("owner.json"),
            r#"{"purpose":"model generation Host revocation isolation","lifetime":"remove on success; keep on failure"}"#,
        )
        .unwrap();
        let output = crate::process_command::new_command(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "host_server::plugin_services::model_generation_revocation_host_tests::revoking_one_plugin_during_host_model_requests_preserves_the_other",
                "--nocapture",
            ])
            .env(CHILD, "1")
            .env("ZICODE_MODEL_REVOCATION_HOST_TEST_ROOT", &root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "stdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let canonical = fs::canonicalize(&root).unwrap();
        assert!(canonical.starts_with(fs::canonicalize(scratch).unwrap()));
        fs::remove_dir_all(canonical).unwrap();
        return;
    }

    let root = PathBuf::from(std::env::var_os("ZICODE_MODEL_REVOCATION_HOST_TEST_ROOT").unwrap());
    crate::desktop_profile::initialize([
        "--isolated-profile".into(),
        root.join("profile").into_os_string(),
    ])
    .unwrap();

    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let scene_digest = sha2::Sha256::digest(b"programming");
    let scene_key: String = scene_digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let system_root = crate::app_paths::system_root().unwrap();
    let models_path = system_root
        .join("scenes")
        .join(scene_key)
        .join("agent/models.json");
    fs::create_dir_all(models_path.parent().unwrap()).unwrap();
    fs::write(
        &models_path,
        serde_json::to_vec(&json!({"providers":{"local-fixture":{
            "api":"openai-completions",
            "baseUrl":format!("http://{address}/v1"),
            "authHeader":false,
            "models":[{"id":"studio-local-fixture","name":"Local Test Model"}]
        }}}))
        .unwrap(),
    )
    .unwrap();

    let public = root.join("public");
    let workspace = root.join("workspace");
    fs::create_dir_all(&public).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(public.join("index.html"), "model revocation fixture").unwrap();
    let runtimes = NativePiManager::new(16);
    let fake = runtimes
        .register_in_memory(RuntimeTarget::new(
            WORKSPACE_ID,
            "model-revocation-session",
            "model-revocation-runtime",
        ))
        .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::from([(WORKSPACE_ID.to_owned(), workspace)]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (plugin_id, package) in [
            (PLUGIN_A, create_plugin_package(&root, PLUGIN_A)),
            (PLUGIN_B, create_plugin_package(&root, PLUGIN_B)),
        ] {
            registry.install_developer(&package).unwrap();
            registry
                .set_permission("programming", plugin_id, "model.catalog.read", true)
                .unwrap();
            registry
                .set_permission("programming", plugin_id, "model.generate", true)
                .unwrap();
            registry
                .set_enabled("programming", plugin_id, true)
                .unwrap();
        }
    }

    let (accepted_pending_b_tx, accepted_pending_b_rx) = tokio::sync::oneshot::channel();
    let (accepted_a_tx, accepted_a_rx) = tokio::sync::oneshot::channel();
    let (accepted_b_tx, accepted_b_rx) = tokio::sync::oneshot::channel();
    let (release_b_tx, release_b_rx) = std::sync::mpsc::channel();
    let fixture = std::thread::spawn(move || {
        let (mut pending_b_stream, _) = listener.accept().unwrap();
        let pending_b_request = read_model_request(&mut pending_b_stream);
        accepted_pending_b_tx.send(()).unwrap();
        write_model_response(&mut pending_b_stream, "Pending B grant survives.");

        let (mut stream_a, _) = listener.accept().unwrap();
        let request_a = read_model_request(&mut stream_a);
        accepted_a_tx.send(()).unwrap();
        let (mut stream_b, _) = listener.accept().unwrap();
        let request_b = read_model_request(&mut stream_b);
        accepted_b_tx.send(()).unwrap();

        let mut byte = [0; 1];
        let revoke_closed_a = match stream_a.read(&mut byte) {
            Ok(0) => true,
            Err(error) => matches!(
                error.kind(),
                std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted
            ),
            Ok(_) => false,
        };
        release_b_rx
            .recv_timeout(Duration::from_secs(5))
            .expect("plugin B response was not released");
        write_model_response(&mut stream_b, "Plugin B remains active.");
        (pending_b_request, request_a, request_b, revoke_closed_a)
    });

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let token = host.desktop_token().to_owned();

    let pending_operation_a = uuid::Uuid::new_v4().to_string();
    let pending_grant_a =
        prepare_grant(&client, &host, &token, PLUGIN_A, &pending_operation_a).await;
    let pending_operation_b = uuid::Uuid::new_v4().to_string();
    let pending_grant_b =
        prepare_grant(&client, &host, &token, PLUGIN_B, &pending_operation_b).await;

    set_generation_permission(&client, &host, &token, PLUGIN_A, false).await;
    let revoked_pending = spawn_commit(
        client.clone(),
        host.origin().to_owned(),
        token.clone(),
        PLUGIN_A.to_owned(),
        pending_operation_a,
        pending_grant_a,
    )
    .await
    .unwrap();
    assert_eq!(revoked_pending.status(), reqwest::StatusCode::CONFLICT);
    let revoked_pending_body: Value = revoked_pending.json().await.unwrap();
    assert_eq!(
        revoked_pending_body["error"]["code"],
        "model_grant_unavailable"
    );

    let pending_commit_b = spawn_commit(
        client.clone(),
        host.origin().to_owned(),
        token.clone(),
        PLUGIN_B.to_owned(),
        pending_operation_b,
        pending_grant_b,
    );
    accepted_pending_b_rx.await.unwrap();
    let pending_result_b = pending_commit_b.await.unwrap();
    assert_eq!(pending_result_b.status(), reqwest::StatusCode::OK);
    let pending_result_b: Value = pending_result_b.json().await.unwrap();
    assert_eq!(
        pending_result_b["result"]["text"],
        "Pending B grant survives."
    );

    set_generation_permission(&client, &host, &token, PLUGIN_A, true).await;
    set_plugin_enabled(&client, &host, &token, PLUGIN_A, true).await;
    let operation_a = uuid::Uuid::new_v4().to_string();
    let grant_a = prepare_grant(&client, &host, &token, PLUGIN_A, &operation_a).await;
    let commit_a = spawn_commit(
        client.clone(),
        host.origin().to_owned(),
        token.clone(),
        PLUGIN_A.to_owned(),
        operation_a,
        grant_a,
    );
    accepted_a_rx.await.unwrap();

    let operation_b = uuid::Uuid::new_v4().to_string();
    let grant_b = prepare_grant(&client, &host, &token, PLUGIN_B, &operation_b).await;
    let mut commit_b = spawn_commit(
        client.clone(),
        host.origin().to_owned(),
        token.clone(),
        PLUGIN_B.to_owned(),
        operation_b,
        grant_b,
    );
    accepted_b_rx.await.unwrap();

    set_generation_permission(&client, &host, &token, PLUGIN_A, false).await;

    let revoked_result = commit_a.await.unwrap();
    assert_eq!(revoked_result.status(), reqwest::StatusCode::CONFLICT);
    let revoked_body: Value = revoked_result.json().await.unwrap();
    assert_eq!(revoked_body["error"]["code"], "model_request_cancelled");
    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut commit_b)
            .await
            .is_err()
    );

    release_b_tx.send(()).unwrap();
    let retained_result = commit_b.await.unwrap();
    assert_eq!(retained_result.status(), reqwest::StatusCode::OK);
    let retained_body: Value = retained_result.json().await.unwrap();
    assert_eq!(retained_body["result"]["text"], "Plugin B remains active.");
    let (pending_request_b, request_a, request_b, revoke_closed_a) = fixture.join().unwrap();
    assert!(pending_request_b["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains(PLUGIN_B));
    assert!(request_a["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains(PLUGIN_A));
    assert!(request_b["messages"][0]["content"]
        .as_str()
        .unwrap()
        .contains(PLUGIN_B));
    assert!(
        revoke_closed_a,
        "revocation should close plugin A's HTTP connection"
    );

    host.stop_and_wait().await.unwrap();
    drop(fake);
}

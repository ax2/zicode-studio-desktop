use super::*;
use crate::host_server::{HostMode, HostServer};
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::remote_auth::RemoteAuth;
use crate::runtime_coordinator::RuntimeTarget;
use std::fs;
use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::task::JoinHandle;

fn create_plugin_package(root: &Path, plugin_id: &str) -> PathBuf {
    let source = root.join(plugin_id.replace('.', "-"));
    fs::create_dir_all(source.join("runtime")).unwrap();
    fs::write(source.join("runtime/tools.wasm"), b"fixture").unwrap();
    fs::write(
        source.join("plugin.json"),
        serde_json::to_vec(&json!({
            "schemaVersion": 2,
            "id": plugin_id,
            "name": plugin_id,
            "description": "Host revocation isolation fixture",
            "version": "1.0.0",
            "publisher": "example",
            "engines": { "zicode": ">=0.1.0 <1.0.0", "pluginApi": "^1.0.0" },
            "runtime": { "wasi": "runtime/tools.wasm" },
            "requiredProfiles": { "service.http.get.v1": format!("={PROFILE_VERSION}") },
            "permissions": {
                "required": [],
                "optional": [{ "name": "service.http.read", "reason": "Read an explicitly confirmed service endpoint" }]
            },
            "contributes": { "commands": [{ "id": "httpHost.run", "title": "Run" }] }
        }))
        .unwrap(),
    )
    .unwrap();
    source
}

async fn prepare(
    client: &reqwest::Client,
    host: &HostServer,
    owner: &Owner,
    origin: &str,
    operation_id: &str,
) -> String {
    let response = client
        .post(format!(
            "{}/v2/plugin-services/http-get/prepare",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({
            "schemaVersion": 1,
            "workspaceId": owner.workspace_id,
            "runtimeId": owner.runtime_id,
            "sessionId": owner.session_id,
            "pluginId": owner.plugin_id,
            "origin": origin,
            "endpoint": "health",
            "operationId": operation_id
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::OK);
    response.json::<Value>().await.unwrap()["grantId"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn spawn_commit(
    client: reqwest::Client,
    host_origin: String,
    desktop_token: String,
    owner: Owner,
    operation_id: String,
    grant_id: String,
) -> JoinHandle<reqwest::Response> {
    tokio::spawn(async move {
        client
            .post(format!("{host_origin}/v2/plugin-services/http-get/commit"))
            .header("x-zicode-desktop-token", desktop_token)
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": owner.workspace_id,
                "runtimeId": owner.runtime_id,
                "sessionId": owner.session_id,
                "pluginId": owner.plugin_id,
                "operationId": operation_id,
                "grantId": grant_id,
                "confirmed": true
            }))
            .send()
            .await
            .unwrap()
    })
}

async fn read_fixture_request(stream: &mut tokio::net::TcpStream) {
    let mut request = [0u8; 4096];
    let read = stream.read(&mut request).await.unwrap();
    assert!(
        String::from_utf8_lossy(&request[..read]).starts_with("GET /actuator/health HTTP/1.1\r\n")
    );
}

async fn write_health_response(stream: &mut tokio::net::TcpStream) {
    let body = br#"{"status":"UP"}"#;
    let headers = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes()).await;
    let _ = stream.write_all(body).await;
}

#[tokio::test]
async fn revoking_one_plugin_during_host_request_preserves_another_plugin_request() {
    let root = std::env::temp_dir().join(format!(
        "zicode-http-revoke-host-e2e-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let public = root.join("public");
    let workspace = root.join("workspace");
    fs::create_dir_all(&public).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(public.join("index.html"), "host revocation fixture").unwrap();
    let plugin_a = "com.example.http-revoke-a";
    let plugin_b = "com.example.http-revoke-b";
    let source_a = create_plugin_package(&root, plugin_a);
    let source_b = create_plugin_package(&root, plugin_b);

    let workspace_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let session_id = "session-http-revocation-isolation";
    let runtime_id = "instance-http-revocation-isolation";
    let runtimes = NativePiManager::new(32);
    let fake = runtimes
        .register_in_memory(RuntimeTarget::new(workspace_id, session_id, runtime_id))
        .unwrap();
    let metadata = MetadataStore::open(&root.join("picot.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_mode(
        public,
        runtimes,
        auth,
        HashMap::from([(workspace_id.to_owned(), workspace)]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        for (id, source) in [(plugin_a, source_a), (plugin_b, source_b)] {
            registry.install_developer(&source).unwrap();
            registry.set_enabled("programming", id, true).unwrap();
            registry
                .set_permission("programming", id, "service.http.read", true)
                .unwrap();
        }
    }

    let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .await
        .unwrap();
    let service_origin = format!("http://{}", listener.local_addr().unwrap());
    let (accepted_a_tx, accepted_a_rx) = tokio::sync::oneshot::channel();
    let (accepted_b_tx, accepted_b_rx) = tokio::sync::oneshot::channel();
    let (release_a_tx, release_a_rx) = tokio::sync::oneshot::channel();
    let (release_b_tx, release_b_rx) = tokio::sync::oneshot::channel();
    let fixture = tokio::spawn(async move {
        let (mut stream_a, _) = listener.accept().await.unwrap();
        read_fixture_request(&mut stream_a).await;
        accepted_a_tx.send(()).unwrap();
        let (mut stream_b, _) = listener.accept().await.unwrap();
        read_fixture_request(&mut stream_b).await;
        accepted_b_tx.send(()).unwrap();
        let _ = release_a_rx.await;
        write_health_response(&mut stream_a).await;
        let _ = release_b_rx.await;
        write_health_response(&mut stream_b).await;
    });

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let operation_a = uuid::Uuid::new_v4().to_string();
    let operation_b = uuid::Uuid::new_v4().to_string();
    let owner_a = Owner {
        workspace_id: workspace_id.to_owned(),
        runtime_id: runtime_id.to_owned(),
        session_id: session_id.to_owned(),
        plugin_id: plugin_a.to_owned(),
    };
    let owner_b = Owner {
        workspace_id: workspace_id.to_owned(),
        runtime_id: runtime_id.to_owned(),
        session_id: session_id.to_owned(),
        plugin_id: plugin_b.to_owned(),
    };
    let grant_a = prepare(&client, &host, &owner_a, &service_origin, &operation_a).await;
    let grant_b = prepare(&client, &host, &owner_b, &service_origin, &operation_b).await;

    let commit_a = spawn_commit(
        client.clone(),
        host.origin().to_owned(),
        host.desktop_token().to_owned(),
        owner_a,
        operation_a.clone(),
        grant_a,
    );
    accepted_a_rx.await.unwrap();
    let mut commit_b = spawn_commit(
        client.clone(),
        host.origin().to_owned(),
        host.desktop_token().to_owned(),
        owner_b,
        operation_b.clone(),
        grant_b,
    );
    accepted_b_rx.await.unwrap();

    let revoked = client
        .post(format!("{}/v2/plugins/permission", host.origin()))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({
            "sceneId": "programming",
            "pluginId": plugin_a,
            "permission": "service.http.read",
            "granted": false
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(revoked.status(), reqwest::StatusCode::OK);

    release_a_tx.send(()).unwrap();
    let revoked_result = commit_a.await.unwrap();
    assert_eq!(revoked_result.status(), reqwest::StatusCode::CONFLICT);
    let revoked_error: Value = revoked_result.json().await.unwrap();
    assert_eq!(
        revoked_error["error"]["code"],
        "http_service_request_cancelled"
    );

    assert!(
        tokio::time::timeout(Duration::from_millis(100), &mut commit_b)
            .await
            .is_err()
    );
    release_b_tx.send(()).unwrap();
    let retained_result = commit_b.await.unwrap();
    assert_eq!(retained_result.status(), reqwest::StatusCode::OK);
    let retained_body: Value = retained_result.json().await.unwrap();
    assert_eq!(retained_body["result"]["data"]["status"], "UP");
    fixture.await.unwrap();

    let audit_path = root.join("test-plugin-registry/audit/http-services.jsonl");
    let audit: Vec<Value> = fs::read_to_string(audit_path)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    let completed_a = audit
        .iter()
        .find(|event| event["operationId"] == operation_a && event["phase"] == "request_completed")
        .unwrap();
    assert_eq!(completed_a["pluginId"], plugin_a);
    assert_eq!(completed_a["outcome"], "failed");
    let completed_b = audit
        .iter()
        .find(|event| event["operationId"] == operation_b && event["phase"] == "request_completed")
        .unwrap();
    assert_eq!(completed_b["pluginId"], plugin_b);
    assert_eq!(completed_b["outcome"], "succeeded");
    assert!(audit
        .iter()
        .all(|event| event.get("responseBody").is_none()));

    host.stop_and_wait().await.unwrap();
    drop(fake);
    fs::remove_dir_all(&root).unwrap();
}

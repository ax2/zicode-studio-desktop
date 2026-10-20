use super::*;
use crate::host_server::{HostMode, HostServer};
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::remote_auth::RemoteAuth;
use crate::runtime_coordinator::RuntimeTarget;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::test]
async fn frozen_spring_actuator_view_uses_confirmed_host_get() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/devtools-spring-actuator-candidate02");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!(
            "spring-actuator-host-{}",
            uuid::Uuid::new_v4().simple()
        ));
    let public = root.join("public");
    let workspace = root.join("workspace");
    fs::create_dir_all(&public).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::write(public.join("index.html"), "Spring Host fixture").unwrap();
    fs::write(
        root.join("owner.json"),
        serde_json::to_vec(&json!({
            "owner": "spring_actuator_candidate_host_tests",
            "purpose": "Isolated Host conformance for a frozen provider candidate",
            "pid": std::process::id()
        }))
        .unwrap(),
    )
    .unwrap();

    let workspace_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let session_id = "session-spring-candidate";
    let runtime_id = "instance-spring-candidate";
    let plugin_id = "com.zicode.devtools.spring-actuator";
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
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let view_url = format!(
        "{}/v2/plugin-views/source?sceneId=programming&pluginId={plugin_id}&viewId=devtools.spring-actuator.main",
        host.origin()
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&fixture).unwrap();
    }
    let disabled = client
        .get(&view_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap();
    assert_eq!(disabled.status(), reqwest::StatusCode::FORBIDDEN);
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
    }
    let view: Value = client
        .get(&view_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view["view"]["viewId"], "devtools.spring-actuator.main");
    let html = view["view"]["html"].as_str().unwrap();
    assert!(html.contains("sdk.services?.http?.get"));
    assert!(html.contains("connect-src 'none'"));

    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let prepare_url = format!("{}/v2/plugin-services/http-get/prepare", host.origin());
    let make_request = |operation_id: &str| {
        json!({
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "runtimeId": runtime_id,
            "sessionId": session_id,
            "pluginId": plugin_id,
            "origin": origin,
            "endpoint": "health",
            "operationId": operation_id
        })
    };
    let denied = client
        .post(&prepare_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&make_request(&uuid::Uuid::new_v4().to_string()))
        .send()
        .await
        .unwrap();
    assert_eq!(denied.status(), reqwest::StatusCode::FORBIDDEN);
    assert_eq!(
        denied.json::<Value>().await.unwrap()["error"]["code"],
        "permission_denied"
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_permission("programming", plugin_id, "service.http.read", true)
            .unwrap();
    }
    let operation_id = uuid::Uuid::new_v4().to_string();
    let prepared = client
        .post(&prepare_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&make_request(&operation_id))
        .send()
        .await
        .unwrap();
    assert_eq!(prepared.status(), reqwest::StatusCode::OK);
    let grant_id = prepared.json::<Value>().await.unwrap()["grantId"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        tokio::time::timeout(Duration::from_millis(75), listener.accept())
            .await
            .is_err()
    );
    let server = tokio::spawn(async move {
        let (mut stream, _) = tokio::time::timeout(Duration::from_secs(5), listener.accept())
            .await
            .unwrap()
            .unwrap();
        let mut request = [0u8; 4096];
        let size = stream.read(&mut request).await.unwrap();
        let request = String::from_utf8_lossy(&request[..size]);
        assert!(request.starts_with("GET /actuator/health HTTP/1.1\r\n"));
        assert!(!request.to_ascii_lowercase().contains("authorization:"));
        assert!(!request.to_ascii_lowercase().contains("cookie:"));
        let body = br#"{"status":"DOWN"}"#;
        let headers = format!(
            "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(headers.as_bytes()).await.unwrap();
        stream.write_all(body).await.unwrap();
    });
    let committed = client
        .post(format!(
            "{}/v2/plugin-services/http-get/commit",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "runtimeId": runtime_id,
            "sessionId": session_id,
            "pluginId": plugin_id,
            "operationId": operation_id,
            "grantId": grant_id,
            "confirmed": true
        }))
        .send()
        .await
        .unwrap();
    server.await.unwrap();
    assert_eq!(committed.status(), reqwest::StatusCode::OK);
    let result: Value = committed.json().await.unwrap();
    assert_eq!(result["result"]["status"], 503);
    assert_eq!(result["result"]["data"]["status"], "DOWN");
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, false)
            .unwrap();
    }
    let disabled_again = client
        .get(&view_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap();
    assert_eq!(disabled_again.status(), reqwest::StatusCode::FORBIDDEN);

    host.stop_and_wait().await.unwrap();
    drop(fake);
    fs::remove_dir_all(root).unwrap();
}

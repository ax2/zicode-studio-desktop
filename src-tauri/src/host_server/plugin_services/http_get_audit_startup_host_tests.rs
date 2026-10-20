use super::*;
use crate::host_server::{HostMode, HostServer};
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::remote_auth::RemoteAuth;
use crate::runtime_coordinator::RuntimeTarget;
use std::sync::Arc;

#[tokio::test]
async fn bad_http_audit_disables_only_http_service_at_host_startup() {
    let root = std::env::temp_dir().join(format!(
        "zicode-http-audit-startup-{}",
        uuid::Uuid::new_v4().simple()
    ));
    let public = root.join("public");
    let workspace = root.join("workspace");
    let source = root.join("plugin-source");
    fs::create_dir_all(&public).unwrap();
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(source.join("runtime")).unwrap();
    fs::create_dir_all(root.join("test-plugin-registry/audit/http-services.jsonl")).unwrap();
    fs::write(public.join("index.html"), "Studio host remains available").unwrap();
    fs::write(source.join("runtime/tools.wasm"), b"fixture").unwrap();
    let plugin_id = "com.example.audit-startup";
    fs::write(
        source.join("plugin.json"),
        serde_json::to_vec(&json!({
            "schemaVersion": 2,
            "id": plugin_id,
            "name": "Audit startup fixture",
            "description": "Proves HTTP service isolation",
            "version": "1.0.0",
            "publisher": "example",
            "engines": { "zicode": ">=0.1.0 <1.0.0", "pluginApi": "^1.0.0" },
            "runtime": { "wasi": "runtime/tools.wasm" },
            "requiredProfiles": { "service.http.get.v1": format!("={PROFILE_VERSION}") },
            "permissions": {
                "required": [],
                "optional": [{ "name": "service.http.read", "reason": "Read an approved endpoint" }]
            },
            "contributes": { "commands": [{ "id": "audit.run", "title": "Run" }] }
        }))
        .unwrap(),
    )
    .unwrap();

    let workspace_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let session_id = "session-http-audit-startup";
    let runtime_id = "instance-http-audit-startup";
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
    assert!(host.state.http_get_audit.is_none());
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
        registry
            .set_permission("programming", plugin_id, "service.http.read", true)
            .unwrap();
    }

    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let page = client.get(host.origin()).send().await.unwrap();
    assert_eq!(page.status(), reqwest::StatusCode::OK);
    assert!(page
        .text()
        .await
        .unwrap()
        .contains("Studio host remains available"));
    let plugins = client
        .get(format!("{}/v2/plugins?sceneId=programming", host.origin()))
        .send()
        .await
        .unwrap();
    assert_eq!(plugins.status(), reqwest::StatusCode::OK);
    let plugin_list: Value = plugins.json().await.unwrap();
    assert!(plugin_list["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .any(|plugin| plugin["id"] == plugin_id));

    let rejected_prepare = client
        .post(format!(
            "{}/v2/plugin-services/http-get/prepare",
            host.origin()
        ))
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&json!({
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "runtimeId": runtime_id,
            "sessionId": session_id,
            "pluginId": plugin_id,
            "origin": "http://127.0.0.1:9",
            "endpoint": "health",
            "operationId": uuid::Uuid::new_v4().to_string()
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(
        rejected_prepare.status(),
        reqwest::StatusCode::SERVICE_UNAVAILABLE
    );
    let error: Value = rejected_prepare.json().await.unwrap();
    assert_eq!(error["error"]["code"], "http_service_audit_unavailable");
    assert!(host
        .state
        .http_get_grants
        .lock()
        .unwrap()
        .pending
        .is_empty());
    assert!(root
        .join("test-plugin-registry/audit/http-services.jsonl")
        .is_dir());

    host.stop_and_wait().await.unwrap();
    drop(fake);
    fs::remove_dir_all(root).unwrap();
}

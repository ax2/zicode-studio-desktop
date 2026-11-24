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
    verify_candidate(Candidate::ServiceView, None).await;
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Candidate {
    ServiceView,
    DirectoryView,
}

impl Candidate {
    fn fixture(self) -> &'static str {
        match self {
            Self::ServiceView => "devtools-spring-actuator-candidate02",
            Self::DirectoryView => {
                "devtools-view-operation-2026-10-18/spring-actuator-0.1.3-candidate-01"
            }
        }
    }
}

struct LiveActuator {
    up: String,
    down: String,
}

#[cfg(windows)]
impl LiveActuator {
    fn from_environment() -> Self {
        let origin = |name| {
            let port: u16 = std::env::var(name)
                .expect("fixture port")
                .parse()
                .expect("numeric fixture port");
            assert_ne!(port, 0);
            format!("http://127.0.0.1:{port}")
        };
        let up = origin("ZICODE_ACTUATOR_UP_PORT");
        let down = origin("ZICODE_ACTUATOR_DOWN_PORT");
        assert_ne!(up, down);
        Self { up, down }
    }
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires the two disposable Spring Boot fixtures in tests/spring-actuator-conformance"]
async fn frozen_spring_actuator_view_accepts_real_spring_boot_responses() {
    verify_candidate(
        Candidate::ServiceView,
        Some(LiveActuator::from_environment()),
    )
    .await;
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires the two disposable Spring Boot fixtures in tests/spring-actuator-conformance"]
async fn frozen_spring_actuator_directory_accepts_real_spring_boot_responses() {
    verify_candidate(
        Candidate::DirectoryView,
        Some(LiveActuator::from_environment()),
    )
    .await;
}

async fn verify_directory(host: &HostServer, client: &reqwest::Client, plugin_id: &str) {
    let url = format!("{}/v2/plugin-tool-directory", host.origin());
    let catalog = |include_views| {
        client
            .get(&url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .query(&[
                ("sceneId", "programming"),
                ("pluginId", plugin_id),
                ("includeViewOperations", include_views),
            ])
    };
    let capabilities: Value = catalog("false")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(capabilities["total"], 0);
    let page: Value = catalog("true")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(page["total"], 4);
    let mut operations = Vec::new();
    for item in page["items"].as_array().unwrap() {
        assert_eq!(item["kind"], "view-operation");
        assert_eq!(item["pluginId"], plugin_id);
        assert_eq!(item["viewId"], "devtools.spring-actuator.main");
        assert_eq!(item["version"], "0.1.3");
        assert_eq!(item["enabled"], true);
        assert!(item.get("capabilityId").is_none());
        operations.push(item["operationId"].as_str().unwrap());
    }
    operations.sort_unstable();
    assert_eq!(
        operations,
        [
            "devtools.spring-actuator.health",
            "devtools.spring-actuator.info",
            "devtools.spring-actuator.metrics",
            "devtools.spring-actuator.summary",
        ]
    );

    let detail = client
        .get(format!("{url}/detail"))
        .header("x-zicode-desktop-token", host.desktop_token())
        .query(&[
            ("sceneId", "programming"),
            ("pluginId", plugin_id),
            ("capabilityId", "devtools.spring-actuator.health"),
            ("revision", page["revision"].as_str().unwrap()),
        ])
        .send()
        .await
        .unwrap();
    assert_eq!(detail.status(), reqwest::StatusCode::NOT_FOUND);
    assert_eq!(
        detail.json::<Value>().await.unwrap()["error"]["code"],
        "tool_unavailable"
    );
}

fn verify_diagnostic_report_export(
    host: &HostServer,
    workspace_id: &str,
    plugin_id: &str,
    root: &Path,
    response: &Value,
) {
    let context = crate::host_server::ResourceExportContext {
        window: "main".into(),
        workspace: workspace_id.into(),
        route: "/tool-center".into(),
    };
    let source = json!({
        "scope": {
            "workspaceId": workspace_id,
            "sceneId": "programming",
            "pluginId": plugin_id,
            "capabilityId": PROFILE,
        },
        "resultId": response["resultRef"]["resultId"],
    });
    let bytes = serde_json::to_vec(&response["result"]).unwrap();
    let digest = crate::host_server::sha256_hex(&bytes);
    assert_eq!(response["resultRef"]["contentVersion"], digest);
    assert_eq!(response["resultRef"]["byteLength"], bytes.len());
    let metadata = host
        .result_text_export_metadata(&context, source.clone())
        .unwrap();
    assert_eq!(metadata["suggestedFileName"], "actuator-response.json");
    assert_eq!(metadata["extension"], "json");
    assert_eq!(metadata["contentVersion"], digest);

    let directory = root.join("selected-output");
    fs::create_dir(&directory).unwrap();
    let destination = directory.join("saved-actuator-report.json");
    let prepare = |path: PathBuf| {
        host.prepare_result_text_export(context.clone(), source.clone(), path)
            .unwrap()["grantId"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let commit = |owner: crate::host_server::ResourceExportContext, id: &str, confirmed| {
        host.commit_result_text_export(owner, source.clone(), id.into(), confirmed)
    };
    let cancelled = prepare(destination.clone());
    host.cancel_result_text_export(context.clone(), source.clone(), cancelled.clone())
        .unwrap();
    assert!(commit(context.clone(), &cancelled, true).is_err());

    let grant = prepare(destination.clone());
    assert_eq!(
        commit(context.clone(), &grant, false).unwrap_err(),
        "result_confirmation_required"
    );
    let mut other_route = context.clone();
    other_route.route = "/another-view".into();
    assert!(commit(other_route, &grant, true).is_err());
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 0);
    let saved = commit(context.clone(), &grant, true).unwrap();
    assert_eq!(saved["receipt"]["contentVersion"], digest);
    assert_eq!(saved["receipt"]["byteLength"], bytes.len());
    assert_eq!(fs::read(&destination).unwrap(), bytes);
    assert_eq!(
        host.verify_result_text_export(context.clone(), source.clone(), grant.clone())
            .unwrap()["status"],
        "verified"
    );
    assert!(commit(context.clone(), &grant, true).is_err());
    assert_eq!(
        host.prepare_result_text_export(context.clone(), source.clone(), destination.clone())
            .unwrap_err(),
        "resource_export_conflict"
    );

    let revoked = prepare(directory.join("rejected.json"));
    host.state
        .plugins
        .lock()
        .unwrap()
        .set_permission("programming", plugin_id, "service.http.read", false)
        .unwrap();
    assert_eq!(
        commit(context, &revoked, true).unwrap_err(),
        "result_source_unavailable"
    );
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    assert_eq!(fs::read(&destination).unwrap(), bytes);
}

async fn verify_candidate(candidate: Candidate, live: Option<LiveActuator>) {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures")
        .join(candidate.fixture());
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
        assert_eq!(registry.install_developer(&fixture).unwrap(), plugin_id);
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
    if candidate == Candidate::DirectoryView {
        verify_directory(&host, &client, plugin_id).await;
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
    if candidate == Candidate::DirectoryView {
        assert!(html.contains("onOpenViewOperation"));
    }

    let listener = if live.is_none() {
        Some(
            tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
                .await
                .unwrap(),
        )
    } else {
        None
    };
    let origin = live.as_ref().map_or_else(
        || {
            format!(
                "http://{}",
                listener.as_ref().unwrap().local_addr().unwrap()
            )
        },
        |live| live.up.clone(),
    );
    let prepare_url = format!("{}/v2/plugin-services/http-get/prepare", host.origin());
    let commit_url = format!("{}/v2/plugin-services/http-get/commit", host.origin());
    let make_request = |origin: &str, endpoint: &str, operation_id: &str| {
        json!({
            "schemaVersion": 1,
            "workspaceId": workspace_id,
            "runtimeId": runtime_id,
            "sessionId": session_id,
            "pluginId": plugin_id,
            "origin": origin,
            "endpoint": endpoint,
            "operationId": operation_id
        })
    };
    let commit = |operation_id: &str, grant_id: &str, confirmed| {
        client
            .post(&commit_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&json!({
                "schemaVersion": 1,
                "workspaceId": workspace_id,
                "runtimeId": runtime_id,
                "sessionId": session_id,
                "pluginId": plugin_id,
                "operationId": operation_id,
                "grantId": grant_id,
                "confirmed": confirmed
            }))
    };
    let denied = client
        .post(&prepare_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .json(&make_request(
            &origin,
            "health",
            &uuid::Uuid::new_v4().to_string(),
        ))
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
    if let Some(live) = live {
        let read = async |origin: &str, endpoint: &str, confirmed: bool| {
            let operation = uuid::Uuid::new_v4().to_string();
            let prepared: Value = client
                .post(&prepare_url)
                .header("x-zicode-desktop-token", host.desktop_token())
                .json(&make_request(origin, endpoint, &operation))
                .send()
                .await
                .unwrap()
                .error_for_status()
                .unwrap()
                .json()
                .await
                .unwrap();
            assert_eq!(prepared["display"]["path"], format!("/actuator/{endpoint}"));
            let grant = prepared["grantId"].as_str().unwrap();
            let result = commit(&operation, grant, confirmed).send().await.unwrap();
            assert_eq!(result.status(), reqwest::StatusCode::OK);
            let result: Value = result.json().await.unwrap();
            assert!(!commit(&operation, grant, true)
                .send()
                .await
                .unwrap()
                .status()
                .is_success());
            if confirmed {
                assert_eq!(result["result"]["endpoint"], endpoint);
                // The Host requests application/json explicitly.
                assert_eq!(result["result"]["contentType"], "application/json");
            } else {
                assert_eq!(result["status"], "declined");
            }
            result
        };
        read(&live.up, "health", false).await;
        let health = read(&live.up, "health", true).await;
        assert_eq!(health["result"]["status"], 200);
        assert_eq!(health["result"]["data"]["status"], "UP");
        let info = read(&live.up, "info", true).await;
        assert_eq!(info["result"]["status"], 200);
        assert_eq!(
            info["result"]["data"]["fixture"]["marker"],
            "zicode-actuator-conformance"
        );
        let metrics = read(&live.up, "metrics", true).await;
        assert_eq!(metrics["result"]["status"], 200);
        assert!(metrics["result"]["data"]["names"]
            .as_array()
            .unwrap()
            .iter()
            .any(|name| name == "jvm.memory.used"));
        let down = read(&live.down, "health", true).await;
        assert_eq!(down["result"]["status"], 503);
        assert_eq!(down["result"]["data"]["status"], "DOWN");
        if candidate == Candidate::DirectoryView {
            verify_diagnostic_report_export(&host, workspace_id, plugin_id, &root, &down);
        }
    } else {
        let listener = listener.unwrap();
        let operation_id = uuid::Uuid::new_v4().to_string();
        let prepared = client
            .post(&prepare_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&make_request(&origin, "health", &operation_id))
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
        let committed = commit(&operation_id, &grant_id, true).send().await.unwrap();
        server.await.unwrap();
        assert_eq!(committed.status(), reqwest::StatusCode::OK);
        let result: Value = committed.json().await.unwrap();
        assert_eq!(result["result"]["status"], 503);
        assert_eq!(result["result"]["data"]["status"], "DOWN");
    }
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

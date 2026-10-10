use crate::host_server::HostServer;
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::remote_auth::RemoteAuth;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn reads_environment_for_registered_workspaces_through_the_host() {
    let root = std::env::temp_dir().join(format!("zicode-env-host-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    let project = root.join("project");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::create_dir_all(&project).unwrap();
    std::fs::write(
        project.join("package.json"),
        r#"{"engines":{"node":">=22"},"scripts":{"test":"must not execute"}}"#,
    )
    .unwrap();
    std::fs::write(
        project.join("Cargo.toml"),
        "[package]\nrust-version='1.88'\n",
    )
    .unwrap();
    std::fs::write(
        project.join("go.mod"),
        "module example.invalid/local\ngo 1.23\ntoolchain go1.23.4\n",
    )
    .unwrap();
    std::fs::write(
        project.join("pyproject.toml"),
        "[project]\nrequires-python='>=3.0'\n[build-system]\nbuild-backend='must not execute'\n",
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_workspaces(
        public,
        NativePiManager::new(8),
        auth,
        std::collections::HashMap::from([("registered".into(), project)]),
    )
    .await
    .unwrap();
    let (mut socket, _) =
        tokio_tungstenite::connect_async(host.origin().replace("http://", "ws://") + "/v2/ws")
            .await
            .unwrap();
    socket
        .send(Message::Text(
            json!({"type":"hello", "protocolVersion":2,
        "clientType":"desktop", "desktopToken":host.desktop_token(), "clientId":"environment-test"})
            .to_string(),
        ))
        .await
        .unwrap();
    socket.next().await.unwrap().unwrap();
    for workspace in ["registered", "missing"] {
        socket
            .send(Message::Text(
                json!({"type":"data_request", "requestId":workspace,
            "operation":"workspace_environment", "workspaceId":workspace,
            "path":root, "command":"must not execute"})
                .to_string(),
            ))
            .await
            .unwrap();
        let response = tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["requestId"] == workspace {
                        break value;
                    }
                }
            }
        })
        .await
        .unwrap();
        if workspace == "missing" {
            assert_eq!(response["error"]["code"], "workspace_not_found");
        } else {
            let report = &response["report"];
            assert_eq!(report["platform"], std::env::consts::OS);
            assert_eq!(report["architecture"], std::env::consts::ARCH);
            assert_eq!(report["piVersion"], crate::pi_launch::locked_pi_version());
            assert_eq!(
                report["manifests"][0]["requirements"][0]["constraint"],
                ">=22"
            );
            let tools = report["tools"].as_array().unwrap();
            assert_eq!(
                tools
                    .iter()
                    .map(|tool| tool["id"].as_str().unwrap())
                    .collect::<Vec<_>>(),
                vec!["git", "node", "bun", "deno", "python", "ruby", "bundle", "php", "composer", "cargo", "go", "cmake", "ctest", "make", "java", "mvn", "gradle", "poetry", "uv", "dotnet", "npm", "pnpm", "yarn", "rustc"]
            );
            assert_eq!(report["manifests"][1]["requirements"][0]["tool"], "rustc");
            assert_eq!(
                report["manifests"][1]["requirements"][0]["constraint"],
                "1.88"
            );
            assert_eq!(
                report["manifests"][3]["requirements"][1]["kind"],
                "recommended"
            );
            let python = tools.iter().find(|tool| tool["id"] == "python").unwrap();
            let python_requirement = &report["manifests"][2]["requirements"][0];
            assert_eq!(python_requirement["kind"], "pep440");
            assert_eq!(python_requirement["constraint"], ">=3.0");
            assert_eq!(
                python_requirement["assessment"]["observedVersion"],
                python["version"]
            );
            assert!([
                "satisfied",
                "mismatch",
                "missing",
                "unavailable",
                "unknown-version"
            ]
            .contains(&python_requirement["assessment"]["status"].as_str().unwrap()));
            assert!(tools
                .iter()
                .all(|tool| ["ready", "missing", "failed", "timeout"]
                    .contains(&tool["status"].as_str().unwrap())));
            assert!(!report.to_string().contains("must not execute"));
        }
    }
    socket.close(None).await.unwrap();
    host.stop_and_wait().await.unwrap();
    // The host may briefly retain its SQLite connection after shutdown.
    for _ in 0..20 {
        if std::fs::remove_dir_all(&root).is_ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("temporary environment fixture remained locked");
}

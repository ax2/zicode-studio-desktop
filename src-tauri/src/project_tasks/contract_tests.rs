use super::tests::{assert_child_exited, child_pid, Fixture};
use crate::{
    host_server::HostServer, metadata_store::MetadataStore, native_pi_manager::NativePiManager,
    remote_auth::RemoteAuth,
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::{tungstenite::Message, MaybeTlsStream, WebSocketStream};

type Socket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

async fn request(socket: &mut Socket, frame: Value) -> Value {
    socket.send(Message::Text(frame.to_string())).await.unwrap();
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
                let value: Value = serde_json::from_str(&text).unwrap();
                if value["requestId"] == frame["requestId"] {
                    return value;
                }
            }
        }
    })
    .await
    .expect("host response deadline")
}

#[tokio::test]
async fn discovers_starts_observes_and_cleans_up_tasks_through_the_real_host() {
    let fixture = Fixture::runnable();
    let public = fixture.0.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let metadata = MetadataStore::open(&fixture.0.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_workspaces(
        public,
        NativePiManager::new(8),
        auth,
        std::collections::HashMap::from([("project".into(), fixture.0.clone())]),
    )
    .await
    .unwrap();
    let (mut socket, _) =
        tokio_tungstenite::connect_async(host.origin().replace("http://", "ws://") + "/v2/ws")
            .await
            .unwrap();
    socket.send(Message::Text(json!({"type":"hello", "protocolVersion":2, "clientType":"desktop", "desktopToken":host.desktop_token(), "clientId":"task-contract"}).to_string())).await.unwrap();
    socket.next().await.unwrap().unwrap();

    let missing = request(&mut socket, json!({"type":"data_request", "requestId":"missing", "operation":"project_task_catalog", "workspaceId":"missing", "path":fixture.0})).await;
    assert_eq!(missing["error"]["code"], "workspace_not_found");
    let catalog = request(&mut socket, json!({"type":"data_request", "requestId":"catalog", "operation":"project_task_catalog", "workspaceId":"project"})).await;
    assert_eq!(catalog["catalog"]["manager"], "bun");
    let fingerprint = &catalog["catalog"]["fingerprint"];
    let stale = request(&mut socket, json!({"type":"host_request", "requestId":"stale", "operation":"start_project_task", "workspaceId":"project", "name":"ok", "fingerprint":"stale"})).await;
    assert_eq!(stale["error"]["message"], "task_catalog_changed");
    let started = request(&mut socket, json!({"type":"host_request", "requestId":"start", "operation":"start_project_task", "workspaceId":"project", "name":"ok", "fingerprint":fingerprint, "command":"must not execute", "path":"invalid override"})).await;
    assert_eq!(started["run"]["status"], "running");
    let run_id = &started["run"]["id"];
    let finished = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let history = request(&mut socket, json!({"type":"data_request", "requestId":"history", "operation":"project_task_runs", "workspaceId":"project"})).await;
            let run = &history["runs"][0];
            assert_eq!(run["id"], *run_id);
            if run["finishedAt"].is_number() { break run.clone(); }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.unwrap();
    assert_eq!(finished["status"], "succeeded");
    assert_eq!(finished["exitCode"], 0);
    assert!(finished["stdout"]
        .as_str()
        .unwrap()
        .contains("fixture-output"));

    let sub = fixture.0.join("service");
    std::fs::create_dir(&sub).unwrap();
    std::fs::copy(fixture.0.join("package.json"), sub.join("package.json")).unwrap();
    std::fs::write(
        sub.join("task.cjs"),
        "require('node:fs').writeFileSync('nested-ran', 'yes'); console.log('nested-host')",
    )
    .unwrap();
    let directories = request(&mut socket, json!({"type":"data_request", "requestId":"directories", "operation":"project_task_directories", "workspaceId":"project"})).await;
    assert!(directories["discovery"]["directories"]
        .as_array()
        .unwrap()
        .iter()
        .any(|item| item["path"] == "service"));
    let invalid = request(&mut socket, json!({"type":"data_request", "requestId":"outside", "operation":"project_task_catalog", "workspaceId":"project", "directory":"../outside"})).await;
    assert_eq!(invalid["error"]["message"], "task_directory_invalid");
    let nested = request(&mut socket, json!({"type":"data_request", "requestId":"nested-preview", "operation":"project_task_catalog", "workspaceId":"project", "directory":"service"})).await;
    let started = request(&mut socket, json!({"type":"host_request", "requestId":"nested-start", "operation":"start_project_task", "workspaceId":"project", "directory":"service", "name":"ok", "fingerprint":nested["catalog"]["fingerprint"]})).await;
    assert_eq!(started["run"]["directory"], "service");
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let history = request(&mut socket, json!({"type":"data_request", "requestId":"nested-history", "operation":"project_task_runs", "workspaceId":"project"})).await;
            if history["runs"][0]["finishedAt"].is_number() {
                assert_eq!(history["runs"][0]["status"], "succeeded");
                assert_eq!(history["runs"][0]["directory"], "service");
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.unwrap();
    assert!(sub.join("nested-ran").is_file());
    assert!(!fixture.0.join("nested-ran").exists());

    let watch = request(&mut socket, json!({"type":"host_request", "requestId":"watch", "operation":"start_project_task", "workspaceId":"project", "name":"watch", "fingerprint":fingerprint})).await;
    assert_eq!(watch["run"]["status"], "running");
    let pid = child_pid(&fixture).await;
    let stopped = request(&mut socket, json!({"type":"host_request", "requestId":"stop", "operation":"stop_project_task", "workspaceId":"project", "runId":watch["run"]["id"]})).await;
    assert_eq!(stopped["run"]["status"], "stopping");
    tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let history = request(&mut socket, json!({"type":"data_request", "requestId":"stopped-history", "operation":"project_task_runs", "workspaceId":"project"})).await;
            if history["runs"][0]["status"] == "cancelled" { break; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.unwrap();
    assert_child_exited(&fixture, pid).await;
    // Remove only fixture-owned markers so a second run cannot reuse the old PID.
    std::fs::remove_file(fixture.0.join("child.pid")).unwrap();
    std::fs::remove_file(fixture.0.join("heartbeat")).unwrap();
    let watch = request(&mut socket, json!({"type":"host_request", "requestId":"watch-again", "operation":"start_project_task", "workspaceId":"project", "name":"watch", "fingerprint":fingerprint})).await;
    assert_eq!(watch["run"]["status"], "running");
    let pid = child_pid(&fixture).await;
    socket.close(None).await.unwrap();
    host.stop_and_wait().await.unwrap();
    assert_child_exited(&fixture, pid).await;

    // A new Host instance must reopen the same metadata without reviving a process.
    let metadata = MetadataStore::open(&fixture.0.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let restarted = HostServer::start_with_workspaces(
        fixture.0.join("public"),
        NativePiManager::new(8),
        auth,
        std::collections::HashMap::from([("project".into(), fixture.0.clone())]),
    )
    .await
    .unwrap();
    let (mut socket, _) =
        tokio_tungstenite::connect_async(restarted.origin().replace("http://", "ws://") + "/v2/ws")
            .await
            .unwrap();
    socket.send(Message::Text(json!({"type":"hello", "protocolVersion":2, "clientType":"desktop", "desktopToken":restarted.desktop_token(), "clientId":"history-contract"}).to_string())).await.unwrap();
    socket.next().await.unwrap().unwrap();
    let history = request(&mut socket, json!({"type":"data_request", "requestId":"reopened", "operation":"project_task_runs", "workspaceId":"project"})).await;
    assert_eq!(history["historyStatus"], "persistent");
    let runs = history["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 4);
    assert!(runs
        .iter()
        .all(|run| run["historical"] == true && run["stdout"] == "" && run["command"] == ""));
    let stopped = runs
        .iter()
        .find(|run| run["id"] == watch["run"]["id"])
        .unwrap();
    assert_eq!(stopped["status"], "cancelled");
    assert!(stopped["finishedAt"].is_number());
    let missing = request(&mut socket, json!({"type":"host_request", "requestId":"clear-missing", "operation":"clear_project_task_history", "workspaceId":"missing", "path":fixture.0})).await;
    assert_eq!(missing["error"]["code"], "workspace_not_found");
    let cleared = request(&mut socket, json!({"type":"host_request", "requestId":"clear", "operation":"clear_project_task_history", "workspaceId":"project"})).await;
    assert_eq!(cleared["cleared"], true);
    let history = request(&mut socket, json!({"type":"data_request", "requestId":"cleared-history", "operation":"project_task_runs", "workspaceId":"project"})).await;
    assert!(history["runs"].as_array().unwrap().is_empty());
    socket.close(None).await.unwrap();
    restarted.stop_and_wait().await.unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn launches_cmd_shims_from_paths_with_spaces_and_shell_metacharacters() {
    let fixture = Fixture::runnable();
    let folder = fixture.0.join("manager & tools");
    std::fs::create_dir_all(&folder).unwrap();
    let shim = folder.join("fixture manager.cmd");
    std::fs::write(
        &shim,
        "@echo off\r\nif \"%~1\"==\"--version\" (\r\necho 1.2.3\r\nexit /b 0\r\n)\r\nif not \"%~1\"==\"run\" exit /b 9\r\necho %~2\r\nexit /b 0\r\n",
    )
    .unwrap();
    for (mut command, expected) in [
        (
            super::catalog::command(&shim, "build:dev").unwrap(),
            "build:dev",
        ),
        (
            super::catalog::version_command(&shim, "--version").unwrap(),
            "1.2.3",
        ),
    ] {
        command
            .current_dir(&fixture.0)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        super::process_tree::prepare(&mut command);
        let child = tokio::process::Command::from(command)
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let _tree = super::process_tree::ProcessTree::attach(&child).unwrap();
        let output = tokio::time::timeout(Duration::from_secs(5), child.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), expected);
    }
    assert!(super::catalog::command(&shim, "build&other").is_err());
}

use super::*;
use crate::project_tasks::{catalog, TaskRunner};
use std::time::Duration;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("zicode-tool-paths-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("tools with spaces")).unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn directories(&self) -> Vec<String> {
        vec![self
            .0
            .join("tools with spaces")
            .to_string_lossy()
            .into_owned()]
    }
    fn environment(&self) -> Environment {
        Environment::new(Settings {
            revision: 1,
            directories: self.directories(),
            python_environment: None,
        })
        .unwrap()
    }
    fn tool(&self, name: &str, windows: &str, unix: &str) -> PathBuf {
        let path = self.0.join("tools with spaces").join(if cfg!(windows) {
            format!("{name}.cmd")
        } else {
            name.into()
        });
        std::fs::write(&path, if cfg!(windows) { windows } else { unix }).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        assert!(self
            .0
            .starts_with(std::env::temp_dir().canonicalize().unwrap()));
        for _ in 0..60 {
            if std::fs::remove_dir_all(&self.0).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(std::thread::panicking(), "tool fixture remained locked");
    }
}

#[test]
fn persists_scoped_settings_and_rejects_stale_writes() {
    let f = Fixture::new();
    let file = f.0.join("settings.sqlite3");
    let store = Store::open(&file);
    assert_eq!(store.read(&f.0, "one").unwrap().revision, 0);
    let saved = store.save(&f.0, "one", 0, f.directories()).unwrap();
    assert_eq!(saved.revision, 1);
    assert_eq!(store.read(&f.0, "two").unwrap().revision, 0);
    assert_eq!(
        store
            .read(&f.0.join("tools with spaces"), "one")
            .unwrap()
            .revision,
        0
    );
    let other = Store::open(&file);
    assert_eq!(
        other.read(&f.0, "one").unwrap().directories,
        saved.directories
    );
    assert_eq!(
        other.save(&f.0, "one", 0, vec![]).unwrap_err(),
        "project_environment_conflict"
    );
    assert_eq!(other.save(&f.0, "one", 1, vec![]).unwrap().revision, 2);
    assert!(store.read(&f.0, "one").unwrap().directories.is_empty());
}

#[test]
fn validates_paths_and_does_not_fall_back_after_saved_directory_disappears() {
    let f = Fixture::new();
    for directories in [
        vec!["relative".into()],
        vec![f.0.join("missing").to_string_lossy().into_owned()],
        vec![f.directories()[0].clone(); 9],
    ] {
        assert!(validate(&directories).is_err());
    }
    let store = Store::open(&f.0.join("settings.sqlite3"));
    store.save(&f.0, "one", 0, f.directories()).unwrap();
    std::fs::remove_dir(f.0.join("tools with spaces")).unwrap();
    assert!(store.resolve(&f.0, "one").is_err());
    assert_eq!(store.read(&f.0, "one").unwrap().revision, 1);
    assert!(store.save(&f.0, "one", 1, vec![]).is_ok());
    let unavailable = Store::open(&f.0.join("missing").join("settings.sqlite3"));
    assert!(unavailable.read(&f.0, "one").is_err());
}

#[tokio::test]
async fn diagnostics_and_real_commands_use_the_selected_tool_and_child_path() {
    let f = Fixture::new();
    let path = f.tool(
        "bun",
        "@echo off\r\necho tool-path-fixture\r\necho %PATH%\r\n",
        "#!/bin/sh\nprintf 'tool-path-fixture\\n%s\\n' \"$PATH\"\n",
    );
    std::fs::write(
        f.0.join("package.json"),
        r#"{"packageManager":"bun@1.3.14","scripts":{"check":"fixture"}}"#,
    )
    .unwrap();
    let environment = f.environment();
    let second = Fixture::new();
    let second_tool = second.tool(
        "bun",
        "@echo off\r\necho second\r\n",
        "#!/bin/sh\nprintf second\n",
    );
    let ordered = Environment::new(Settings {
        revision: 2,
        directories: [second.directories(), f.directories()].concat(),
        python_environment: None,
    })
    .unwrap();
    assert_eq!(
        ordered.selected(&["bun"]).unwrap().canonicalize().unwrap(),
        second_tool.canonicalize().unwrap()
    );
    assert_eq!(
        environment.selected(&["bun"]).unwrap().file_name(),
        path.file_name()
    );
    let report = crate::host_data::environment::inspect_with_environment(&f.0, &environment).await;
    let bun = report.tools.iter().find(|tool| tool.id == "bun").unwrap();
    assert_eq!(bun.version.as_deref(), Some("tool-path-fixture"), "{bun:?}");
    let runner = TaskRunner::default();
    let old = catalog::read_in(&f.0, &f.0).unwrap();
    assert!(runner
        .start_with_environment(&f.0, "one", "", "check", &old.fingerprint, &environment)
        .is_err());
    let catalog = catalog::read_with_environment(&f.0, &f.0, &environment).unwrap();
    runner
        .start_with_environment(&f.0, "one", "", "check", &catalog.fingerprint, &environment)
        .unwrap();
    let run = tokio::time::timeout(Duration::from_secs(8), async {
        loop {
            let run = runner.list("one").remove(0);
            if run.finished_at.is_some() {
                break run;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(run.status, "succeeded");
    assert!(run.stdout.contains("tool-path-fixture"));
    assert!(run.stdout.contains("tools with spaces"));
    assert!(run.executable.contains("tools with spaces"));
    runner.stop_all();
    runner.completion_tracker().wait().await;
}

#[tokio::test]
async fn new_pty_receives_project_path_without_mutating_host_path() {
    let f = Fixture::new();
    f.tool(
        "zicode-path-probe",
        "@echo off\r\necho selected>terminal-path-marker\r\n",
        "#!/bin/sh\nprintf selected > terminal-path-marker\n",
    );
    let previous = std::env::var_os("PATH");
    let manager = crate::project_terminal::TerminalManager::default();
    let info = manager
        .open_with_environment(&f.0, "one", 80, 24, &f.environment())
        .unwrap();
    let completed = tokio::time::timeout(Duration::from_secs(12), async {
        use base64::Engine;
        let mut offset = 0;
        let mut terminal_output = String::new();
        let mut shell_ready = !cfg!(windows);
        let mut command_sent = false;
        while !f.0.join("terminal-path-marker").exists() {
            let (_, chunk) = manager.read(&f.0, "one", &info.id, offset).unwrap();
            offset = chunk.next_offset;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(chunk.data)
                .unwrap();
            terminal_output.push_str(&String::from_utf8_lossy(&bytes));
            // PowerShell initializes PSReadLine before its first prompt and can
            // discard input sent during that initialization. Type as a user
            // would after the prompt, within the same overall test deadline.
            shell_ready |= terminal_output.contains("PS ") && terminal_output.contains("> ");
            // Emulate the terminal client: PSReadLine can wait for a cursor
            // position response before accepting the queued fixture command.
            while let Some(index) = terminal_output.find("\x1b[6n") {
                manager
                    .input(&f.0, "one", &info.id, b"\x1b[1;1R".to_vec())
                    .unwrap();
                terminal_output.drain(..index + 4);
            }
            if shell_ready && !command_sent {
                manager
                    .input(
                        &f.0,
                        "one",
                        &info.id,
                        if cfg!(windows) {
                            b"zicode-path-probe\r".to_vec()
                        } else {
                            b"zicode-path-probe\n".to_vec()
                        },
                    )
                    .unwrap();
                command_sent = true;
            }
            tokio::time::sleep(Duration::from_millis(30)).await;
        }
    })
    .await;
    if completed.is_err() {
        use base64::Engine;
        let (_, chunk) = manager.read(&f.0, "one", &info.id, 0).unwrap();
        panic!(
            "tool fixture did not write marker: {}",
            String::from_utf8_lossy(
                &base64::engine::general_purpose::STANDARD
                    .decode(chunk.data)
                    .unwrap()
            )
        );
    }
    assert!(std::fs::read_to_string(f.0.join("terminal-path-marker"))
        .unwrap()
        .contains("selected"));
    assert_eq!(std::env::var_os("PATH"), previous);
    manager.stop_all();
    tokio::time::timeout(Duration::from_secs(8), manager.completion_tracker().wait())
        .await
        .unwrap();
}

#[test]
fn remote_clients_cannot_read_or_modify_machine_tool_paths() {
    use serde_json::json;
    let mut router = crate::host_router::HostRouter::new();
    router.connect("phone", &json!({"type":"hello", "protocolVersion":2, "clientType":"remote", "clientId":"phone"})).unwrap();
    for operation in ["project_environment_get", "project_environment_save"] {
        assert_eq!(router.route("phone", &json!({"type":"host_request", "requestId":"env", "operation":operation, "workspaceId":"one"})).unwrap_err().code, "remote_operation_forbidden");
    }
}

#[tokio::test]
async fn real_host_persists_paths_and_rejects_missing_workspace_and_stale_catalog() {
    use crate::{
        host_server::HostServer, metadata_store::MetadataStore, native_pi_manager::NativePiManager,
        remote_auth::RemoteAuth,
    };
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};
    use tokio_tungstenite::{tungstenite::Message, MaybeTlsStream, WebSocketStream};
    async fn request(
        socket: &mut WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>,
        frame: Value,
    ) -> Value {
        socket.send(Message::Text(frame.to_string())).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
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
        .unwrap()
    }
    let f = Fixture::new();
    f.tool(
        "bun",
        "@echo off\r\necho host-path-fixture\r\n",
        "#!/bin/sh\nprintf 'host-path-fixture\\n'\n",
    );
    std::fs::write(
        f.0.join("package.json"),
        r#"{"packageManager":"bun@1.3.14","scripts":{"check":"fixture"}}"#,
    )
    .unwrap();
    let public = f.0.join("public");
    std::fs::create_dir(&public).unwrap();
    let metadata = MetadataStore::open(&f.0.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start_with_workspaces(
        public,
        NativePiManager::new(8),
        auth,
        std::collections::HashMap::from([("project".into(), f.0.clone())]),
    )
    .await
    .unwrap();
    let (mut socket, _) =
        tokio_tungstenite::connect_async(host.origin().replace("http://", "ws://") + "/v2/ws")
            .await
            .unwrap();
    socket.send(Message::Text(json!({"type":"hello", "protocolVersion":2, "clientType":"desktop", "desktopToken":host.desktop_token(), "clientId":"tool-paths-contract"}).to_string())).await.unwrap();
    socket.next().await.unwrap().unwrap();
    let old = request(&mut socket, json!({"type":"data_request", "operation":"project_task_catalog", "requestId":"catalog", "workspaceId":"project"})).await;
    let missing = request(&mut socket, json!({"type":"host_request", "operation":"project_environment_save", "requestId":"missing", "workspaceId":"unknown", "root":f.0, "revision":0, "directories":f.directories()})).await;
    assert_eq!(missing["error"]["code"], "workspace_not_found");
    let saved = request(&mut socket, json!({"type":"host_request", "operation":"project_environment_save", "requestId":"save", "workspaceId":"project", "revision":0, "directories":f.directories()})).await;
    assert_eq!(saved["settings"]["revision"], 1);
    let loaded = request(&mut socket, json!({"type":"host_request", "operation":"project_environment_get", "requestId":"read", "workspaceId":"project"})).await;
    assert_eq!(loaded["settings"], saved["settings"]);
    let stale = request(&mut socket, json!({"type":"host_request", "operation":"start_project_task", "requestId":"stale", "workspaceId":"project", "name":"check", "fingerprint":old["catalog"]["fingerprint"]})).await;
    assert_eq!(stale["error"]["message"], "task_catalog_changed");
    let report = request(&mut socket, json!({"type":"data_request", "operation":"workspace_environment", "requestId":"inspect", "workspaceId":"project"})).await;
    let bun = report["report"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["id"] == "bun")
        .unwrap();
    assert_eq!(bun["version"], "host-path-fixture");
    let conflict = request(&mut socket, json!({"type":"host_request", "operation":"project_environment_save", "requestId":"conflict", "workspaceId":"project", "revision":0, "directories":[]})).await;
    assert_eq!(conflict["error"]["message"], "project_environment_conflict");
    socket.close(None).await.unwrap();
    host.stop_and_wait().await.unwrap();
}

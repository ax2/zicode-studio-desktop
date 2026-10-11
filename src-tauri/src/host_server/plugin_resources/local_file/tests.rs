use super::*;
use futures_util::{SinkExt, StreamExt};
use std::fs;
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch")
            .join(format!("local-file-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("owner.json"),
            br#"{"purpose":"local file resource acceptance; remove own fixture on success"}"#,
        )
        .unwrap();
        Self(root.canonicalize().unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if !std::thread::panicking() {
            let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../.cache/task-scratch")
                .canonicalize()
                .unwrap();
            assert!(self.0.starts_with(scratch));
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
}
fn owner() -> Owner {
    Owner {
        runtime_id: "runtime".into(),
        session_id: "session".into(),
        plugin_id: "plugin".into(),
        capability_id: "cap".into(),
    }
}
fn grant(root: &Path) -> Grant {
    Grant {
        owner: owner(),
        proof: "proof".into(),
        root: root.into(),
        relative: "file".into(),
        stamp: "stamp".into(),
        expires: Instant::now() + TTL,
    }
}
fn request(id: String) -> FileGrant {
    FileGrant {
        schema_version: 1,
        owner: owner(),
        grant_id: id,
        confirmed: true,
    }
}

#[test]
fn portable_names_and_schemas_never_accept_paths_or_extra_authority() {
    for value in [
        "", "/a", "../a", "a/../b", "a//b", "C:/a", "a\\b", "a:stream", "a\0b", "a.", "a ",
        "NUL.txt", "COM1", "a/*",
    ] {
        assert!(files::components(value).is_err(), "{value:?}");
    }
    assert!(files::components("中文 空格&/a.zip").is_ok());
    let mut value =
        json!({"schemaVersion":1,"owner":owner(),"relativePath":"a.zip","path":"outside"});
    assert!(serde_json::from_value::<PrepareFile>(value.clone()).is_err());
    value.as_object_mut().unwrap().remove("path");
    assert!(serde_json::from_value::<PrepareFile>(value).is_ok());
}
#[test]
fn snapshots_are_bound_to_identity_length_and_version_and_never_follow_links() {
    let f = Fixture::new();
    fs::write(f.0.join("file"), b"abcd").unwrap();
    let (stamp, len) = files::stamp(&files::open(&f.0, "file").unwrap()).unwrap();
    assert_eq!(len, 4);
    assert_eq!(files::snapshot(&f.0, "file", &stamp).unwrap(), b"abcd");
    fs::rename(f.0.join("file"), f.0.join("old")).unwrap();
    fs::write(f.0.join("file"), b"abcd").unwrap();
    assert_eq!(
        files::snapshot(&f.0, "file", &stamp).unwrap_err().1 .0["error"]["code"],
        "resource_file_changed"
    );
    assert!(files::open(&f.0, "owner.json/missing").is_err());
    let huge = fs::File::create(f.0.join("large")).unwrap();
    huge.set_len(MAX_BYTES as u64 + 1).unwrap();
    drop(huge);
    assert!(files::open(&f.0, "large").is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(f.0.join("file"), f.0.join("link")).unwrap();
        assert!(files::open(&f.0, "link").is_err());
    }
    #[cfg(windows)]
    {
        // Hard links remain explicit selected files, but resolving a reparse point must fail.
        // Symlink creation may require OS privileges; do not silently count an uncreated link as tested.
        if std::os::windows::fs::symlink_file(f.0.join("file"), f.0.join("link")).is_ok() {
            assert!(files::open(&f.0, "link").is_err());
            println!("Windows symlink actually created and rejected");
        } else {
            println!(
                "Windows symlink creation unavailable; link rejection branch not runtime-verified"
            );
        }
    }
}
#[test]
fn grants_are_bounded_expiring_one_use_and_wrong_owner_cannot_consume_them() {
    let f = Fixture::new();
    let mut grants = Grants::default();
    let id = grants.insert(grant(&f.0)).unwrap();
    let mut wrong = request(id.clone());
    wrong.owner.plugin_id = "other".into();
    assert!(grants.take(&wrong).is_err());
    assert!(grants.take(&request(id.clone())).is_ok());
    assert!(grants.take(&request(id)).is_err());
    let id = grants.insert(grant(&f.0)).unwrap();
    grants.0.get_mut(&id).unwrap().expires = Instant::now();
    assert!(grants.take(&request(id)).is_err());
    for _ in 0..8 {
        grants.insert(grant(&f.0)).unwrap();
    }
    assert!(grants.insert(grant(&f.0)).is_err());
    for n in 0..24 {
        let mut g = grant(&f.0);
        g.owner.runtime_id = format!("r{n}");
        grants.insert(g).unwrap();
    }
    let mut g = grant(&f.0);
    g.owner.runtime_id = "overflow".into();
    assert!(grants.insert(g).is_err());
}
#[test]
fn imported_bytes_use_existing_quota_hash_revoke_and_confirmation_semantics() {
    let mut store = Store::default();
    let result = store
        .import_file(owner(), "proof".into(), b"abcd".to_vec())
        .unwrap();
    let access: Access = serde_json::from_value(result["access"].clone()).unwrap();
    assert_eq!(access.content_version, sha256_hex(b"abcd"));
    assert_eq!(store.snapshot(&access, "proof").unwrap().bytes, b"abcd");
    assert!(store.snapshot(&access, "wrong-proof").is_err());
    store.revoke(&access).unwrap();
    assert!(store.snapshot(&access, "proof").is_err());
    for _ in 0..32 {
        store.import_file(owner(), "proof".into(), vec![]).unwrap();
    }
    assert!(store.import_file(owner(), "proof".into(), vec![]).is_err());
    assert_eq!(store.record_count(), 32);
}

#[tokio::test]
async fn http_desktop_file_confirmation_permission_change_cancel_and_replay_boundaries() {
    http(false).await;
}
#[tokio::test]
#[ignore = "requires retained draft2 Worker executable for real WASI execution"]
async fn actual_http_local_file_snapshot_executes_in_wasi_without_host_path() {
    http(true).await;
}

async fn http(actual: bool) {
    let f = Fixture::new();
    fs::create_dir(f.0.join("public")).unwrap();
    fs::create_dir(f.0.join("package/runtime"))
        .or_else(|_| fs::create_dir_all(f.0.join("package/runtime")))
        .unwrap();
    fs::write(f.0.join("中文 空格&.zip"), b"abcd").unwrap();
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut manifest: Value = serde_json::from_slice(
        &fs::read(project.join("tests/fixtures/devtools-text-dev57/plugin.json")).unwrap(),
    )
    .unwrap();
    manifest["id"] = json!("com.zicode.studio.local-file-fixture");
    manifest["name"] = json!("Studio Local File Fixture");
    manifest["runtime"] =
        json!({"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2"});
    manifest["activationEvents"] = json!(["onCapability:resource.inspect"]);
    manifest["contributes"] = json!({"capabilities":[{"id":"resource.inspect","title":"Local File Fixture","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}]});
    manifest["permissions"] = json!({"required":[],"optional":[{"name":"resource.read","reason":"User confirmed local file snapshot"}]});
    fs::write(
        f.0.join("package/plugin.json"),
        serde_json::to_vec(&manifest).unwrap(),
    )
    .unwrap();
    fs::write(f.0.join("package/runtime/tools.wasm"),r#"(module
        (import "wasi_snapshot_preview1" "fd_write" (func $write (param i32 i32 i32 i32) (result i32)))
        (import "zicode_resource_input_draft1" "size" (func $size (param i32) (result i64)))
        (import "zicode_resource_input_draft1" "read" (func $read (param i32 i64 i32 i32) (result i32)))
        (memory (export "memory") 1) (data (i32.const 64) "{\22value\22:\22XXXX\22}")
        (func (export "_start")
            i32.const 0 call $size i64.const 4 i64.ne if unreachable end
            i32.const 0 i64.const 0 i32.const 74 i32.const 4 call $read i32.const 4 i32.ne if unreachable end
            i32.const 0 i32.const 64 i32.store i32.const 4 i32.const 16 i32.store
            i32.const 1 i32.const 0 i32.const 1 i32.const 24 call $write drop))"#).unwrap();
    let metadata =
        crate::metadata_store::MetadataStore::open(&f.0.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let runtimes = NativePiManager::new(16);
    let issued = RuntimeTarget::new(
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "temporary-local-file",
        "local-file-instance",
    );
    let runtime = if actual {
        None
    } else {
        Some(runtimes.register_in_memory(issued.clone()).unwrap())
    };
    let host = HostServer::start_with_mode(
        f.0.join("public"),
        runtimes,
        auth,
        HashMap::new(),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap();
    let target = if actual {
        host.start_tool_session(issued.clone()).unwrap();
        assert!(host
            .state
            .runtimes
            .is_instance_live(&issued.instance_id)
            .unwrap());
        assert!(host
            .state
            .runtimes
            .request(
                &issued,
                json!({"type":"get_state"}),
                None,
                std::time::Duration::from_secs(1)
            )
            .await
            .unwrap_err()
            .starts_with("TOOL_SESSION_AI_UNAVAILABLE:"));
        issued.clone()
    } else {
        host.state.plugin_tokens.lock().unwrap().insert(
            issued.instance_id.clone(),
            RuntimePluginToken {
                token_hash: sha256_hex(b"local-file-fixture-token"),
                target: issued.clone(),
                expires_at: SystemTime::now() + PLUGIN_BROKER_TOKEN_TTL,
            },
        );
        host.state
            .runtimes
            .bind_session_id(&issued, "local-file-session")
            .unwrap()
    };
    host.state
        .data
        .workspace_roots()
        .write()
        .unwrap()
        .insert(target.workspace_id.clone(), f.0.clone());
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&f.0.join("package")).unwrap();
        registry
            .set_permission(
                "programming",
                manifest["id"].as_str().unwrap(),
                "resource.read",
                true,
            )
            .unwrap();
        registry
            .set_enabled("programming", manifest["id"].as_str().unwrap(), true)
            .unwrap();
    }
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    if actual {
        let bootstrap: Value = client
            .get(format!("{}/v2/bootstrap", host.origin()))
            .query(&[
                ("workspaceId", &target.workspace_id),
                ("sessionId", &target.session_id),
            ])
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(bootstrap["runtimeMode"], "tools");
        let (mut socket, _) =
            tokio_tungstenite::connect_async(host.origin().replace("http://", "ws://") + "/v2/ws")
                .await
                .unwrap();
        socket.send(tokio_tungstenite::tungstenite::Message::Text(json!({"type":"hello","protocolVersion":2,"clientType":"desktop","desktopToken":host.desktop_token(),"clientId":"tool-startup-test"}).to_string())).await.unwrap();
        socket.next().await.unwrap().unwrap();
        for (frame, expected) in [
            (
                json!({"type":"runtime_snapshot_request","requestId":"tools-snapshot","sessionId":target.session_id}),
                "runtime_snapshot",
            ),
            (
                json!({"type":"runtime_capabilities_request","requestId":"tools-capabilities","instanceId":target.instance_id}),
                "runtime_capabilities",
            ),
        ] {
            socket
                .send(tokio_tungstenite::tungstenite::Message::Text(
                    frame.to_string(),
                ))
                .await
                .unwrap();
            let message = tokio::time::timeout(std::time::Duration::from_secs(3), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            let result: Value = serde_json::from_str(message.to_text().unwrap()).unwrap();
            assert_eq!(result["type"], expected, "{result}");
            if expected == "runtime_snapshot" {
                assert_eq!(result["state"]["runtimeMode"], "tools");
                assert_eq!(result["state"]["pi"], Value::Null);
                assert_eq!(result["state"]["messages"], json!([]));
            } else {
                assert_eq!(result["runtimeMode"], "tools");
                assert_eq!(result["nativeRpc"], false);
                assert_eq!(result["extensionUi"], false);
                assert_eq!(result["sessionTree"], false);
            }
        }
        socket.close(None).await.unwrap();
    }
    let post = |route: &str, body: Value| {
        client
            .post(format!("{}/v2/plugin-resources/{route}", host.origin()))
            .header("x-zicode-desktop-token", host.desktop_token())
            .json(&body)
            .send()
    };
    let owner = json!({"runtimeId":target.instance_id,"sessionId":target.session_id,"pluginId":manifest["id"],"capabilityId":"resource.inspect"});
    let prepare = json!({"schemaVersion":1,"owner":owner,"relativePath":"中文 空格&.zip"});
    assert_eq!(
        client
            .post(format!(
                "{}/v2/plugin-resources/prepare-local-file",
                host.origin()
            ))
            .bearer_auth("local-file-fixture-token")
            .json(&prepare)
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let preview: Value = post("prepare-local-file", prepare.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(preview["contentRead"], false);
    assert_eq!(preview["byteLength"], 4);
    assert_eq!(
        host.state.plugin_resources.lock().unwrap().record_count(),
        0
    );
    let mut commit =
        json!({"schemaVersion":1,"owner":owner,"grantId":preview["grantId"],"confirmed":false});
    assert_eq!(
        post("commit-local-file", commit.clone())
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_confirmation_required"
    );
    commit["confirmed"] = json!(true);
    let imported: Value = post("commit-local-file", commit.clone())
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(imported["confirmed"], true, "{imported}");
    assert_eq!(imported["contentVersion"], sha256_hex(b"abcd"));
    assert_eq!(
        post("commit-local-file", commit)
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap()["error"]["code"],
        "resource_file_grant_unavailable"
    );
    let read: Value = post(
        "read-view",
        json!({"access":imported["access"],"offset":0,"length":4}),
    )
    .await
    .unwrap()
    .json()
    .await
    .unwrap();
    assert_eq!(read["dataBase64"], "YWJjZA==");
    for mode in ["cancel", "changed", "permission", "regrant", "workspace"] {
        let preview: Value = post("prepare-local-file", prepare.clone())
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let grant =
            json!({"schemaVersion":1,"owner":owner,"grantId":preview["grantId"],"confirmed":true});
        if mode == "cancel" {
            assert_eq!(
                post("cancel-local-file", grant.clone())
                    .await
                    .unwrap()
                    .json::<Value>()
                    .await
                    .unwrap()["cancelled"],
                true
            );
        }
        if mode == "changed" {
            fs::rename(f.0.join("中文 空格&.zip"), f.0.join("old.zip")).unwrap();
            fs::write(f.0.join("中文 空格&.zip"), b"abcd").unwrap();
        }
        if mode == "permission" || mode == "regrant" {
            host.state
                .plugins
                .lock()
                .unwrap()
                .set_permission(
                    "programming",
                    manifest["id"].as_str().unwrap(),
                    "resource.read",
                    false,
                )
                .unwrap();
        }
        if mode == "regrant" {
            let mut registry = host.state.plugins.lock().unwrap();
            registry
                .set_permission(
                    "programming",
                    manifest["id"].as_str().unwrap(),
                    "resource.read",
                    true,
                )
                .unwrap();
            registry
                .set_enabled("programming", manifest["id"].as_str().unwrap(), true)
                .unwrap();
        }
        if mode == "workspace" {
            fs::create_dir(f.0.join("other-project")).unwrap();
            host.state
                .data
                .workspace_roots()
                .write()
                .unwrap()
                .insert(target.workspace_id.clone(), f.0.join("other-project"));
        }
        assert_eq!(
            post("commit-local-file", grant).await.unwrap().status(),
            if mode == "permission" {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::CONFLICT
            }
        );
        if mode == "permission" {
            let mut registry = host.state.plugins.lock().unwrap();
            registry
                .set_permission(
                    "programming",
                    manifest["id"].as_str().unwrap(),
                    "resource.read",
                    true,
                )
                .unwrap();
            registry
                .set_enabled("programming", manifest["id"].as_str().unwrap(), true)
                .unwrap();
        }
        if mode == "workspace" {
            host.state
                .data
                .workspace_roots()
                .write()
                .unwrap()
                .insert(target.workspace_id.clone(), f.0.clone());
        }
    }
    if actual {
        let events = Arc::new(Mutex::new(Vec::new()));
        let recorded = events.clone();
        *host.state.plugin_resource_workers.observer.lock().unwrap() =
            Some(Arc::new(move |event, pid| {
                recorded.lock().unwrap().push((event, pid))
            }));
        *host
            .state
            .plugin_resource_workers
            .executable
            .lock()
            .unwrap() = Some(PathBuf::from(
            std::env::var_os("ZICODE_TEST_RESOURCE_WORKER_EXE").unwrap(),
        ));
        // Regrant invalidates the previous resource; obtain fresh explicit consent.
        let preview: Value = post("prepare-local-file", prepare.clone())
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let imported: Value = post(
            "commit-local-file",
            json!({"schemaVersion":1,"owner":owner,"grantId":preview["grantId"],"confirmed":true}),
        )
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
        let output: Value = post(
            "invoke-view",
            json!({"access":imported["access"],"toolCallId":uuid::Uuid::new_v4(),"input":{}}),
        )
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
        assert_eq!(output["result"]["value"], "abcd", "{output}");
        assert!(!imported.to_string().contains("relativePath"));
        assert!(!imported.to_string().contains(f.0.to_str().unwrap()));
        let events = events.lock().unwrap();
        let started: Vec<_> = events
            .iter()
            .filter(|(event, _)| *event == "started")
            .map(|(_, pid)| *pid)
            .collect();
        let closed: Vec<_> = events
            .iter()
            .filter(|(event, _)| *event == "pipes_closed")
            .map(|(_, pid)| *pid)
            .collect();
        let reaped: Vec<_> = events
            .iter()
            .filter(|(event, _)| *event == "reaped")
            .map(|(_, pid)| *pid)
            .collect();
        assert_eq!(started.len(), 1);
        assert_eq!(started, reaped);
        assert_eq!(started, closed);
        println!("Worker lifetime events: {events:?}");
        drop(events);
        println!(
            "actual local file HTTP→confirmed snapshot→WASI result passed; fixture={}",
            f.0.display()
        );
    }
    if actual {
        if let Some(script) = std::env::var_os("ZICODE_PROJECT_FILE_BROWSER_SCRIPT") {
            let executable = std::env::var_os("ZICODE_PROJECT_FILE_BROWSER_NODE")
                .expect("Browser runtime must be explicit");
            let status = tokio::process::Command::from(crate::process_command::new_command(executable)).arg(script)
                .env("ZICODE_PREVIEW_HOST", host.origin())
                .env("ZICODE_PREVIEW_TOKEN", host.desktop_token())
                .env("ZICODE_PREVIEW_TARGET", serde_json::to_string(&json!({"workspaceId":target.workspace_id,"sceneId":"programming","instanceId":target.instance_id,"sessionId":target.session_id})).unwrap())
                .status().await.unwrap();
            assert!(
                status.success(),
                "Project file browser acceptance failed; retain fixture"
            );
        }
        let pending: Value = post("prepare-local-file", prepare.clone())
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert!(pending["grantId"].is_string());
        host.state.runtimes.stop(&target).unwrap();
        for (route, body) in [
            ("prepare-local-file", prepare),
            (
                "commit-local-file",
                json!({"schemaVersion":1,"owner":owner,"grantId":pending["grantId"],"confirmed":true}),
            ),
            (
                "read-view",
                json!({"access":imported["access"],"offset":0,"length":4}),
            ),
        ] {
            let result: Value = post(route, body).await.unwrap().json().await.unwrap();
            assert_eq!(
                result["error"]["code"], "runtime_stopped",
                "{route}: {result}"
            );
        }
        assert!(!host
            .state
            .runtimes
            .is_instance_live(&target.instance_id)
            .unwrap());
        println!("Tool-only session stopped; pending grants and confirmed resource reads rejected");
    }
    host.stop_and_wait().await.unwrap();
    drop(runtime);
}

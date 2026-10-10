use super::*;
use crate::host_server::{HostMode, HostServer};
use crate::metadata_store::MetadataStore;
use crate::native_pi_manager::NativePiManager;
use crate::remote_auth::RemoteAuth;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::io::AsyncWriteExt;

async fn start(root: &Path) -> HostServer {
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    HostServer::start_with_mode(
        root.join("public"),
        NativePiManager::new(16),
        auth,
        HashMap::from([
            ("workspace-a".into(), root.join("workspace-a")),
            ("workspace-b".into(), root.join("workspace-b")),
        ]),
        HostMode::IsolatedDesktop,
    )
    .await
    .unwrap()
}

async fn browser(host: &HostServer, script: &Path, phase: u8) {
    let mut command = tokio::process::Command::from(crate::process_command::new_command("node"));
    command
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            json!({"origin":host.origin(),"desktopToken":host.desktop_token(),"phase":phase})
                .to_string()
                .as_bytes(),
        )
        .await
        .unwrap();
    let output = tokio::time::timeout(std::time::Duration::from_secs(90), child.wait_with_output())
        .await
        .expect("Browser QA timed out")
        .unwrap();
    assert!(
        output.status.success(),
        "Browser QA failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["passed"], true);
}

#[tokio::test]
#[ignore = "Requires local Chrome and ZICODE_TEST_TOOL_ACCESS_SCRIPT; creates isolated Host and metadata only"]
async fn actual_browser_favorites_survive_host_restart_and_origin_change() {
    let project = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    let script = std::path::PathBuf::from(std::env::var("ZICODE_TEST_TOOL_ACCESS_SCRIPT").unwrap());
    let root = project
        .join(".cache/task-scratch")
        .join(format!("tool-access-{}", uuid::Uuid::new_v4()));
    for folder in ["public", "workspace-a", "workspace-b"] {
        std::fs::create_dir_all(root.join(folder)).unwrap();
    }
    std::fs::write(root.join("owner.json"), json!({"purpose":"real Host/browser persistence QA","lifetime":"remove on success; retain failure evidence"}).to_string()).unwrap();
    for file in [
        "i18n.js",
        "themes.js",
        "style-theme.css",
        "design-system.css",
        "style.bundle.css",
        "native/react/vendor.js",
        "native/react/command-palette.js",
        "native/features/tool-access-store.js",
        "native/transport/runtime-adapter.js",
        "native/transport/control-gateway.js",
        "native/transport/e2ee.js",
        "native/transport/p2p.js",
    ] {
        let destination = root.join("public").join(file);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::copy(project.join("public").join(file), destination).unwrap();
    }
    std::fs::copy(
        project.join("tests/fixtures/tool-access-harness.html"),
        root.join("public/index.html"),
    )
    .unwrap();
    let first = start(&root).await;
    let invalid = dispatch(
        &first.state,
        "invalid",
        "tool_access_read",
        &json!({"schemaVersion":1,"sceneId":"programming","workspaceId":"unregistered"}),
    )
    .await;
    assert!(invalid.is_err());
    let incompatible = dispatch(
        &first.state,
        "invalid",
        "tool_access_read",
        &json!({"schemaVersion":2,"sceneId":"programming","workspaceId":"workspace-a"}),
    )
    .await;
    assert_eq!(incompatible.unwrap_err().0, "tool_access_incompatible");
    browser(&first, &script, 1).await;
    let old_origin = first.origin().to_owned();
    let port: u16 = old_origin.rsplit(':').next().unwrap().parse().unwrap();
    first.stop_and_wait().await.unwrap();
    let _occupied = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .unwrap();
    let second = start(&root).await;
    assert_ne!(second.origin(), old_origin);
    browser(&second, &script, 2).await;
    second.stop_and_wait().await.unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let state = metadata
        .read_tool_access("programming", "workspace-a")
        .unwrap();
    assert_eq!(state.favorites, ["com.zicode.devtools.text:open"]);
    assert!(state.recent.is_empty());
    drop(metadata);
    std::fs::remove_dir_all(root).unwrap();
}

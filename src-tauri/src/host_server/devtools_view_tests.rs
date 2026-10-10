use super::*;
use crate::metadata_store::MetadataStore;
use sha2::{Digest, Sha256};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires a browser QA script, delivered Worker and installed Chromium"]
async fn devtools_view_browser_invokes_actual_host_worker() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let worker = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let script = PathBuf::from(std::env::var_os("ZICODE_TEST_VIEW_SCRIPT").unwrap());
    let source = project.join("tests/fixtures/devtools-text-dev57");
    let evidence: Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-text-dev57.acceptance.json")).unwrap(),
    )
    .unwrap();
    for file in evidence["files"].as_array().unwrap() {
        let bytes = std::fs::read(source.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["bytes"].as_u64().unwrap());
        assert_eq!(format!("{:x}", Sha256::digest(&bytes)), file["sha256"]);
    }
    let root = project
        .join(".cache/task-scratch")
        .join(format!("devtools-view-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({
            "purpose":"actual Chromium View/Host/Worker acceptance",
            "lifetime":"remove on success; preserve failure evidence",
            "pid":std::process::id()
        })
        .to_string(),
    )
    .unwrap();
    for path in [
        "i18n.js",
        "style-theme.css",
        "design-system.css",
        "native/plugins/plugin-view-host.js",
        "native/plugins/plugin-result-actions.js",
        "native/plugins/plugin-result-transfer.js",
        "native/plugins/plugin-view-host.css",
        "native/plugins/plugin-host-gateway.js",
        "native/plugins/plugin-capability-gateway.js",
        "native/plugins/plugin-registry.js",
    ] {
        let destination = public.join(path);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::copy(project.join("public").join(path), destination).unwrap();
    }
    std::fs::copy(
        project.join("tests/fixtures/devtools-view-harness.html"),
        public.join("index.html"),
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let receiver = root.join("receiver");
    plugin_results::transfer::fixture::create_receiver(&source, &receiver);
    // Synthetic metadata tests pagination only; never execute these sample operations.
    let mut receiver_manifest: Value =
        serde_json::from_slice(&std::fs::read(receiver.join("plugin.json")).unwrap()).unwrap();
    let schema = receiver_manifest["contributes"]["capabilities"][0]["inputSchema"].clone();
    for index in 0..200 {
        receiver_manifest["contributes"]["capabilities"].as_array_mut().unwrap().push(
            json!({"id":format!("sample.text.{index:03}"),"title":format!("分页样本 {index:03}"),"inputSchema":schema})
        );
    }
    std::fs::write(
        receiver.join("plugin.json"),
        serde_json::to_vec(&receiver_manifest).unwrap(),
    )
    .unwrap();
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&source).unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.text", true)
            .unwrap();
        registry.install_developer(&receiver).unwrap();
        registry
            .set_enabled("programming", "com.zicode.devtools.echo", true)
            .unwrap();
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(worker);
    // The existing browser QA scripts use Node; Bun remains the package manager.
    let mut command = tokio::process::Command::from(crate::process_command::new_command("node"));
    command
        .arg(&script)
        .current_dir(&project)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    let mut child = command.spawn().unwrap();
    // Ephemeral Host credentials travel only over stdin, never files or logs.
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            json!({
                "origin":host.origin(), "desktopToken":host.desktop_token()
            })
            .to_string()
            .as_bytes(),
        )
        .await
        .unwrap();
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        child.wait_with_output(),
    )
    .await;
    host.stop_and_wait().await.unwrap();
    let output = output.expect("Browser QA timed out").unwrap();
    assert!(
        output.status.success(),
        "Browser QA failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(report["passed"], true, "Browser QA report failed");
    eprintln!("Actual View browser/Host/Worker checks passed");
    std::fs::remove_dir_all(root).unwrap();
}

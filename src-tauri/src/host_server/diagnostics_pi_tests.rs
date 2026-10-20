use super::*;
use crate::metadata_store::MetadataStore;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires current ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_discovers_diagnostics_and_enforces_permission_changes() {
    run_diagnostics_candidate("devtools-diagnostics-candidate01", true).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires current ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_candidate02_reports_and_enforces_permission_changes() {
    run_diagnostics_candidate("devtools-diagnostics-candidate02", false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires current ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_candidate03_reports_and_enforces_permission_changes() {
    run_diagnostics_candidate("devtools-diagnostics-candidate03", false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires current ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_candidate014_reports_and_enforces_permission_changes() {
    run_diagnostics_candidate("devtools-diagnostics-0.1.4-candidate-01", false).await;
}

async fn run_diagnostics_candidate(fixture_name: &str, expect_legacy_fuel_errors: bool) {
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let delivery = executable.parent().unwrap();
    for relative in [
        executable.file_name().unwrap().to_str().unwrap(),
        "pi/pi.exe",
        "extensions/plugin-broker.mjs",
    ] {
        let bytes = std::fs::read(delivery.join(relative)).unwrap();
        eprintln!("runtime receipt {relative}: {:x}", Sha256::digest(bytes));
    }
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("diagnostics-pi-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    std::fs::write(root.join("owner.json"), json!({"purpose":"actual candidate Pi/Host/Worker acceptance", "pid":std::process::id(), "lifetime":"retain compact receipt and isolated fixture for acceptance audit"}).to_string()).unwrap();
    let extension = crate::process_command::working_directory(
        &std::env::var_os("ZICODE_TEST_CATALOG_EXTENSION")
            .map(PathBuf::from)
            .unwrap_or_else(|| delivery.join("extensions/plugin-broker.mjs"))
            .canonicalize()
            .unwrap(),
    );
    let observer = root.join("observer.ts");
    let module_url = reqwest::Url::from_file_path(&extension).unwrap();
    let fixture = project.join("tests/fixtures").join(fixture_name);
    let html = std::fs::read_to_string(fixture.join("views/main.html")).unwrap();
    let actions = html
        .split("const actions = ")
        .nth(1)
        .unwrap()
        .split("; // diagnostic-actions-end")
        .next()
        .unwrap();
    let actions: Value = serde_json::from_str(actions).unwrap();
    assert_eq!(actions.as_array().unwrap().len(), 11);
    std::fs::write(root.join("samples.json"), actions.to_string()).unwrap();
    let script = std::fs::read_to_string(
        project.join("src-tauri/src/host_server/diagnostics_pi_observer.txt"),
    )
    .unwrap()
    .replace(
        "__EXPECTED_FAILURES__",
        if expect_legacy_fuel_errors {
            "[\"django.migrations\", \"celery.report\"]"
        } else {
            "[]"
        },
    )
    .replace(
        "__BROKER_MODULE__",
        &serde_json::to_string(module_url.as_str()).unwrap(),
    )
    .replace(
        "__SAMPLES_FILE__",
        &serde_json::to_string(root.join("samples.json").to_str().unwrap()).unwrap(),
    )
    .replace(
        "__RECEIPT_FILE__",
        &serde_json::to_string(root.join("receipt.json").to_str().unwrap()).unwrap(),
    );
    std::fs::write(&observer, script).unwrap();
    crate::desktop_profile::initialize([
        std::ffi::OsString::from("--isolated-profile"),
        root.join("profile").into_os_string(),
    ])
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let plugin_id = "com.zicode.devtools.diagnostics";
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&fixture).unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
        assert!(!registry
            .pi_tools("programming")
            .iter()
            .any(|tool| tool.plugin_id == plugin_id));
        let control_id = "com.zicode.devtools.text";
        registry
            .install_developer(&project.join("tests/fixtures/devtools-text-dev57"))
            .unwrap();
        registry
            .set_enabled("programming", control_id, true)
            .unwrap();
        registry
            .set_permission("programming", control_id, "pi.tools.register", true)
            .unwrap();
    }
    host.state
        .capability_broker
        .lock()
        .unwrap()
        .worker_executable = Some(executable.clone());
    worker_test_observer::attach(&mut host.state.capability_broker.lock().unwrap()).unwrap();
    let target = RuntimeTarget::new(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "candidate-session",
        "candidate-instance",
    );
    let mut launch = NativeLaunchSpec {
        binary: delivery.join("pi/pi.exe"),
        cwd: root.clone(),
        session_path: None,
        extensions: vec![observer],
        pi_version: crate::pi_launch::locked_pi_version().into(),
        path_env: std::env::var("PATH").unwrap_or_default(),
        disable_auto_discovery: false,
        environment: BTreeMap::from([
            ("HOME".into(), root.to_string_lossy().into_owned()),
            ("USERPROFILE".into(), root.to_string_lossy().into_owned()),
            (
                "PI_CODING_AGENT_DIR".into(),
                root.join("agent").to_string_lossy().into_owned(),
            ),
            ("NO_PROXY".into(), "127.0.0.1,localhost".into()),
        ]),
    };
    configure_plugin_broker_for_state(&host.state, &target, &mut launch).unwrap();
    let mut events = host.state.runtimes.subscribe();
    host.state.runtimes.spawn(target.clone(), launch).unwrap();
    let mut worker_counts = Vec::new();
    for (phase, expected_starts) in [
        ("unauthorized", 1),
        ("run", 12),
        ("revoked", 1),
        ("restored", 1),
        ("disabled", 1),
        ("reenabled", 1),
        ("revoked-again", 0),
        ("uninstalled", 1),
        ("reinstalled-denied", 1),
        ("reinstalled-granted", 1),
    ] {
        {
            let mut registry = host.state.plugins.lock().unwrap();
            match phase {
                "run" | "restored" | "reinstalled-granted" => {
                    registry
                        .set_permission("programming", plugin_id, "pi.tools.register", true)
                        .unwrap();
                }
                "revoked" | "revoked-again" => {
                    registry
                        .set_permission("programming", plugin_id, "pi.tools.register", false)
                        .unwrap();
                }
                "disabled" | "reenabled" => {
                    registry
                        .set_enabled("programming", plugin_id, phase == "reenabled")
                        .unwrap();
                }
                "uninstalled" => registry.uninstall_developer(plugin_id).unwrap(),
                "reinstalled-denied" => {
                    registry.install_developer(&fixture).unwrap();
                    registry
                        .set_enabled("programming", plugin_id, true)
                        .unwrap();
                    assert!(!registry
                        .pi_tools("programming")
                        .iter()
                        .any(|tool| tool.plugin_id == plugin_id));
                }
                _ => {}
            }
        }
        let starts_before = worker_start_count();
        let accepted = host
            .state
            .runtimes
            .request(
                &target,
                json!({"type":"prompt", "message":format!("/devtools-accept {phase}")}),
                Some(&format!("candidate-{phase}")),
                Duration::from_secs(90),
            )
            .await
            .unwrap();
        assert_eq!(accepted["success"], true);
        let confirmed = tokio::time::timeout(Duration::from_secs(90), async {
            loop {
                let frame = events.recv().await.unwrap();
                if frame.target == target
                    && frame.event["type"] == "extension_ui_request"
                    && frame.event["message"] == format!("diagnostics Pi verified: {phase}")
                {
                    break true;
                }
                if frame.target == target
                    && frame.event["type"] == "extension_ui_request"
                    && frame.event["message"] == format!("diagnostics Pi failed: {phase}")
                {
                    break false;
                }
            }
        })
        .await
        .unwrap_or(false);
        if !confirmed {
            host.stop_and_wait().await.unwrap();
            panic!(
                "Pi phase failed: {phase}; evidence retained at {}",
                root.display()
            );
        }
        if let (Some(before), Some(after)) = (starts_before, worker_start_count()) {
            worker_counts.push(
                json!({"phase":phase,"actualStarts":after-before,"expectedStarts":expected_starts}),
            );
            std::fs::write(
                root.join("worker-counts.json"),
                serde_json::to_vec_pretty(&worker_counts).unwrap(),
            )
            .unwrap();
            if after - before != expected_starts {
                host.stop_and_wait().await.unwrap();
                panic!("Unexpected Worker starts in phase {phase}");
            }
        }
        eprintln!("actual candidate Pi phase verified: {phase}");
    }
    host.stop_and_wait().await.unwrap();
    let receipt: Value =
        serde_json::from_slice(&std::fs::read(root.join("receipt.json")).unwrap()).unwrap();
    assert_eq!(receipt["mechanismPassed"], true);
    assert_eq!(receipt["fullCandidateAccepted"], false);
    assert_eq!(receipt["deniedCalls"].as_array().unwrap().len(), 55);
    assert_eq!(receipt["controlCalls"].as_array().unwrap().len(), 5);
    eprintln!(
        "diagnostics acceptance evidence retained: {}",
        root.display()
    );
}

fn worker_start_count() -> Option<usize> {
    let path = std::env::var_os("ZICODE_TEST_WORKER_EVENT_LOG")?;
    let text = std::fs::read_to_string(path).unwrap();
    Some(
        text.lines()
            .filter(|line| {
                let record: Value = serde_json::from_str(line).unwrap();
                record["event"] == "started"
            })
            .count(),
    )
}

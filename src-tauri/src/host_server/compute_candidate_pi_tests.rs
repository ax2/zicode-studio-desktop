use super::*;
use crate::metadata_store::MetadataStore;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(super) async fn run_compute_candidate(
    family: &str,
    fixture_name: &str,
    operation_count: usize,
    business_error: Option<Value>,
) {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures")
        .join(fixture_name);
    run_compute_candidate_inner(family, fixture, operation_count, business_error, None).await;
}

pub(super) struct ExternalCandidate {
    pub source: PathBuf,
    pub receipt: PathBuf,
    pub evidence_dir: PathBuf,
    pub expected_file_count: usize,
}

pub(super) async fn run_compute_candidate_external(
    family: &str,
    operation_count: usize,
    business_error: Option<Value>,
    external: ExternalCandidate,
) {
    run_compute_candidate_inner(
        family,
        external.source.clone(),
        operation_count,
        business_error,
        Some(external),
    )
    .await;
}

async fn run_compute_candidate_inner(
    family: &str,
    fixture: PathBuf,
    operation_count: usize,
    business_error: Option<Value>,
    external: Option<ExternalCandidate>,
) {
    let verify_business_error = business_error.is_some();
    let executable = PathBuf::from(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap());
    let delivery = executable.parent().unwrap();
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let pi_name = if cfg!(windows) { "pi.exe" } else { "pi" };
    let prepared_resources = std::env::var_os("ZICODE_TEST_PREPARED_RESOURCES").is_some();
    let (pi_paths, extension_paths) = if prepared_resources {
        (
            vec![project.join("src-tauri/resources/pi").join(pi_name)],
            vec![project.join("extensions/dist/plugin-broker.mjs")],
        )
    } else {
        (
            vec![
                delivery.join("pi").join(pi_name),
                project.join("src-tauri/resources/pi").join(pi_name),
            ],
            vec![
                delivery.join("extensions/plugin-broker.mjs"),
                project.join("extensions/dist/plugin-broker.mjs"),
            ],
        )
    };
    let pi_binary = pi_paths
        .into_iter()
        .find(|path| path.is_file())
        .expect("run bun run fetch:pi before this integration test");
    let bundled_extension = extension_paths
        .into_iter()
        .find(|path| path.is_file())
        .expect("run bun run build:extensions before this integration test");
    for (label, path) in [
        ("worker", executable.as_path()),
        ("pi", pi_binary.as_path()),
        ("plugin-broker", bundled_extension.as_path()),
    ] {
        let bytes = std::fs::read(path).unwrap();
        eprintln!("runtime receipt {label}: {:x}", Sha256::digest(bytes));
    }
    let root = project
        .join(".cache/task-scratch")
        .join(format!("{family}-pi-{}", uuid::Uuid::new_v4()));
    let public = root.join("public");
    std::fs::create_dir_all(&public).unwrap();
    let ci_receipt = std::env::var_os("ZICODE_TEST_CANDIDATE_PI_RECEIPT").map(PathBuf::from);
    std::fs::write(root.join("owner.json"), json!({"purpose":"actual candidate Pi/Host/Worker acceptance", "pid":std::process::id(), "lifetime":if external.is_some() || ci_receipt.is_some() { "remove on pass; retain failure evidence" } else { "retain compact receipt and isolated fixture for acceptance audit" }}).to_string()).unwrap();
    let extension = crate::process_command::working_directory(
        &std::env::var_os("ZICODE_TEST_CATALOG_EXTENSION")
            .map(PathBuf::from)
            .unwrap_or_else(|| bundled_extension.clone())
            .canonicalize()
            .unwrap(),
    );
    let observer = root.join("observer.ts");
    let module_url = reqwest::Url::from_file_path(&extension).unwrap();
    if let Some(external) = &external {
        super::inspect_011_host_tests::verify_receipt(&project, &fixture, &external.receipt, external.expected_file_count);
    }
    let cases: Value = serde_json::from_slice(
        &std::fs::read(fixture.join(format!("fixtures/{family}.json"))).unwrap(),
    )
    .unwrap();
    let capability_prefix = format!("devtools.{family}.");
    let catalog: Value =
        serde_json::from_slice(&std::fs::read(fixture.join("catalog.json")).unwrap()).unwrap();
    let samples: Vec<Value> = if family == "text" && external.is_some() {
        let mut successful: Vec<Value> = cases["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|case| case["expectedText"].is_string())
            .cloned()
            .collect();
        for name in ["json-validation.json", "sql-format.json"] {
            let fixture_cases: Value = serde_json::from_slice(
                &std::fs::read(fixture.join("fixtures").join(name)).unwrap(),
            )
            .unwrap();
            successful.extend(fixture_cases["operations"].as_array().unwrap().iter().map(
                |operation| {
                    json!({"capabilityId":operation["capabilityId"],
                        "input":{"text":operation["input"]},
                        "expectedText":operation["expected"]})
                },
            ));
        }
        catalog["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| {
                let capability = tool["capabilityId"].as_str().unwrap();
                let sample = successful
                    .iter()
                    .find(|case| case["capabilityId"] == capability)
                    .unwrap();
                json!({"id":capability.strip_prefix(capability_prefix.as_str()).unwrap(),
                    "input":sample["input"],"expectedText":sample["expectedText"]})
            })
            .collect()
    } else {
        cases["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|case| {
                let id = case["id"].as_str().unwrap();
                id.ends_with("-sample")
                    || (family == "trace" && matches!(id, "java-single" | "python-single"))
                    || (family == "inspect" && external.is_some() && id == "color-known-0")
            })
            .map(|case| json!({"id":case["capabilityId"].as_str().unwrap().strip_prefix(capability_prefix.as_str()).unwrap(),"input":case["input"],"expectedText":case["expectedText"]}))
            .collect()
    };
    assert_eq!(samples.len(), operation_count);
    assert_eq!(catalog["tools"].as_array().unwrap().len(), samples.len());
    assert!(catalog["tools"]
        .as_array()
        .unwrap()
        .iter()
        .all(|tool| samples.iter().any(|sample| tool["capabilityId"]
            == format!("{capability_prefix}{}", sample["id"].as_str().unwrap()))));
    std::fs::write(
        root.join("samples.json"),
        serde_json::to_vec(&samples).unwrap(),
    )
    .unwrap();
    let business_error = business_error.unwrap_or(Value::Null);
    std::fs::write(
        root.join("business-error.json"),
        serde_json::to_vec(&business_error).unwrap(),
    )
    .unwrap();
    let (control_id, control_source, control_tool, control_input, control_expected) =
        if family == "text" {
            (
                "com.zicode.devtools.inspect",
                project.join("tests/fixtures/devtools-catalog-2026-10-18-9c17b7b91e84f1c7-package-bundle/release/plugin-candidates/inspect-0.1.2-candidate-01"),
                "devtools_inspect_unicode_nfc",
                json!({"text":"Hello"}),
                "Hello".to_owned(),
            )
        } else {
            (
                "com.zicode.devtools.text",
                project.join("tests/fixtures/devtools-text-dev57"),
                "devtools_text_base64_encode",
                json!({"text":"synthetic independent plugin"}),
                "c3ludGhldGljIGluZGVwZW5kZW50IHBsdWdpbg==".to_owned(),
            )
        };
    let script = include_str!("compute_candidate_pi_observer.txt")
        .replace(
            "__PLUGIN_ID__",
            &serde_json::to_string(&format!("com.zicode.devtools.{family}")).unwrap(),
        )
        .replace(
            "__TOOL_PREFIX__",
            &serde_json::to_string(&format!("devtools_{family}_")).unwrap(),
        )
        .replace("__FAMILY__", &serde_json::to_string(family).unwrap())
        .replace("__CONTROL_PLUGIN_ID__", &serde_json::to_string(control_id).unwrap())
        .replace("__CONTROL_TOOL_NAME__", &serde_json::to_string(control_tool).unwrap())
        .replace("__CONTROL_INPUT__", &control_input.to_string())
        .replace("__CONTROL_EXPECTED__", &serde_json::to_string(&control_expected).unwrap())
        .replace(
            "__BUSINESS_ERROR_FILE__",
            &serde_json::to_string(root.join("business-error.json").to_str().unwrap()).unwrap(),
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
    let plugin_id = format!("com.zicode.devtools.{family}");
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry.install_developer(&fixture).unwrap();
        registry
            .set_enabled("programming", &plugin_id, true)
            .unwrap();
        assert!(!registry
            .pi_tools("programming")
            .iter()
            .any(|tool| tool.plugin_id == plugin_id));
        registry.install_developer(&control_source).unwrap();
        registry
            .set_enabled("programming", control_id, true)
            .unwrap();
        registry
            .set_permission("programming", control_id, "pi.tools.register", true)
            .unwrap();
    }
    if let Some(external) = &external {
        super::inspect_011_host_tests::verify_receipt(
            &project,
            &root.join("test-plugin-registry/developer").join(&plugin_id),
            &external.receipt,
            external.expected_file_count,
        );
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
        binary: pi_binary,
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
        (
            "run",
            operation_count + 1 + if verify_business_error { 2 } else { 0 },
        ),
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
                        .set_permission("programming", &plugin_id, "pi.tools.register", true)
                        .unwrap();
                }
                "revoked" | "revoked-again" => {
                    registry
                        .set_permission("programming", &plugin_id, "pi.tools.register", false)
                        .unwrap();
                }
                "disabled" | "reenabled" => {
                    registry
                        .set_enabled("programming", &plugin_id, phase == "reenabled")
                        .unwrap();
                }
                "uninstalled" => registry.uninstall_developer(&plugin_id).unwrap(),
                "reinstalled-denied" => {
                    registry.install_developer(&fixture).unwrap();
                    registry
                        .set_enabled("programming", &plugin_id, true)
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
                    && frame.event["message"] == format!("{family} Pi verified: {phase}")
                {
                    break true;
                }
                if frame.target == target
                    && frame.event["type"] == "extension_ui_request"
                    && frame.event["message"] == format!("{family} Pi failed: {phase}")
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
    assert_eq!(
        receipt["deniedCalls"].as_array().unwrap().len(),
        operation_count * 5
    );
    assert_eq!(
        receipt["controlCalls"].as_array().unwrap().len(),
        5 + usize::from(verify_business_error)
    );
    if let Some(external) = external {
        std::fs::create_dir_all(&external.evidence_dir).unwrap();
        std::fs::copy(
            root.join("receipt.json"),
            external.evidence_dir.join("pi-receipt.json"),
        )
        .unwrap();
        let counts = root.join("worker-counts.json");
        if counts.exists() {
            std::fs::copy(counts, external.evidence_dir.join("worker-counts.json")).unwrap();
        }
        if let Some(path) = ci_receipt {
            let mut report = receipt;
            report["passed"] = Value::Bool(true);
            report["candidateFamily"] = Value::String(family.to_owned());
            report["operationCount"] = json!(operation_count);
            report["preparedResources"] = Value::Bool(prepared_resources);
            std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        }
        std::fs::remove_dir_all(&root).unwrap();
        eprintln!("{family} acceptance evidence saved; isolated scratch removed");
    } else if let Some(path) = ci_receipt {
        let mut report = receipt;
        report["passed"] = Value::Bool(true);
        report["candidateFamily"] = Value::String(family.to_owned());
        report["operationCount"] = json!(operation_count);
        report["preparedResources"] = Value::Bool(prepared_resources);
        std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
        eprintln!("{family} CI acceptance receipt saved; isolated scratch removed");
    } else {
        eprintln!("{family} acceptance evidence retained: {}", root.display());
    }
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

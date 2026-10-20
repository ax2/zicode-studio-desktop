use sha2::{Digest, Sha256};

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Trace 0.1.1 package/receipt, evidence directory and current Worker/Pi; run alone"]
async fn embedded_pi_trace_011_both_operations_and_permission_lifecycle() {
    let external = super::compute_candidate_pi_tests::ExternalCandidate {
        source: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_TRACE_011_DIR").unwrap()),
        receipt: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_TRACE_011_RECEIPT").unwrap(),
        ),
        evidence_dir: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_TRACE_011_PI_EVIDENCE_DIR").unwrap(),
        ),
        expected_file_count: 352,
    };
    super::compute_candidate_pi_tests::run_compute_candidate_external("trace", 2, None, external)
        .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_trace_both_operations_and_enforces_permission_changes() {
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let fixture = project.join("tests/fixtures/devtools-trace-candidate01");
    let receipt: serde_json::Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-trace-candidate01.verification.json"))
            .unwrap(),
    )
    .unwrap();
    let files = receipt["files"].as_array().unwrap();
    let mut pending = vec![fixture.clone()];
    let mut actual_count = 0;
    while let Some(directory) = pending.pop() {
        for entry in std::fs::read_dir(directory).unwrap() {
            let entry = entry.unwrap();
            if entry.file_type().unwrap().is_dir() {
                pending.push(entry.path());
            } else {
                actual_count += 1;
            }
        }
    }
    assert_eq!(actual_count, files.len());
    for file in files {
        let bytes = std::fs::read(fixture.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["size"].as_u64().unwrap());
        assert_eq!(format!("{:x}", Sha256::digest(bytes)), file["sha256"]);
    }
    super::compute_candidate_pi_tests::run_compute_candidate(
        "trace",
        "devtools-trace-candidate01",
        2,
        None,
    )
    .await;
}

#[test]
#[ignore = "requires the retained real Studio Worker executable; run alone"]
fn trace_candidate_vectors_through_studio_broker() {
    use crate::plugin_capabilities::{CapabilityBroker, CapabilityInvocation};
    use crate::plugin_registry::PluginRegistry;
    use serde_json::{json, Value};

    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap();
    let fixture = project.join("tests/fixtures/devtools-trace-candidate01");
    let receipt: Value = serde_json::from_slice(
        &std::fs::read(project.join("tests/fixtures/devtools-trace-candidate01.verification.json"))
            .unwrap(),
    )
    .unwrap();
    for file in receipt["files"].as_array().unwrap() {
        let bytes = std::fs::read(fixture.join(file["path"].as_str().unwrap())).unwrap();
        assert_eq!(bytes.len() as u64, file["size"].as_u64().unwrap());
        assert_eq!(format!("{:x}", Sha256::digest(bytes)), file["sha256"]);
    }

    let root = project
        .join(".cache/task-scratch")
        .join(format!("trace-vectors-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("owner.json"),
        json!({"purpose":"actual Studio broker/Worker Trace vector audit", "pid":std::process::id(), "lifetime":"retain compact result receipt; remove isolated registry after audit"}).to_string(),
    )
    .unwrap();
    let registry_root = root.join("registry");
    let mut registry = PluginRegistry::open(registry_root.clone()).unwrap();
    registry.install_developer(&fixture).unwrap();
    registry
        .set_enabled("programming", "com.zicode.devtools.trace", true)
        .unwrap();
    let mut broker = CapabilityBroker::new(registry_root.clone()).unwrap();
    broker.worker_executable = Some(std::env::var_os("ZICODE_TEST_WORKER_EXE").unwrap().into());
    let cases: Value =
        serde_json::from_slice(&std::fs::read(fixture.join("fixtures/trace.json")).unwrap())
            .unwrap();
    let mut results = Vec::new();
    for case in cases["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let outcome = broker.invoke(
            &registry,
            CapabilityInvocation {
                caller: "view".into(),
                scene_id: "programming".into(),
                workspace_id: "trace-audit".into(),
                plugin_id: "com.zicode.devtools.trace".into(),
                capability_id: case["capabilityId"].as_str().unwrap().into(),
                tool_call_id: Some(id.into()),
                idempotency_scope: Some("trace-vectors".into()),
                input: case["input"].clone(),
            },
        );
        let schema_rejected = matches!(
            id,
            "java.trace-ascii-over"
                | "java.trace-wrong-type"
                | "django.trace-ascii-over"
                | "django.trace-wrong-type"
        );
        let (passed, actual_code) = match outcome {
            Ok(value) if case["expectedError"].is_string() => (
                !schema_rejected
                    && value["ok"] == false
                    && value["error"]["code"] == case["expectedError"],
                value["error"]["code"]
                    .as_str()
                    .unwrap_or("unexpected_success")
                    .to_owned(),
            ),
            Ok(value) => (
                !schema_rejected
                    && value["ok"] == true
                    && value["data"]["text"] == case["expectedText"],
                value["error"]["code"].as_str().unwrap_or("ok").to_owned(),
            ),
            Err(error) => (
                schema_rejected && error.code == "invalid_parameters",
                error.code.to_owned(),
            ),
        };
        results.push(json!({"id":id,"passed":passed,"stage":if schema_rejected {"studio-input-schema"} else {"production-worker"},"actualCode":actual_code}));
    }
    let passed = results
        .iter()
        .filter(|result| result["passed"] == true)
        .count();
    let worker_vectors = results
        .iter()
        .filter(|result| result["stage"] == "production-worker")
        .count();
    assert_eq!(worker_vectors, 36);
    std::fs::write(
        root.join("receipt.json"),
        serde_json::to_vec_pretty(
            &json!({"total":results.len(),"passed":passed,"workerVectors":worker_vectors,"schemaRejections":results.len()-worker_vectors,"results":results}),
        )
        .unwrap(),
    )
    .unwrap();
    std::fs::remove_dir_all(registry_root).unwrap();
    assert_eq!(
        passed,
        results.len(),
        "Trace vector mismatches: {}; receipt: {}",
        results.len() - passed,
        root.display()
    );
}

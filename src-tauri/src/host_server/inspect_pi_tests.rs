#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_inspect_all_operations_and_enforces_permission_changes() {
    super::compute_candidate_pi_tests::run_compute_candidate(
        "inspect", "devtools-inspect-candidate01", 7,
        Some(serde_json::json!({"id":"yaml.to_json","input":{"text":"a: ["},"expectedError":"INVALID_INPUT"})),
    ).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires external Inspect 0.1.1 candidate/receipt, evidence directory and retained Worker/Pi runtime; run alone"]
async fn embedded_pi_inspect_011_eight_operations_and_permission_lifecycle() {
    let external = super::compute_candidate_pi_tests::ExternalCandidate {
        source: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_INSPECT_011_DIR").unwrap()),
        receipt: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_INSPECT_011_RECEIPT").unwrap(),
        ),
        evidence_dir: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_INSPECT_011_PI_EVIDENCE_DIR").unwrap(),
        ),
        expected_file_count: 606,
    };
    super::compute_candidate_pi_tests::run_compute_candidate_external(
        "inspect",
        8,
        Some(serde_json::json!({"id":"yaml.to_json","input":{"text":"a: ["},"expectedError":"INVALID_INPUT"})),
        external,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Inspect 0.1.2, receipt, evidence directory and retained Worker/Pi runtime; run alone"]
async fn embedded_pi_inspect_012_eight_operations_and_permission_lifecycle() {
    let external = super::compute_candidate_pi_tests::ExternalCandidate {
        source: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_INSPECT_012_DIR").unwrap()),
        receipt: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_INSPECT_012_RECEIPT").unwrap()),
        evidence_dir: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_INSPECT_012_PI_EVIDENCE_DIR").unwrap(),
        ),
        expected_file_count: 616,
    };
    super::compute_candidate_pi_tests::run_compute_candidate_external(
        "inspect",
        8,
        Some(serde_json::json!({"id":"yaml.to_json","input":{"text":"a: ["},"expectedError":"INVALID_INPUT"})),
        external,
    )
    .await;
}

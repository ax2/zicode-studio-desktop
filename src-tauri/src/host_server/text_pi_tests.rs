#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Text 0.4.1 package/receipt, evidence directory and current Worker/Pi; run alone"]
async fn embedded_pi_text_041_seven_operations_and_permission_lifecycle() {
    let external = super::compute_candidate_pi_tests::ExternalCandidate {
        source: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_TEXT_041_DIR").unwrap()),
        receipt: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_TEXT_041_RECEIPT").unwrap()),
        evidence_dir: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_TEXT_041_PI_EVIDENCE_DIR").unwrap(),
        ),
        expected_file_count: 112,
    };
    super::compute_candidate_pi_tests::run_compute_candidate_external(
        "text",
        7,
        Some(serde_json::json!({"id":"json.validate","input":{"text":"not-json"},"expectedError":"INVALID_INPUT"})),
        external,
    )
    .await;
}

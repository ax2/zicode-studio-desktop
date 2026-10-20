#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen ZICODE_TEST_WORKER_EXE and embedded Pi/broker; run alone"]
async fn embedded_pi_transforms_all_operations_and_enforces_permission_changes() {
    super::compute_candidate_pi_tests::run_compute_candidate(
        "transforms",
        "devtools-transforms-candidate01",
        23,
        None,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires frozen Transforms 0.1.1 package/receipt, evidence directory and current Worker/Pi; run alone"]
async fn embedded_pi_transforms_011_all_operations_and_permission_lifecycle() {
    let external = super::compute_candidate_pi_tests::ExternalCandidate {
        source: std::path::PathBuf::from(std::env::var_os("ZICODE_TEST_TRANSFORMS_011_DIR").unwrap()),
        receipt: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_TRANSFORMS_011_RECEIPT").unwrap(),
        ),
        evidence_dir: std::path::PathBuf::from(
            std::env::var_os("ZICODE_TEST_TRANSFORMS_011_PI_EVIDENCE_DIR").unwrap(),
        ),
        expected_file_count: 804,
    };
    super::compute_candidate_pi_tests::run_compute_candidate_external(
        "transforms",
        23,
        None,
        external,
    )
    .await;
}

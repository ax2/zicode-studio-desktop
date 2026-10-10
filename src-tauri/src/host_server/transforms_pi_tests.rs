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

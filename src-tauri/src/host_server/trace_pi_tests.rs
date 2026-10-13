use sha2::{Digest, Sha256};

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

use super::*;
use serde_json::json;
use std::time::Instant;

#[test]
#[ignore = "current-engine phase diagnosis only; not old-EXE or Host deadline acceptance"]
fn measure_compute_timeout_candidates_in_current_engine() {
    use sha2::{Digest, Sha256};
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
    let mut rows = Vec::new();
    for (family, operations, expected_hash) in [
        (
            "inspect",
            ["yaml.to_json", "yaml.from_json"],
            "d59d513481d45a68541dade32989032f7bb1d49c5bd4376595cdb53e9ab0b294",
        ),
        (
            "transforms",
            ["url.encode", "url.decode"],
            "de8c6e2429c0abd282c4e339951e8fcece4c7ddb5e393983a9de7f3bb66f15bb",
        ),
    ] {
        let root = fixtures.join(format!("devtools-{family}-candidate01"));
        let worker = root.join("runtime/tools.wasm");
        let hash = format!("{:x}", Sha256::digest(fs::read(&worker).unwrap()));
        assert_eq!(hash, expected_hash, "Frozen module changed");
        let cases: Value = serde_json::from_slice(
            &fs::read(root.join(format!("fixtures/{family}.json"))).unwrap(),
        )
        .unwrap();
        for operation in operations {
            let case = cases["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|case| case["id"] == format!("{operation}-sample"))
                .unwrap();
            eprintln!("compute-diagnostic begin family={family} operation={operation}");
            let started = Instant::now();
            let result = execute_wasi(&WorkerRequest {
                worker_path: worker.to_string_lossy().into_owned(),
                worker_kind: "wasi".into(),
                plugin_id: format!("com.zicode.devtools.{family}"),
                scene_id: "programming".into(),
                capability_id: Some(case["capabilityId"].as_str().unwrap().into()),
                command_id: None,
                input: case["input"].clone(),
            });
            let exact = result.as_ref().is_ok_and(|value| {
                value["ok"] == true && value["data"]["text"] == case["expectedText"]
            });
            let outcome = match &result {
                Ok(_) if exact => "exact_sample_pass",
                Ok(_) => "output_mismatch",
                Err(error) => failures::public(Some(error)).0,
            };
            rows.push(
                json!({"family":family,"operation":operation,"moduleSha256":hash,
                "durationUs":started.elapsed().as_micros(),"outcome":outcome,"exact":exact}),
            );
            eprintln!(
                "compute-diagnostic end family={family} operation={operation} outcome={outcome}"
            );
        }
    }
    if let Some(path) = std::env::var_os("ZICODE_COMPUTE_ENGINE_EVIDENCE") {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(
            file,
            &json!({"observationCompleted":true,"rows":rows,
            "hostDeadlineTested":false,"oldWorkerExeTested":false,"piAccepted":false,
            "fuel":10000000,"guestMemoryMiB":64,"optimization":"None"}),
        )
        .unwrap();
    }
    assert!(rows.iter().all(|row| row["exact"] == true));
}

#[test]
#[ignore = "real provider module cold-compile and fuel observation; no Host deadline acceptance"]
fn measure_diagnostics_candidate_in_actual_engine() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tests/fixtures/devtools-diagnostics-candidate01");
    let html = fs::read_to_string(root.join("views/main.html")).unwrap();
    let actions = html
        .lines()
        .find(|line| line.starts_with("const actions = "))
        .unwrap()
        .trim_start_matches("const actions = ")
        .trim_end_matches("; // diagnostic-actions-end");
    let actions: Vec<Value> = serde_json::from_str(actions).unwrap();
    assert_eq!(actions.len(), 11);
    let mut results = Vec::new();
    for action in actions {
        let id = action["id"].as_str().unwrap();
        eprintln!("diagnostic-case={id}");
        let started = Instant::now();
        let result = execute_wasi(&WorkerRequest {
            worker_path: root
                .join("runtime/tools.wasm")
                .to_string_lossy()
                .into_owned(),
            worker_kind: "wasi".into(),
            plugin_id: "com.zicode.devtools.diagnostics".into(),
            scene_id: "programming".into(),
            capability_id: Some(format!("devtools.diagnostics.{id}")),
            command_id: None,
            input: json!({"text":action["text"],"secondary":action["secondary"]}),
        });
        let code = match &result {
            Ok(value) if value["ok"] == true => {
                let report: Value =
                    serde_json::from_str(value["data"]["text"].as_str().unwrap()).unwrap();
                assert!(report.is_object());
                "success"
            }
            Ok(_) => "provider_report_rejected",
            Err(error) => failures::public(Some(error)).0,
        };
        results.push(json!({"id":id,"durationMs":started.elapsed().as_millis(),"outcome":code}));
    }
    if let Some(path) = std::env::var_os("ZICODE_DIAGNOSTIC_ENGINE_EVIDENCE") {
        let file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)
            .unwrap();
        serde_json::to_writer_pretty(file, &json!({"observationCompleted":true,"rows":results,
            "profileAccepted":false,"hostDeadlineTested":false,"fuel":10000000,"guestMemoryMiB":64})).unwrap();
    }
}

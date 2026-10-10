use super::{catalog, tests::Fixture, TaskRunner};
use serde_json::json;
use std::path::Path;

#[tokio::test]
#[ignore = "requires installed Cargo and Go toolchains; runs only disposable offline projects"]
async fn checks_real_cargo_and_go_projects() {
    for (manager, id) in [("cargo", "@cargo/check"), ("go", "@go/test")] {
        let fixture = Fixture::new();
        if manager == "cargo" {
            std::fs::create_dir_all(fixture.0.join("src")).unwrap();
            std::fs::create_dir_all(fixture.0.join(".cargo")).unwrap();
            std::fs::write(
                fixture.0.join("Cargo.toml"),
                "[package]\nname='zicode_task_fixture'\nversion='0.1.0'\nedition='2021'\n",
            )
            .unwrap();
            std::fs::write(
                fixture.0.join(".cargo/config.toml"),
                "[net]\noffline=true\n[build]\ntarget-dir='target'\n",
            )
            .unwrap();
            std::fs::write(
                fixture.0.join("src/lib.rs"),
                "pub fn answer() -> i32 { 42 }\n",
            )
            .unwrap();
        } else {
            std::fs::write(
                fixture.0.join("go.mod"),
                "module example.invalid/zicodefixture\ngo 1.22\n",
            )
            .unwrap();
            std::fs::write(
                fixture.0.join("fixture.go"),
                "package fixture\nfunc Answer() int { return 42 }\n",
            )
            .unwrap();
            std::fs::write(fixture.0.join("fixture_test.go"), "package fixture\nimport \"testing\"\nfunc TestAnswer(t *testing.T) { if Answer() != 42 { t.Fatal(\"wrong answer\") } }\n").unwrap();
        }
        let runner = TaskRunner::default();
        let fingerprint = catalog::read(&fixture.0).unwrap().fingerprint;
        let run = runner
            .start(&fixture.0, "fixture", id, &fingerprint)
            .unwrap();
        assert_eq!(run.manager, manager);
        let finished = tokio::time::timeout(std::time::Duration::from_secs(90), async {
            loop {
                let run = runner.list("fixture").remove(0);
                if run.finished_at.is_some() {
                    break run;
                }
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("disposable language project must finish");
        assert_eq!(finished.status, "succeeded", "{}", finished.stderr);
        assert_eq!(finished.exit_code, Some(0));
        println!(
            "verified {}: exit 0; captured stdout={} stderr={}",
            finished.invocation,
            finished.stdout.len(),
            finished.stderr.len()
        );
    }
}

#[test]
fn discovers_mixed_projects_with_distinct_ids_and_fixed_arguments() {
    let fixture = Fixture::new();
    fixture
        .scripts(json!({"cargo:check":"echo script", "build":"echo js", "@cargo/check":"never"}));
    std::fs::write(
        fixture.0.join("Cargo.toml"),
        "[package]\nname='fixture'\nversion='0.1.0'\n",
    )
    .unwrap();
    std::fs::write(
        fixture.0.join("go.mod"),
        "module example.invalid/fixture\ngo 1.22\n",
    )
    .unwrap();
    let catalog = catalog::read(&fixture.0).unwrap();
    assert_eq!(catalog.manager, "bun / cargo / go");
    assert_eq!(catalog.tasks.len(), 9);
    let ids: std::collections::HashSet<_> = catalog.tasks.iter().map(|task| &task.id).collect();
    assert_eq!(ids.len(), catalog.tasks.len());
    for (id, source, expected) in [
        (
            "@package/cargo:check",
            "package.json",
            vec!["run", "cargo:check"],
        ),
        ("@cargo/check", "Cargo.toml", vec!["check"]),
        ("@cargo/test", "Cargo.toml", vec!["test"]),
        ("@cargo/build", "Cargo.toml", vec!["build"]),
        ("@go/test", "go.mod", vec!["test", "./..."]),
        ("@go/build", "go.mod", vec!["build", "./..."]),
        ("@go/vet", "go.mod", vec!["vet", "./..."]),
    ] {
        let task = catalog.tasks.iter().find(|task| task.id == id).unwrap();
        assert_eq!(task.source, source);
        assert_eq!(task.arguments, expected);
        let command = catalog::task_command(Path::new("fixture-tool.exe"), task).unwrap();
        assert_eq!(
            command
                .get_args()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
            expected
        );
        assert!(task.runnable);
    }
    assert!(
        !catalog
            .tasks
            .iter()
            .find(|task| task.id == "@package/@cargo/check")
            .unwrap()
            .runnable
    );
    assert!(!serde_json::to_string(&catalog)
        .unwrap()
        .contains("arguments"));
}

#[test]
fn manifest_changes_and_removal_invalidate_the_entire_catalog() {
    let fixture = Fixture::new();
    let empty = catalog::read(&fixture.0).unwrap();
    std::fs::write(fixture.0.join("Cargo.toml"), "go.mod").unwrap();
    let old = catalog::read(&fixture.0).unwrap();
    assert_ne!(old.fingerprint, empty.fingerprint);
    // Length framing prevents file-boundary changes from hashing to the same catalog.
    std::fs::write(fixture.0.join("Cargo.toml"), "").unwrap();
    std::fs::write(fixture.0.join("go.mod"), "").unwrap();
    let new = catalog::read(&fixture.0).unwrap();
    assert_ne!(old.fingerprint, new.fingerprint);
    assert_eq!(
        TaskRunner::default()
            .start(&fixture.0, "p", "@cargo/check", &old.fingerprint)
            .err()
            .unwrap(),
        "task_catalog_changed"
    );
    std::fs::remove_file(fixture.0.join("Cargo.toml")).unwrap();
    let removed = catalog::read(&fixture.0).unwrap();
    assert_ne!(new.fingerprint, removed.fingerprint);
    assert!(removed.tasks.iter().all(|task| task.manager == "go"));
}

#[test]
fn refuses_directories_and_oversized_language_manifests() {
    let fixture = Fixture::new();
    std::fs::create_dir(fixture.0.join("Cargo.toml")).unwrap();
    assert_eq!(
        catalog::read(&fixture.0).unwrap_err(),
        "task_manifest_invalid"
    );
    std::fs::remove_dir(fixture.0.join("Cargo.toml")).unwrap();
    std::fs::write(fixture.0.join("go.mod"), vec![b'x'; 256 * 1024 + 1]).unwrap();
    assert_eq!(
        catalog::read(&fixture.0).unwrap_err(),
        "task_manifest_too_large"
    );
}

#[tokio::test]
async fn executes_namespaced_package_ids_without_changing_the_script_name() {
    let fixture = Fixture::runnable();
    let runner = TaskRunner::default();
    let fingerprint = catalog::read(&fixture.0).unwrap().fingerprint;
    let run = runner
        .start(&fixture.0, "p", "@package/ok", &fingerprint)
        .unwrap();
    assert_eq!(run.name, "ok");
    assert_eq!(run.invocation, "bun run ok");
    let finished = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            let run = runner.list("p").remove(0);
            if run.finished_at.is_some() {
                break run;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(finished.status, "succeeded");
}

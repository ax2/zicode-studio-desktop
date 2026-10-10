use super::{catalog, directories, protocol, tests::Fixture, TaskRunner};
use serde_json::json;

#[test]
fn discovers_supported_subprojects_and_skips_dependencies() {
    let fixture = Fixture::new();
    for path in [
        "frontend",
        "services/api",
        "node_modules/hidden",
        ".git/hidden",
        "target/hidden",
        "a/b/c/d/e",
    ] {
        std::fs::create_dir_all(fixture.0.join(path)).unwrap();
        std::fs::write(fixture.0.join(path).join("Cargo.toml"), "[package]").unwrap();
    }
    let found = directories::discover(&fixture.0).unwrap();
    let paths: Vec<_> = found
        .directories
        .iter()
        .map(|item| item.path.as_str())
        .collect();
    assert_eq!(paths, ["", "frontend", "services/api"]);
    assert!(found.incomplete); // The fifth level is not scanned.
    assert_eq!(found.directories[1].manifests, ["Cargo.toml"]);
}

#[test]
fn bounds_discovery_results_and_directory_entries() {
    let fixture = Fixture::new();
    for index in 0..70 {
        let path = fixture.0.join(format!("project-{index:03}"));
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("go.mod"), "module fixture").unwrap();
    }
    let found = directories::discover(&fixture.0).unwrap();
    assert_eq!(found.directories.len(), 64);
    assert!(found.incomplete);
    let many = Fixture::new();
    for index in 0..2050 {
        std::fs::write(many.0.join(format!("file-{index}")), "").unwrap();
    }
    assert!(directories::discover(&many.0).unwrap().incomplete);
}

#[test]
fn rejects_paths_outside_workspace_and_binds_fingerprint_to_directory() {
    let fixture = Fixture::new();
    for path in ["a", "b"] {
        std::fs::create_dir(fixture.0.join(path)).unwrap();
        std::fs::write(
            fixture.0.join(path).join("package.json"),
            r#"{"scripts":{"same":"echo same"}}"#,
        )
        .unwrap();
    }
    for path in [
        "..", "a/../b", "/tmp", "C:/tmp", "a\\b", "a//b", "a/.", "a/", "a\0",
    ] {
        assert!(directories::resolve(&fixture.0, path).is_err(), "{path}");
    }
    let a = directories::resolve(&fixture.0, "a").unwrap();
    let b = directories::resolve(&fixture.0, "b").unwrap();
    assert_ne!(
        catalog::read(&a).unwrap().fingerprint,
        catalog::read(&b).unwrap().fingerprint
    );
    let runner = TaskRunner::default();
    assert_eq!(
        runner
            .start_in(
                &fixture.0,
                "w",
                "b",
                "same",
                &catalog::read(&a).unwrap().fingerprint
            )
            .err()
            .as_deref(),
        Some("task_catalog_changed")
    );
    for value in [json!(null), json!(false), json!(42)] {
        assert_eq!(
            protocol::dispatch(
                &runner,
                &fixture.0,
                "w",
                "r",
                "project_task_catalog",
                &json!({"directory": value})
            )
            .unwrap_err(),
            "task_directory_invalid"
        );
    }
    std::fs::remove_dir_all(a).unwrap();
    assert!(runner
        .start_in(&fixture.0, "w", "a", "same", "old")
        .is_err());
}

#[cfg(unix)]
#[test]
fn skips_and_rejects_directory_symlinks() {
    let fixture = Fixture::new();
    let outside = Fixture::new();
    std::fs::write(outside.0.join("go.mod"), "module fixture").unwrap();
    std::os::unix::fs::symlink(&outside.0, fixture.0.join("external")).unwrap();
    std::os::unix::fs::symlink(&fixture.0, fixture.0.join("loop")).unwrap();
    assert!(directories::resolve(&fixture.0, "external").is_err());
    assert!(directories::resolve(&fixture.0, "loop").is_err());
    assert_eq!(
        directories::discover(&fixture.0).unwrap().directories.len(),
        1
    );
}

#[tokio::test]
async fn executes_in_selected_directory_and_keeps_workspace_history() {
    let fixture = Fixture::runnable();
    let sub = fixture.0.join("services").join("中文 api");
    std::fs::create_dir_all(&sub).unwrap();
    std::fs::copy(fixture.0.join("package.json"), sub.join("package.json")).unwrap();
    std::fs::write(
        sub.join("task.cjs"),
        "require('node:fs').writeFileSync('ran-here', 'yes'); console.log('nested-output')",
    )
    .unwrap();
    let runner = TaskRunner::default();
    let preview = catalog::read_in(&sub, &fixture.0).unwrap();
    let run = runner
        .start_in(
            &fixture.0,
            "w",
            "services/中文 api",
            "ok",
            &preview.fingerprint,
        )
        .unwrap();
    assert_eq!(run.directory, "services/中文 api");
    let finished = super::tests::finished(&runner, "w").await;
    assert_eq!(finished.status, "succeeded");
    assert!(finished.stdout.contains("nested-output"));
    assert!(sub.join("ran-here").is_file());
    assert!(!fixture.0.join("ran-here").exists());
    assert_eq!(runner.list("w").len(), 1);
    assert!(runner.list("other").is_empty());
}

#[cfg(windows)]
#[test]
fn skips_and_rejects_windows_directory_junctions() {
    let fixture = Fixture::new();
    let outside = Fixture::new();
    let link = fixture.0.join("external");
    let output = crate::process_command::new_command("cmd.exe")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(&link)
        .arg(&outside.0)
        .output()
        .unwrap();
    assert!(output.status.success(), "junction creation failed");
    assert!(directories::resolve(&fixture.0, "external").is_err());
    assert_eq!(
        directories::discover(&fixture.0).unwrap().directories.len(),
        1
    );
    std::fs::remove_dir(&link).unwrap();
}

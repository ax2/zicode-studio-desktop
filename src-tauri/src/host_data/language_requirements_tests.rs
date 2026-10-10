use super::*;

#[test]
fn reads_rust_minimum_and_resolves_only_local_explicit_inheritance() {
    let values = parse("Cargo.toml", "[package]\nrust-version = '1.78'\n").unwrap();
    assert_eq!(values[0].tool, "rustc");
    assert_eq!(values[0].kind, Some("minimum"));
    assert_eq!(values[0].constraint, "1.78");
    let values = parse(
        "Cargo.toml",
        "[package]\nrust-version.workspace = true\n[workspace.package]\nrust-version = '1.88'\n",
    )
    .unwrap();
    assert_eq!(values[0].constraint, "1.88");
    let values = parse("Cargo.toml", "[package]\nrust-version.workspace = true").unwrap();
    assert_eq!(values[0].kind, Some("inherited"));
    assert!(
        parse("Cargo.toml", "[workspace.package]\nrust-version = '1.88'")
            .unwrap()
            .is_empty()
    );
    assert!(parse("Cargo.toml", "[package]\nrust-version = 1.88").is_err());
    assert!(parse("Cargo.toml", "[package]\nrust-version.workspace = false").is_err());
}

#[test]
fn reads_toolchain_without_returning_paths_components_or_executing_anything() {
    let values = parse(
        "rust-toolchain.toml",
        "[toolchain]\nchannel='1.88.0'\ncomponents=['clippy']\nprofile='minimal'",
    )
    .unwrap();
    assert_eq!(values[0].constraint, "1.88.0");
    assert_eq!(values[0].kind, Some("toolchain"));
    assert_eq!(
        parse("rust-toolchain", "nightly-2026-09-01\n").unwrap()[0].constraint,
        "nightly-2026-09-01"
    );
    assert!(parse("rust-toolchain", "1.88.0\n1.89.0").is_err());
    assert!(parse("rust-toolchain.toml", "toolchain = 42").is_err());
    assert!(parse("rust-toolchain.toml", "[toolchain]\nchannel=42").is_err());
    assert!(
        parse("rust-toolchain.toml", "[toolchain]\npath='private-path'")
            .unwrap()
            .is_empty()
    );
    let long = format!("[toolchain]\nchannel='{}'", "a".repeat(210));
    let values = parse("rust-toolchain.toml", &long).unwrap();
    assert!(values[0].truncated);
    assert_eq!(values[0].constraint.len(), 200);
}

#[test]
fn extracts_only_top_level_go_directives_and_preserves_recommendation() {
    let values = parse("go.mod", "module example.invalid/demo\n// go 9.99\ngo 1.23.0 // minimum\ntoolchain go1.23.4\nrequire (\n example.invalid/go v1.0.0\n)\nreplace example.invalid/x => \"./go 9.99\"\n").unwrap();
    assert_eq!(values.len(), 2);
    assert_eq!(values[0].constraint, "1.23.0");
    assert_eq!(values[0].kind, Some("minimum"));
    assert_eq!(values[1].constraint, "go1.23.4");
    assert_eq!(values[1].kind, Some("recommended"));
    assert_eq!(
        parse("go.mod", "go \"1.23\"\ntoolchain default").unwrap()[1].constraint,
        "default"
    );
    for text in [
        "go",
        "go 1.22 1.23",
        "go 1.22\ngo 1.23",
        "toolchain go1.23\ntoolchain default",
        "require (",
        "go \"1.23",
    ] {
        assert!(parse("go.mod", text).is_err(), "{text}");
    }
}

#[test]
fn reads_bounded_real_manifests_and_marks_conflicting_toolchain_files() {
    let root = std::env::temp_dir().join(format!("zicode-language-env-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let root = root.canonicalize().unwrap();
    std::fs::write(root.join("Cargo.toml"), "[package]\nrust-version='1.88'\n").unwrap();
    std::fs::write(
        root.join("go.mod"),
        "module example.invalid/local\ngo 1.23\n",
    )
    .unwrap();
    let values = super::super::inspect(&root);
    assert_eq!(values.len(), 2);
    assert!(values
        .iter()
        .all(|v| v.status == "detected" && v.requirements.len() == 1));
    std::fs::write(root.join("go.mod"), vec![b'a'; 256 * 1024 + 1]).unwrap();
    assert_eq!(super::super::inspect(&root)[1].status, "too_large");
    std::fs::write(root.join("rust-toolchain"), "1.88.0").unwrap();
    std::fs::write(
        root.join("rust-toolchain.toml"),
        "[toolchain]\nchannel='1.89.0'",
    )
    .unwrap();
    let values = super::super::inspect(&root);
    assert_eq!(values[1].status, "conflicting");
    assert_eq!(values[2].status, "conflicting");
    std::fs::write(root.join("Cargo.toml"), "[package\nrust-version='1.88'").unwrap();
    assert_eq!(super::super::inspect(&root)[0].status, "invalid");
    std::fs::remove_dir_all(root).unwrap();
}

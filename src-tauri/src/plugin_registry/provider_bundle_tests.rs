use super::*;

#[test]
fn frozen_devtools_nine_package_bundle_passes_registry_admission_disabled() {
    let project = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let revision = "devtools-catalog-2026-10-18-9c17b7b91e84f1c7";
    let bundle = project
        .join("tests/fixtures")
        .join(format!("{revision}-package-bundle"));
    let receipt: Value = serde_json::from_slice(
        &fs::read(
            project
                .join("tests/fixtures")
                .join(format!("{revision}-verification.json")),
        )
        .unwrap(),
    )
    .unwrap();
    let packages = receipt["packages"].as_array().unwrap();
    assert_eq!(packages.len(), 9);
    let root = project
        .join(".cache/task-scratch")
        .join(format!("devtools-nine-registry-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("owner.json"),
        r#"{"purpose":"frozen ZiDevTools nine package registry admission","lifetime":"remove on pass; retain on failure"}"#,
    )
    .unwrap();
    let mut registry = PluginRegistry::open(root.join("registry")).unwrap();
    for package in packages {
        let source = bundle.join(package["path"].as_str().unwrap());
        let expected_id = package["packageId"].as_str().unwrap();
        assert_eq!(registry.install_developer(&source).unwrap(), expected_id);
        let listed = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == expected_id)
            .unwrap();
        assert_eq!(listed.manifest.version, package["packageVersion"]);
        assert!(!listed.enabled, "{expected_id} must remain disabled");
        assert!(listed.permission_grants.values().all(|granted| !granted));
    }
    assert_eq!(
        registry
            .list("programming")
            .into_iter()
            .filter(|plugin| plugin.manifest.id.starts_with("com.zicode.devtools."))
            .count(),
        9
    );
    fs::remove_dir_all(root).unwrap();
}

use super::*;
use crate::plugin_package::{write_test_signed_package, write_test_signed_package_with_key};

const SCENE: &str = "programming";
const STORAGE: &str = "storage.plugin";
const RESOURCE: &str = "resource.read";

fn manifest(id: &str, version: &str, required: &[&str]) -> Value {
    json!({
        "schemaVersion": 1, "id": id, "version": version,
        "name": "Authorization fixture", "description": "Local test package",
        "publisher": "Synthetic publisher",
        "permissions": { "required": required.iter().map(|name| {
            json!({"name":name, "reason":"Use a synthetic local resource"})
        }).collect::<Vec<_>>() }
    })
}

fn developer_package(path: &Path, id: &str) {
    fs::create_dir_all(path).unwrap();
    fs::write(
        path.join("plugin.json"),
        serde_json::to_vec(&manifest(id, "1.0.0", &[STORAGE])).unwrap(),
    )
    .unwrap();
}

fn approve(registry: &mut PluginRegistry, scene: &str, id: &str, grants: &[&str]) {
    let review = registry
        .activation_review(scene, &registry.plugins[id])
        .unwrap();
    let grants: Vec<String> = grants.iter().map(|grant| (*grant).into()).collect();
    registry
        .activate_reviewed(scene, id, &review, &grants)
        .unwrap();
}

fn state(registry: &PluginRegistry, scene: &str, id: &str) -> PluginExecutionSnapshot {
    registry
        .execution_plugin(scene, id)
        .expect("installed fixture")
}

#[test]
fn cold_start_binds_only_verifiable_managed_legacy_installations() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("plugins");
    let first = "com.example.active-legacy";
    let absent = "com.example.uninstalled-legacy";
    let unmanaged = "com.example.unmanaged-legacy";
    let active_source = temp.path().join("active-source");
    let absent_source = temp.path().join("absent-source");
    developer_package(&active_source, first);
    developer_package(&absent_source, absent);

    let mut registry = PluginRegistry::open(root.clone()).unwrap();
    registry.install_developer(&active_source).unwrap();
    developer_package(&root.join("developer/noncanonical-name"), unmanaged);
    drop(registry);
    let state_path = root.join("registry.json");
    fs::write(
        &state_path,
        serde_json::to_vec(&json!({
            "version": 1,
            "scenes": {
                SCENE: {
                    first: {"enabled":true,"permissions":{STORAGE:true}},
                    absent: {"enabled":true,"permissions":{STORAGE:true}},
                    unmanaged: {"enabled":true,"permissions":{STORAGE:true}},
                    "core.chat": {"enabled":true,"permissions":{}}
                },
                "legacy-scene": { first: {"enabled":false,"permissions":{STORAGE:false}} }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    let mut registry = PluginRegistry::open(root.clone()).unwrap();
    assert!(state(&registry, SCENE, first).enabled);
    assert!(state(&registry, SCENE, first).permission_grants[STORAGE]);
    assert!(!state(&registry, "legacy-scene", first).enabled);
    assert!(!state(&registry, "legacy-scene", first).permission_grants[STORAGE]);
    assert!(!state(&registry, SCENE, unmanaged).enabled);
    assert!(state(&registry, SCENE, "core.chat").enabled);

    registry.install_developer(&absent_source).unwrap();
    registry.reload_developer_plugins().unwrap();
    assert!(!state(&registry, SCENE, absent).enabled);
    assert!(!state(&registry, SCENE, absent).permission_grants[STORAGE]);
    drop(registry);
    let mut registry = PluginRegistry::open(root.clone()).unwrap();
    assert!(!state(&registry, SCENE, absent).enabled);
    assert!(!state(&registry, SCENE, absent).permission_grants[STORAGE]);
    approve(&mut registry, SCENE, absent, &[STORAGE]);
    assert!(state(&registry, SCENE, absent).enabled);

    // Clearing the source on an already migrated row leaves it unverified.
    let mut disk_state: Value = serde_json::from_slice(&fs::read(&state_path).unwrap()).unwrap();
    assert_eq!(disk_state["authorizationMigrated"], true);
    disk_state["scenes"][SCENE][first]
        .as_object_mut()
        .unwrap()
        .remove("authorizationSource");
    drop(registry);
    fs::write(&state_path, serde_json::to_vec(&disk_state).unwrap()).unwrap();
    let registry = PluginRegistry::open(root).unwrap();
    assert!(!state(&registry, SCENE, first).enabled);
    assert!(!state(&registry, SCENE, first).permission_grants[STORAGE]);
    assert!(state(&registry, SCENE, absent).enabled);
}

#[test]
fn verified_signer_retains_grants_across_versions_but_new_permissions_and_signers_wait() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("plugins");
    let packages = temp.path().join("packages");
    let id = "com.example.signed-authorization";
    let first = write_test_signed_package(
        &packages,
        &manifest(id, "1.0.0", &[STORAGE]),
        "first.zicode-plugin",
    );
    let upgrade = write_test_signed_package(
        &packages,
        &manifest(id, "1.1.0", &[STORAGE]),
        "upgrade.zicode-plugin",
    );
    let added = write_test_signed_package(
        &packages,
        &manifest(id, "1.2.0", &[STORAGE, RESOURCE]),
        "added.zicode-plugin",
    );
    let different = write_test_signed_package_with_key(
        &packages,
        &manifest(id, "2.0.0", &[STORAGE]),
        "different.zicode-plugin",
        &[29; 32],
    );
    let mut registry = PluginRegistry::open(root.clone()).unwrap();
    registry.install_signed(&first, true).unwrap();
    approve(&mut registry, SCENE, id, &[STORAGE]);
    registry.install_signed(&upgrade, false).unwrap();
    assert!(state(&registry, SCENE, id).enabled);
    assert!(state(&registry, SCENE, id).permission_grants[STORAGE]);
    assert!(!state(&registry, "another-scene", id).enabled);

    registry.install_signed(&added, false).unwrap();
    let waiting = state(&registry, SCENE, id);
    assert!(!waiting.enabled);
    assert!(waiting.permission_grants[STORAGE]);
    assert!(!waiting.permission_grants[RESOURCE]);
    registry.rollback_signed(id, "1.1.0").unwrap();
    assert!(state(&registry, SCENE, id).enabled);

    assert!(registry.install_signed(&different, false).is_err());
    assert!(state(&registry, SCENE, id).enabled);
    registry.install_signed(&different, true).unwrap();
    let replaced = state(&registry, SCENE, id);
    assert_eq!(replaced.manifest.version, "2.0.0");
    assert!(!replaced.enabled);
    assert!(!replaced.permission_grants[STORAGE]);

    drop(registry);
    let mut registry = PluginRegistry::open(root).unwrap();
    assert!(!state(&registry, SCENE, id).enabled);
    registry.rollback_signed(id, "1.1.0").unwrap();
    assert!(state(&registry, SCENE, id).enabled);
    assert!(state(&registry, SCENE, id).permission_grants[STORAGE]);
}

#[test]
fn retired_signed_records_do_not_follow_an_unsigned_source_or_another_profile() {
    let temp = tempfile::tempdir().unwrap();
    let profile = temp.path().join("profile");
    let root = profile.join("plugins");
    let packages = temp.path().join("packages");
    let id = "com.example.reinstalled-source";
    let signed = write_test_signed_package(
        &packages,
        &manifest(id, "1.0.0", &[STORAGE]),
        "signed.zicode-plugin",
    );
    let developer = temp.path().join("developer");
    developer_package(&developer, id);
    let data = profile.join("plugin-data").join(id);
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("keep.txt"), b"existing synthetic data").unwrap();

    let mut registry = PluginRegistry::open(root.clone()).unwrap();
    let key = registry.preview_signed(&signed).unwrap().publisher_key_id;
    registry.install_signed(&signed, true).unwrap();
    approve(&mut registry, SCENE, id, &[STORAGE]);
    registry.uninstall_developer(id).unwrap();

    registry.install_signed(&signed, false).unwrap();
    assert!(state(&registry, SCENE, id).enabled);
    registry.uninstall_developer(id).unwrap();
    registry.install_developer(&developer).unwrap();
    assert!(!state(&registry, SCENE, id).enabled);
    assert!(!state(&registry, SCENE, id).permission_grants[STORAGE]);

    let mut another = PluginRegistry::open(temp.path().join("different-profile/plugins")).unwrap();
    another.install_signed(&signed, true).unwrap();
    assert!(!state(&another, SCENE, id).enabled);
    assert!(!state(&another, SCENE, id).permission_grants[STORAGE]);

    registry.uninstall_developer(id).unwrap();
    assert!(registry.revoke_signed_publisher(&key).unwrap().is_empty());
    drop(registry);
    let mut registry = PluginRegistry::open(root).unwrap();
    let stored = &registry.state.scenes[SCENE][id];
    assert_eq!(stored.enabled, Some(false));
    assert!(stored.permissions.is_empty());
    assert!(registry
        .install_signed(&signed, true)
        .unwrap_err()
        .contains("revoked"));
    assert_eq!(
        fs::read(data.join("keep.txt")).unwrap(),
        b"existing synthetic data"
    );
}

#[test]
fn failed_signed_archive_preparation_preserves_the_previous_install_and_authority() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("plugins");
    let id = "com.example.signed-failed-update";
    let first = write_test_signed_package(
        temp.path(),
        &manifest(id, "1.0.0", &[STORAGE]),
        "first.zicode-plugin",
    );
    let update = write_test_signed_package_with_key(
        temp.path(),
        &manifest(id, "2.0.0", &[STORAGE]),
        "update.zicode-plugin",
        &[31; 32],
    );
    let mut registry = PluginRegistry::open(root.clone()).unwrap();
    registry.install_signed(&first, true).unwrap();
    approve(&mut registry, SCENE, id, &[STORAGE]);
    let before_metadata = fs::read(registry.signed_metadata_path(id)).unwrap();
    let before_manifest = fs::read(root.join("signed").join(id).join("plugin.json")).unwrap();
    let before_state = fs::read(root.join("registry.json")).unwrap();

    fs::write(
        root.join("signed-versions"),
        b"occupied during archive preflight",
    )
    .unwrap();
    let error = registry.install_signed(&update, true).unwrap_err();
    assert!(
        error.contains("Cannot prepare signed plugin rollback storage"),
        "{error}"
    );
    assert!(!registry.preview_signed(&update).unwrap().trusted);
    assert!(state(&registry, SCENE, id).enabled);
    assert_eq!(
        fs::read(registry.signed_metadata_path(id)).unwrap(),
        before_metadata
    );
    assert_eq!(
        fs::read(root.join("signed").join(id).join("plugin.json")).unwrap(),
        before_manifest
    );
    assert_eq!(fs::read(root.join("registry.json")).unwrap(), before_state);
    drop(registry);
    let registry = PluginRegistry::open(root).unwrap();
    assert!(state(&registry, SCENE, id).enabled);
    assert!(state(&registry, SCENE, id).permission_grants[STORAGE]);
}

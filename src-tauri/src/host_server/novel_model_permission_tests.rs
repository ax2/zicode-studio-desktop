use super::*;

#[test]
fn model_authorization_tracks_notes_enablement_storage_network_and_scene_revocation() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch/visual-assets-model-jobs")
        .join(format!("permissions-{}", uuid::Uuid::new_v4()));
    let mut registry = crate::plugin_registry::PluginRegistry::open(root.join("plugins")).unwrap();
    let scene = "programming";
    let notes = "com.zicode.notes";
    registry.set_enabled(scene, notes, true).unwrap();
    registry
        .set_permission(scene, notes, "storage.plugin", false)
        .unwrap();
    registry
        .set_permission(scene, notes, "network.fetch", true)
        .unwrap();
    assert_eq!(
        authorize_model(&registry, scene).unwrap_err().to_string(),
        "visual_assets_chapter_access_denied"
    );
    registry
        .set_permission(scene, notes, "storage.plugin", true)
        .unwrap();
    // Revoking a required permission disables the plugin; regranting it does not
    // silently re-enable it. Both steps are required before network-only checks.
    assert!(authorize_model(&registry, scene).is_err());
    registry.set_enabled(scene, notes, true).unwrap();
    registry
        .set_permission(scene, notes, "network.fetch", false)
        .unwrap();
    assert_eq!(
        authorize_model(&registry, scene).unwrap_err().to_string(),
        "visual_assets_model_network_permission_required"
    );
    registry
        .set_permission(scene, notes, "network.fetch", true)
        .unwrap();
    assert!(authorize_model(&registry, scene).is_ok());
    registry.set_enabled("fiction", notes, false).unwrap();
    assert!(authorize_model(&registry, "fiction").is_err());
    registry.set_enabled(scene, notes, false).unwrap();
    assert!(authorize_model(&registry, scene).is_err());
    registry.set_enabled(scene, notes, true).unwrap();
    assert!(authorize_model(&registry, scene).is_ok());
    registry
        .set_permission(scene, notes, "storage.plugin", false)
        .unwrap();
    assert!(authorize_model(&registry, scene).is_err());
    drop(registry);
    let root = root.canonicalize().unwrap();
    let expected = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch/visual-assets-model-jobs")
        .canonicalize()
        .unwrap();
    assert_eq!(root.parent(), Some(expected.as_path()));
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("permissions-"));
    std::fs::remove_dir_all(root).unwrap();
}

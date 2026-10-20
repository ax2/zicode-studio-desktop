//! Process-local execution identity; unrelated catalog mutations do not revoke work.
use super::*;

impl PluginRegistry {
    pub(crate) fn installed_execution_revisions(&self) -> BTreeMap<String, uuid::Uuid> {
        self.plugins
            .iter()
            .map(|(id, plugin)| (id.clone(), plugin.execution_revision))
            .collect()
    }

    pub(crate) fn execution_revision(&self, scene: &str, plugin: &str) -> (uuid::Uuid, uuid::Uuid) {
        (
            self.plugins
                .get(plugin)
                .map_or(uuid::Uuid::nil(), |p| p.execution_revision),
            self.state
                .scenes
                .get(scene)
                .and_then(|s| s.get(plugin))
                .map_or(uuid::Uuid::nil(), |p| p.execution_revision),
        )
    }

    // Rotate before any managed package swap, including a failed swap/rollback.
    // A byte-identical reinstall must not revive an old result or active call.
    pub(super) fn invalidate_plugin_execution(&mut self, plugin: &str) {
        if let Some(installed) = self.plugins.get_mut(plugin) {
            installed.execution_revision = uuid::Uuid::new_v4();
        }
    }

    pub(super) fn reload_preserving_execution_revisions(&mut self) -> Result<(), String> {
        let previous = self.plugins.clone();
        self.plugins
            .retain(|_, p| p.origin == PluginOrigin::BuiltIn);
        self.diagnostics.clear();
        let result = self
            .discover_signed_plugins()
            .and_then(|()| self.discover_developer_plugins());
        for (id, current) in &mut self.plugins {
            if let Some(old) = previous.get(id) {
                // Runtime bytes are independently hashed at launch and completion.
                // Failed validation removes the plugin and therefore its identity.
                if same_installation(current, old) {
                    current.execution_revision = old.execution_revision;
                }
            }
        }
        result
    }
}

fn same_installation(current: &InstalledPlugin, old: &InstalledPlugin) -> bool {
    current.origin == old.origin
        && current.content_digest == old.content_digest
        && current.publisher_identity == old.publisher_identity
        && current.package_root == old.package_root
        && current.core == old.core
        && current.enabled_by_default == old.enabled_by_default
        && serde_json::to_value(&current.manifest).ok() == serde_json::to_value(&old.manifest).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> PluginRegistry {
        let manifest: PluginManifest = serde_json::from_value(json!({
            "schemaVersion":1,"id":"com.zicode.catalog-fixture","name":"Revision fixture",
            "description":"In-memory identity test","version":"0.1.0","publisher":"zicode"
        }))
        .unwrap();
        PluginRegistry {
            root: PathBuf::from("unused-in-memory-revision-fixture"),
            plugins: BTreeMap::from([(
                manifest.id.clone(),
                InstalledPlugin {
                    execution_revision: uuid::Uuid::new_v4(),
                    content_digest: None,
                    publisher_identity: None,
                    retained_versions: Vec::new(),
                    manifest,
                    origin: PluginOrigin::Developer,
                    core: false,
                    enabled_by_default: false,
                    package_root: None,
                },
            )]),
            diagnostics: Vec::new(),
            state: RegistryState::default(),
            result_epoch: std::sync::atomic::AtomicU64::new(0),
        }
    }

    #[test]
    fn publisher_identity_and_manifest_or_location_changes_do_not_preserve_generation() {
        let registry = registry();
        let original = registry.plugins.values().next().unwrap();
        assert!(same_installation(original, &original.clone()));
        let mut changed = original.clone();
        changed.publisher_identity = Some(("new-key".into(), "new-public-key".into()));
        assert!(!same_installation(&changed, original));
        changed = original.clone();
        changed.manifest.version = "0.2.0".into();
        assert!(!same_installation(&changed, original));
        changed = original.clone();
        changed.package_root = Some(PathBuf::from("different-install"));
        assert!(!same_installation(&changed, original));
        changed = original.clone();
        changed.content_digest = Some([7; 32]);
        assert!(!same_installation(&changed, original));
    }

    #[test]
    fn managed_developer_content_change_rotates_only_its_execution_revision() {
        let root = std::env::temp_dir().join(format!(
            "zicode-plugin-content-revision-{}",
            uuid::Uuid::new_v4()
        ));
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        let package = root.join("developer").join("com.zicode.content-fixture");
        fs::create_dir_all(&package).unwrap();
        fs::write(
            package.join("plugin.json"),
            serde_json::to_vec(&json!({
                "schemaVersion": 1,
                "id": "com.zicode.content-fixture",
                "name": "Content fixture",
                "description": "Content identity fixture",
                "version": "0.1.0",
                "publisher": "zicode"
            }))
            .unwrap(),
        )
        .unwrap();
        fs::write(package.join("asset.txt"), b"before").unwrap();
        registry.reload_developer_plugins().unwrap();
        let before = registry.installed_execution_revisions();
        registry.reload_developer_plugins().unwrap();
        assert_eq!(registry.installed_execution_revisions(), before);

        fs::write(package.join("asset.txt"), b"after").unwrap();
        registry.reload_developer_plugins().unwrap();
        let after = registry.installed_execution_revisions();
        assert_ne!(
            after["com.zicode.content-fixture"],
            before["com.zicode.content-fixture"]
        );
        assert_eq!(after["core.chat"], before["core.chat"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn externally_replaced_valid_signed_proof_rotates_execution_revision() {
        use crate::plugin_package::write_test_signed_package;

        let root = std::env::temp_dir().join(format!(
            "zicode-signed-proof-revision-{}",
            uuid::Uuid::new_v4()
        ));
        let packages = root.join("packages");
        let first_manifest = json!({
            "schemaVersion": 1,
            "id": "com.zicode.signed-proof-fixture",
            "name": "Signed proof fixture",
            "description": "Signed execution identity fixture",
            "version": "0.1.0",
            "publisher": "zicode"
        });
        let first = write_test_signed_package(&packages, &first_manifest, "first.zicode-plugin");
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        registry.install_signed(&first, true).unwrap();
        let before = registry.installed_execution_revisions();
        registry.reload_developer_plugins().unwrap();
        assert_eq!(registry.installed_execution_revisions(), before);

        let mut second_manifest = first_manifest;
        second_manifest["testContentMarker"] = json!("different signed bytes");
        let second = write_test_signed_package(&packages, &second_manifest, "second.zicode-plugin");
        let verified = verify_package(&second, &root).unwrap();
        let managed = root.join("signed/com.zicode.signed-proof-fixture");
        fs::rename(&managed, root.join("previous-signed-package")).unwrap();
        extract_verified_package(&verified, &managed).unwrap();
        registry
            .write_signed_metadata(&SignedInstallMetadata {
                plugin_id: verified.manifest.id.clone(),
                version: verified.manifest.version.clone(),
                publisher_key_id: verified.publisher.key_id.clone(),
                publisher_public_key: verified.publisher.public_key.clone(),
                integrity: Some(verified.integrity),
            })
            .unwrap();
        registry.reload_developer_plugins().unwrap();
        let after = registry.installed_execution_revisions();
        assert_ne!(
            after["com.zicode.signed-proof-fixture"],
            before["com.zicode.signed-proof-fixture"]
        );
        assert_eq!(after["core.chat"], before["core.chat"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scene_revisions_are_local_and_do_not_change_registry_json_format() {
        let mut registry = registry();
        let id = "com.zicode.catalog-fixture";
        let original = registry.execution_revision("programming", id);
        registry.scene_plugin_state_mut("other-scene", id).enabled = Some(true);
        assert_eq!(registry.execution_revision("programming", id), original);
        registry.scene_plugin_state_mut("programming", id).enabled = Some(false);
        let revoked = registry.execution_revision("programming", id);
        registry.scene_plugin_state_mut("programming", id).enabled = Some(true);
        assert_ne!(registry.execution_revision("programming", id), revoked);
        let serialized = serde_json::to_value(&registry.state).unwrap();
        assert!(serialized["scenes"]["programming"][id]
            .get("executionRevision")
            .is_none());
        assert_eq!(serialized["version"], REGISTRY_STATE_VERSION);
    }
}

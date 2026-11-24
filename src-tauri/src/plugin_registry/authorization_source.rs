use super::*;

#[cfg(test)]
#[path = "authorization_source_tests.rs"]
mod tests;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", content = "identity", rename_all = "camelCase")]
pub(super) enum AuthorizationSource {
    Developer([u8; 32]),
    Signed(String, String),
}

impl InstalledPlugin {
    fn authorization_source(&self) -> Option<AuthorizationSource> {
        match self.origin {
            PluginOrigin::BuiltIn => None,
            PluginOrigin::Developer => self.content_digest.map(AuthorizationSource::Developer),
            PluginOrigin::Signed => self
                .publisher_identity
                .as_ref()
                .map(|(key_id, public_key)| {
                    AuthorizationSource::Signed(key_id.clone(), public_key.clone())
                }),
        }
    }

    fn matches_authorization_source(&self, source: Option<&AuthorizationSource>) -> bool {
        match (self.origin, source) {
            (PluginOrigin::BuiltIn, None) => true,
            (PluginOrigin::Developer, Some(AuthorizationSource::Developer(digest))) => {
                self.content_digest.as_ref() == Some(digest)
            }
            (PluginOrigin::Signed, Some(AuthorizationSource::Signed(key_id, public_key))) => self
                .publisher_identity
                .as_ref()
                .is_some_and(|identity| &identity.0 == key_id && &identity.1 == public_key),
            _ => false,
        }
    }

    fn is_canonical_management_location(&self, root: &Path) -> bool {
        let directory = match self.origin {
            PluginOrigin::BuiltIn => return false,
            PluginOrigin::Developer => "developer",
            PluginOrigin::Signed => "signed",
        };
        self.package_root.as_ref() == Some(&root.join(directory).join(&self.manifest.id))
    }
}

impl RegistryState {
    pub(super) fn bind_scene_plugin(
        &mut self,
        scene_id: &str,
        plugin: &InstalledPlugin,
    ) -> &mut PluginSceneState {
        let state = self
            .scenes
            .entry(scene_id.to_string())
            .or_default()
            .entry(plugin.manifest.id.clone())
            .or_default();
        if !plugin.matches_authorization_source(state.authorization_source.as_ref()) {
            *state = PluginSceneState {
                authorization_source: plugin.authorization_source(),
                ..Default::default()
            };
        }
        state.execution_revision = uuid::Uuid::new_v4();
        state
    }

    pub(super) fn clear_publisher_authorizations(&mut self, revoked_key: &str) {
        for state in self
            .scenes
            .values_mut()
            .flat_map(|scene| scene.values_mut())
        {
            if matches!(
                &state.authorization_source,
                Some(AuthorizationSource::Signed(key_id, _)) if key_id == revoked_key
            ) {
                state.enabled = Some(false);
                state.permissions.clear();
                state.execution_revision = uuid::Uuid::new_v4();
            }
        }
    }
}

impl PluginRegistry {
    pub(super) fn bound_scene_state(
        &self,
        scene_id: &str,
        plugin: &InstalledPlugin,
    ) -> Option<&PluginSceneState> {
        self.state
            .scenes
            .get(scene_id)?
            .get(&plugin.manifest.id)
            .filter(|state| {
                plugin.matches_authorization_source(state.authorization_source.as_ref())
            })
    }

    pub(super) fn migrate_installation_authorizations(&mut self) -> Result<(), String> {
        if self.state.authorization_migrated {
            return Ok(());
        }
        // Cold-start migration recognizes currently validated, managed packages.
        // This does not run during install or reload, which might introduce a new source.
        for scene in self.state.scenes.values_mut() {
            for (id, state) in scene {
                if let Some(plugin) = self.plugins.get(id) {
                    if state.authorization_source.is_none()
                        && plugin.is_canonical_management_location(&self.root)
                    {
                        state.authorization_source = plugin.authorization_source();
                    }
                }
            }
        }
        self.state.authorization_migrated = true;
        if !self.state.scenes.is_empty() {
            self.save_state(&self.state)?;
        }
        Ok(())
    }
}

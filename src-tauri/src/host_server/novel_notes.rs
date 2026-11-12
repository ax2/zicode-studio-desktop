use super::{ensure_notes_authorized, HostServer, NotesVault};

fn authorize_model(
    registry: &crate::plugin_registry::PluginRegistry,
    scene: &str,
) -> crate::visual_assets::Result<()> {
    let notes = registry
        .execution_plugin(scene, "com.zicode.notes")
        .filter(|plugin| {
            plugin.enabled
                && plugin
                    .permission_grants
                    .get("storage.plugin")
                    .copied()
                    .unwrap_or(false)
        })
        .ok_or("visual_assets_chapter_access_denied")?;
    if !notes
        .permission_grants
        .get("network.fetch")
        .copied()
        .unwrap_or(false)
    {
        return Err("visual_assets_model_network_permission_required".into());
    }
    Ok(())
}

impl HostServer {
    pub(crate) fn authorize_novel_model(&self, scene: &str) -> crate::visual_assets::Result<()> {
        let registry = self
            .state
            .plugins
            .lock()
            .map_err(|_| "visual_assets_model_job_unavailable")?;
        authorize_model(&registry, scene)
    }

    pub(crate) fn with_novel_notes<T>(
        &self,
        scene: &str,
        workspace: &str,
        run: impl FnOnce(&NotesVault) -> crate::visual_assets::Result<T>,
    ) -> crate::visual_assets::Result<T> {
        ensure_notes_authorized(&self.state, scene, false)
            .map_err(|_| "visual_assets_chapter_access_denied")?;
        let notes = self
            .state
            .notes
            .lock()
            .map_err(|_| "visual_assets_chapter_unavailable")?;
        let scoped = notes
            .scoped(workspace)
            .map_err(|_| "visual_assets_chapter_unavailable")?;
        run(&scoped)
    }
}

#[cfg(test)]
#[path = "novel_model_permission_tests.rs"]
mod tests;

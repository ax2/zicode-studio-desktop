use super::*;

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct PluginViewSnapshot {
    plugin_id: String,
    plugin_version: String,
    view_id: String,
    title: String,
    location: String,
    entry: String,
    package_root: PathBuf,
    execution_revision: uuid::Uuid,
    integrity: Option<signed_integrity::SignedIntegritySnapshot>,
}

impl PluginRegistry {
    pub(crate) fn view_snapshot(
        &self,
        scene_id: &str,
        plugin_id: &str,
        view_id: &str,
    ) -> Result<PluginViewSnapshot, String> {
        validate_scene_id(scene_id)?;
        let installed = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        if !self.plugin_enabled(scene_id, installed) {
            return Err(format!(
                "Plugin {plugin_id} is not enabled in scene {scene_id}"
            ));
        }
        if !matches!(
            installed.origin,
            PluginOrigin::Developer | PluginOrigin::Signed
        ) {
            return Err("Built-in views are loaded from application modules".into());
        }
        let view = installed
            .manifest
            .contributes
            .get("views")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .find(|view| view.get("id").and_then(Value::as_str) == Some(view_id))
            .ok_or_else(|| format!("Plugin {plugin_id} does not declare view {view_id}"))?;
        let entry = view
            .get("entry")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("View {view_id} does not declare an entry"))?;
        let package_root = installed
            .package_root
            .clone()
            .ok_or_else(|| "Developer plugin package path is unavailable".to_string())?;
        Ok(PluginViewSnapshot {
            plugin_id: plugin_id.to_owned(),
            plugin_version: installed.manifest.version.clone(),
            view_id: view_id.to_owned(),
            title: view
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(view_id)
                .to_owned(),
            location: view
                .get("location")
                .and_then(Value::as_str)
                .unwrap_or("main")
                .to_owned(),
            entry: entry.to_owned(),
            package_root,
            execution_revision: installed.execution_revision,
            integrity: self.signed_integrity_snapshot(plugin_id)?,
        })
    }
}

impl PluginViewSnapshot {
    pub(crate) fn read(self) -> Result<PluginViewDocument, String> {
        if let Some(integrity) = &self.integrity {
            integrity.verify()?;
        }
        validate_resource_path(&self.entry, Some(&self.package_root))?;
        let path = self.package_root.join(&self.entry);
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect view entry {}: {error}", self.view_id))?;
        if !metadata.is_file() || metadata.len() > MAX_VIEW_DOCUMENT_BYTES {
            return Err(format!(
                "View {} must be an HTML file no larger than 1 MiB",
                self.view_id
            ));
        }
        if path.extension().and_then(|value| value.to_str()) != Some("html") {
            return Err(format!(
                "View {} entry must use the .html extension",
                self.view_id
            ));
        }
        let bytes = fs::read(path)
            .map_err(|error| format!("Cannot read view entry {}: {error}", self.view_id))?;
        let html = String::from_utf8(bytes)
            .map_err(|_| format!("View {} entry must be UTF-8 encoded", self.view_id))?;
        if html.contains('\0') {
            return Err(format!(
                "View {} entry contains invalid null bytes",
                self.view_id
            ));
        }
        Ok(PluginViewDocument {
            plugin_id: self.plugin_id,
            plugin_version: self.plugin_version,
            view_id: self.view_id,
            title: self.title,
            location: self.location,
            html,
        })
    }
}

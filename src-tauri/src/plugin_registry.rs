use crate::plugin_package::{
    extract_verified_package, preview_package, publisher_is_trusted, revoke_publisher,
    trust_publisher, verify_package, SignedPluginPreview,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};

const REGISTRY_STATE_VERSION: u32 = 1;
const MANIFEST_SCHEMA_VERSION: u32 = 1;
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_SCHEMA_DEPTH: usize = 32;
const MAX_PACKAGE_FILES: usize = 2_048;
const MAX_PACKAGE_FILE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 50 * 1024 * 1024;
const MAX_VIEW_DOCUMENT_BYTES: u64 = 1024 * 1024;
const MAX_WORKER_DOCUMENT_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    pub description: String,
    pub version: String,
    pub publisher: String,
    #[serde(default)]
    pub engines: Value,
    #[serde(default)]
    pub activation_events: Vec<String>,
    #[serde(default)]
    pub runtime: Value,
    #[serde(default)]
    pub contributes: Value,
    #[serde(default)]
    pub permissions: ManifestPermissions,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPermissions {
    #[serde(default)]
    pub required: Vec<ManifestPermission>,
    #[serde(default)]
    pub optional: Vec<ManifestPermission>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestPermission {
    pub name: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDescriptor {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub origin: PluginOrigin,
    pub enabled: bool,
    pub core: bool,
    pub permission_grants: BTreeMap<String, bool>,
    pub publisher_key_id: Option<String>,
    pub retained_versions: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilityDescriptor {
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPiToolDescriptor {
    pub plugin_id: String,
    pub name: String,
    pub title: String,
    pub description: String,
    pub capability: String,
    pub input_schema: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginViewDocument {
    pub plugin_id: String,
    pub plugin_version: String,
    pub view_id: String,
    pub title: String,
    pub location: String,
    pub html: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PluginOrigin {
    BuiltIn,
    Developer,
    Signed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginDiagnostic {
    pub package: String,
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug)]
struct InstalledPlugin {
    manifest: PluginManifest,
    origin: PluginOrigin,
    core: bool,
    enabled_by_default: bool,
    package_root: Option<PathBuf>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PluginSceneState {
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(default)]
    permissions: BTreeMap<String, bool>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RegistryState {
    version: u32,
    #[serde(default)]
    scenes: HashMap<String, HashMap<String, PluginSceneState>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignedInstallMetadata {
    plugin_id: String,
    version: String,
    publisher_key_id: String,
    publisher_public_key: String,
}

impl Default for RegistryState {
    fn default() -> Self {
        Self {
            version: REGISTRY_STATE_VERSION,
            scenes: HashMap::new(),
        }
    }
}

pub struct PluginRegistry {
    root: PathBuf,
    plugins: BTreeMap<String, InstalledPlugin>,
    diagnostics: Vec<PluginDiagnostic>,
    state: RegistryState,
}

impl PluginRegistry {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("developer"))
            .map_err(|error| format!("Cannot create plugin registry directory: {error}"))?;
        let state = load_state(&root.join("registry.json"));
        let mut registry = Self {
            root,
            plugins: BTreeMap::new(),
            diagnostics: Vec::new(),
            state,
        };
        registry.register_builtins()?;
        registry.discover_signed_plugins()?;
        registry.discover_developer_plugins()?;
        Ok(registry)
    }

    pub fn list(&self, scene_id: &str) -> Vec<PluginDescriptor> {
        self.plugins
            .values()
            .map(|plugin| {
                let scene_state = self
                    .state
                    .scenes
                    .get(scene_id)
                    .and_then(|plugins| plugins.get(&plugin.manifest.id));
                let permission_grants = all_permissions(&plugin.manifest)
                    .into_iter()
                    .map(|permission| {
                        let granted = scene_state
                            .and_then(|state| state.permissions.get(&permission))
                            .copied()
                            .unwrap_or(plugin.origin == PluginOrigin::BuiltIn);
                        (permission, granted)
                    })
                    .collect();
                PluginDescriptor {
                    manifest: plugin.manifest.clone(),
                    origin: plugin.origin,
                    enabled: if plugin.core {
                        true
                    } else {
                        scene_state
                            .and_then(|state| state.enabled)
                            .unwrap_or(plugin.enabled_by_default)
                    },
                    core: plugin.core,
                    permission_grants,
                    publisher_key_id: (plugin.origin == PluginOrigin::Signed)
                        .then(|| self.read_signed_metadata(&plugin.manifest.id).ok())
                        .flatten()
                        .map(|metadata| metadata.publisher_key_id),
                    retained_versions: if plugin.origin == PluginOrigin::Signed {
                        self.signed_retained_versions(&plugin.manifest.id)
                    } else {
                        Vec::new()
                    },
                }
            })
            .collect()
    }

    pub fn diagnostics(&self) -> &[PluginDiagnostic] {
        &self.diagnostics
    }

    pub fn capabilities(&self, scene_id: &str) -> Vec<PluginCapabilityDescriptor> {
        self.list(scene_id)
            .into_iter()
            .filter(|plugin| plugin.enabled)
            .flat_map(|plugin| {
                let plugin_id = plugin.manifest.id.clone();
                plugin
                    .manifest
                    .contributes
                    .get("capabilities")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(move |value| {
                        Some(PluginCapabilityDescriptor {
                            plugin_id: plugin_id.clone(),
                            id: value.get("id")?.as_str()?.to_string(),
                            title: value
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or_else(|| {
                                    value.get("id").and_then(Value::as_str).unwrap_or("")
                                })
                                .to_string(),
                            input_schema: value.get("inputSchema").cloned().unwrap_or_else(
                                || json!({ "type": "object", "additionalProperties": false }),
                            ),
                        })
                    })
            })
            .collect()
    }

    pub fn pi_tools(&self, scene_id: &str) -> Vec<PluginPiToolDescriptor> {
        self.list(scene_id)
            .into_iter()
            .filter(|plugin| {
                plugin.enabled
                    && plugin
                        .permission_grants
                        .get("pi.tools.register")
                        .copied()
                        .unwrap_or(false)
            })
            .flat_map(|plugin| {
                let plugin_id = plugin.manifest.id.clone();
                plugin
                    .manifest
                    .contributes
                    .get("piTools")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter_map(move |value| {
                        Some(PluginPiToolDescriptor {
                            plugin_id: plugin_id.clone(),
                            name: value.get("name")?.as_str()?.to_string(),
                            title: value
                                .get("title")
                                .and_then(Value::as_str)
                                .unwrap_or_else(|| {
                                    value.get("name").and_then(Value::as_str).unwrap_or("")
                                })
                                .to_string(),
                            description: value
                                .get("description")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            capability: value.get("capability")?.as_str()?.to_string(),
                            input_schema: value.get("inputSchema").cloned().unwrap_or_else(
                                || json!({ "type": "object", "additionalProperties": false }),
                            ),
                        })
                    })
            })
            .collect()
    }

    pub fn capability(
        &self,
        scene_id: &str,
        plugin_id: &str,
        capability_id: &str,
    ) -> Option<PluginCapabilityDescriptor> {
        self.capabilities(scene_id)
            .into_iter()
            .find(|item| item.plugin_id == plugin_id && item.id == capability_id)
    }

    pub fn command_plugin(&self, scene_id: &str, command_id: &str) -> Result<String, String> {
        validate_scene_id(scene_id)?;
        let matches: Vec<String> = self
            .list(scene_id)
            .into_iter()
            .filter(|plugin| plugin.enabled)
            .filter(|plugin| {
                plugin
                    .manifest
                    .contributes
                    .get("commands")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .any(|command| command.get("id").and_then(Value::as_str) == Some(command_id))
            })
            .map(|plugin| plugin.manifest.id)
            .collect();
        match matches.as_slice() {
            [plugin_id] => Ok(plugin_id.clone()),
            [] => Err(format!("Command {command_id} is unavailable in this scene")),
            _ => Err(format!("Command {command_id} is ambiguous in this scene")),
        }
    }

    pub fn plugin_runtime_entry(
        &self,
        scene_id: &str,
        plugin_id: &str,
    ) -> Result<(PathBuf, &'static str), String> {
        validate_scene_id(scene_id)?;
        let descriptor = self
            .list(scene_id)
            .into_iter()
            .find(|plugin| plugin.manifest.id == plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        if !descriptor.enabled {
            return Err(format!(
                "Plugin {plugin_id} is not enabled in scene {scene_id}"
            ));
        }
        if !matches!(
            descriptor.origin,
            PluginOrigin::Developer | PluginOrigin::Signed
        ) {
            return Err("Built-in capabilities use Host handlers".into());
        }
        let installed = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        let (entry, kind) = if let Some(entry) = installed
            .manifest
            .runtime
            .get("wasi")
            .and_then(Value::as_str)
        {
            (entry, "wasi")
        } else if descriptor.origin == PluginOrigin::Developer {
            (
                installed
                    .manifest
                    .runtime
                    .get("worker")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        format!(
                            "Plugin {plugin_id} does not declare runtime.worker or runtime.wasi"
                        )
                    })?,
                "javascript",
            )
        } else {
            return Err("Signed plugin background code requires a runtime.wasi module".into());
        };
        let package_root = installed
            .package_root
            .as_ref()
            .ok_or_else(|| "Developer plugin package path is unavailable".to_string())?;
        validate_resource_path(entry, Some(package_root))?;
        let path = package_root.join(entry);
        let metadata =
            fs::metadata(&path).map_err(|error| format!("Cannot inspect worker entry: {error}"))?;
        if !metadata.is_file() || metadata.len() > MAX_WORKER_DOCUMENT_BYTES * 2 {
            return Err("Plugin runtime entry must be a file no larger than 2 MiB".into());
        }
        let expected_extension = if kind == "wasi" { "wasm" } else { "js" };
        if path.extension().and_then(|value| value.to_str()) != Some(expected_extension) {
            return Err(format!(
                "Plugin {kind} entry must use the .{expected_extension} extension"
            ));
        }
        Ok((path, kind))
    }

    pub fn view_document(
        &self,
        scene_id: &str,
        plugin_id: &str,
        view_id: &str,
    ) -> Result<PluginViewDocument, String> {
        validate_scene_id(scene_id)?;
        let descriptor = self
            .list(scene_id)
            .into_iter()
            .find(|plugin| plugin.manifest.id == plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        if !descriptor.enabled {
            return Err(format!(
                "Plugin {plugin_id} is not enabled in scene {scene_id}"
            ));
        }
        if !matches!(
            descriptor.origin,
            PluginOrigin::Developer | PluginOrigin::Signed
        ) {
            return Err("Built-in views are loaded from application modules".into());
        }
        let installed = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
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
            .as_ref()
            .ok_or_else(|| "Developer plugin package path is unavailable".to_string())?;
        validate_resource_path(entry, Some(package_root))?;
        let path = package_root.join(entry);
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect view entry {view_id}: {error}"))?;
        if !metadata.is_file() || metadata.len() > MAX_VIEW_DOCUMENT_BYTES {
            return Err(format!(
                "View {view_id} must be an HTML file no larger than 1 MiB"
            ));
        }
        if path.extension().and_then(|value| value.to_str()) != Some("html") {
            return Err(format!("View {view_id} entry must use the .html extension"));
        }
        let bytes =
            fs::read(path).map_err(|error| format!("Cannot read view entry {view_id}: {error}"))?;
        let html = String::from_utf8(bytes)
            .map_err(|_| format!("View {view_id} entry must be UTF-8 encoded"))?;
        if html.contains('\0') {
            return Err(format!("View {view_id} entry contains invalid null bytes"));
        }
        Ok(PluginViewDocument {
            plugin_id: plugin_id.to_string(),
            plugin_version: installed.manifest.version.clone(),
            view_id: view_id.to_string(),
            title: view
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(view_id)
                .to_string(),
            location: view
                .get("location")
                .and_then(Value::as_str)
                .unwrap_or("main")
                .to_string(),
            html,
        })
    }

    pub fn set_enabled(
        &mut self,
        scene_id: &str,
        plugin_id: &str,
        enabled: bool,
    ) -> Result<(), String> {
        validate_scene_id(scene_id)?;
        let plugin = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        if plugin.core && !enabled {
            return Err(format!(
                "{} is a required core plugin",
                plugin.manifest.name
            ));
        }
        if enabled {
            let current_permissions = self
                .state
                .scenes
                .get(scene_id)
                .and_then(|plugins| plugins.get(plugin_id));
            for permission in &plugin.manifest.permissions.required {
                let granted = current_permissions
                    .and_then(|state| state.permissions.get(&permission.name))
                    .copied()
                    .unwrap_or(plugin.origin == PluginOrigin::BuiltIn);
                if !granted {
                    return Err(format!(
                        "Required permission {} is not granted",
                        permission.name
                    ));
                }
            }
            self.ensure_pi_tool_names_available(scene_id, plugin_id, None)?;
        }
        self.scene_plugin_state_mut(scene_id, plugin_id).enabled = Some(enabled);
        self.save()
    }

    pub fn set_permission(
        &mut self,
        scene_id: &str,
        plugin_id: &str,
        permission: &str,
        granted: bool,
    ) -> Result<(), String> {
        validate_scene_id(scene_id)?;
        let plugin = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        if !all_permissions(&plugin.manifest).contains(permission) {
            return Err(format!(
                "Plugin {plugin_id} does not declare permission {permission}"
            ));
        }
        if permission == "pi.tools.register" && granted {
            self.ensure_pi_tool_names_available(scene_id, plugin_id, Some(true))?;
        }
        let required = plugin
            .manifest
            .permissions
            .required
            .iter()
            .any(|candidate| candidate.name == permission);
        let state = self.scene_plugin_state_mut(scene_id, plugin_id);
        state.permissions.insert(permission.to_string(), granted);
        if required && !granted {
            state.enabled = Some(false);
        }
        self.save()
    }

    pub fn install_developer(&mut self, source: &Path) -> Result<String, String> {
        let source = source
            .canonicalize()
            .map_err(|error| format!("Cannot resolve selected plugin directory: {error}"))?;
        if !source.is_dir() {
            return Err("Selected plugin package is not a directory".into());
        }
        if source.starts_with(
            self.root
                .canonicalize()
                .unwrap_or_else(|_| self.root.clone()),
        ) {
            return Err(
                "The selected plugin is already inside the managed plugin directory".into(),
            );
        }
        let manifest = load_manifest(&source)?;
        if self
            .plugins
            .get(&manifest.id)
            .is_some_and(|plugin| plugin.origin == PluginOrigin::BuiltIn)
        {
            return Err(format!(
                "Developer package cannot replace built-in plugin {}",
                manifest.id
            ));
        }

        let developer_root = self.root.join("developer");
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let staging = self.root.join(format!(".staging-{nonce}"));
        let backup = self.root.join(format!(".backup-{nonce}"));
        let destination = developer_root.join(&manifest.id);
        if let Err(error) = copy_package_tree(&source, &staging) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        let copied_manifest = load_manifest(&staging)?;
        if copied_manifest.id != manifest.id || copied_manifest.version != manifest.version {
            let _ = fs::remove_dir_all(&staging);
            return Err("Plugin package changed while it was being copied".into());
        }

        let had_previous = destination.is_dir();
        if had_previous {
            fs::rename(&destination, &backup).map_err(|error| {
                let _ = fs::remove_dir_all(&staging);
                format!("Cannot prepare plugin upgrade: {error}")
            })?;
        }
        if let Err(error) = fs::rename(&staging, &destination) {
            if had_previous {
                let _ = fs::rename(&backup, &destination);
            }
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Cannot finish plugin installation: {error}"));
        }

        if let Err(error) = self.reload_developer_plugins() {
            let _ = fs::remove_dir_all(&destination);
            if had_previous {
                let _ = fs::rename(&backup, &destination);
                let _ = self.reload_developer_plugins();
            }
            return Err(error);
        }
        if !self.plugins.contains_key(&manifest.id) {
            let diagnostic = self
                .diagnostics
                .iter()
                .find(|diagnostic| diagnostic.package == manifest.id)
                .map(|diagnostic| diagnostic.message.clone())
                .unwrap_or_else(|| "Installed plugin was not discovered".into());
            let _ = fs::remove_dir_all(&destination);
            if had_previous {
                let _ = fs::rename(&backup, &destination);
                let _ = self.reload_developer_plugins();
            }
            return Err(diagnostic);
        }
        if had_previous {
            if let Err(error) = fs::remove_dir_all(&backup) {
                log::warn!(
                    "[zicode-plugins] installed {} but could not remove backup {}: {error}",
                    manifest.id,
                    backup.display()
                );
            }
        }
        Ok(manifest.id)
    }

    pub fn preview_signed(&self, package: &Path) -> Result<SignedPluginPreview, String> {
        preview_package(package, &self.root)
    }

    pub fn install_signed(&mut self, package: &Path, trust: bool) -> Result<String, String> {
        let verified = verify_package(package, &self.root)?;
        if !verified.trusted {
            if !trust {
                return Err("Publisher trust confirmation is required".into());
            }
            trust_publisher(&self.root, &verified.publisher)?;
        }
        let manifest = verified.manifest.clone();
        if self
            .plugins
            .get(&manifest.id)
            .is_some_and(|plugin| plugin.origin != PluginOrigin::Signed)
        {
            return Err(format!(
                "Signed package cannot replace existing plugin {}",
                manifest.id
            ));
        }
        let signed_root = self.root.join("signed");
        fs::create_dir_all(&signed_root)
            .map_err(|error| format!("Cannot create signed plugin directory: {error}"))?;
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let staging = self.root.join(format!(".signed-staging-{nonce}"));
        let backup = self.root.join(format!(".signed-backup-{nonce}"));
        let destination = signed_root.join(&manifest.id);
        extract_verified_package(&verified, &staging)?;
        let extracted = load_manifest(&staging)?;
        if extracted.id != manifest.id || extracted.version != manifest.version {
            let _ = fs::remove_dir_all(&staging);
            return Err("Signed plugin changed while it was being extracted".into());
        }
        let previous = if destination.is_dir() {
            Some(load_manifest(&destination)?)
        } else {
            None
        };
        let previous_metadata = self.read_signed_metadata(&manifest.id).ok();
        if previous
            .as_ref()
            .is_some_and(|old| old.version == manifest.version)
        {
            let _ = fs::remove_dir_all(&staging);
            return Err("Signed plugin version is already installed and cannot be replaced".into());
        }
        if let Some(previous) = &previous {
            let old = semver::Version::parse(&previous.version)
                .map_err(|error| format!("Installed plugin version is invalid: {error}"))?;
            let new = semver::Version::parse(&manifest.version)
                .map_err(|error| format!("Signed plugin version is invalid: {error}"))?;
            if new < old {
                let _ = fs::remove_dir_all(&staging);
                return Err("Signed plugin downgrade requires the explicit rollback action".into());
            }
        }
        if destination.is_dir() {
            fs::rename(&destination, &backup).map_err(|error| {
                let _ = fs::remove_dir_all(&staging);
                format!("Cannot prepare signed plugin update: {error}")
            })?;
        }
        if let Err(error) = fs::rename(&staging, &destination) {
            if backup.is_dir() {
                let _ = fs::rename(&backup, &destination);
            }
            let _ = fs::remove_dir_all(&staging);
            return Err(format!("Cannot activate signed plugin: {error}"));
        }
        let new_metadata = SignedInstallMetadata {
            plugin_id: manifest.id.clone(),
            version: manifest.version.clone(),
            publisher_key_id: verified.publisher.key_id.clone(),
            publisher_public_key: verified.publisher.public_key.clone(),
        };
        if let Err(error) = self.write_signed_metadata(&new_metadata) {
            let _ = fs::remove_dir_all(&destination);
            if backup.is_dir() {
                let _ = fs::rename(&backup, &destination);
            }
            return Err(error);
        }
        if let Err(error) = self.reload_developer_plugins() {
            let _ = fs::remove_dir_all(&destination);
            if backup.is_dir() {
                let _ = fs::rename(&backup, &destination);
            }
            self.restore_signed_metadata(&manifest.id, previous_metadata.as_ref());
            let _ = self.reload_developer_plugins();
            return Err(error);
        }
        if !self
            .plugins
            .get(&manifest.id)
            .is_some_and(|plugin| plugin.origin == PluginOrigin::Signed)
        {
            let _ = fs::remove_dir_all(&destination);
            if backup.is_dir() {
                let _ = fs::rename(&backup, &destination);
            }
            self.restore_signed_metadata(&manifest.id, previous_metadata.as_ref());
            let _ = self.reload_developer_plugins();
            return Err("Signed plugin was not registered after activation".into());
        }
        if let Some(previous) = previous {
            let versions = self.root.join("signed-versions").join(&manifest.id);
            fs::create_dir_all(&versions).map_err(|error| {
                format!("Cannot retain signed plugin rollback version: {error}")
            })?;
            let retained = versions.join(&previous.version);
            if retained.exists() {
                fs::remove_dir_all(&backup).map_err(|error| {
                    format!("Cannot clean duplicate signed plugin rollback version: {error}")
                })?;
            } else {
                fs::rename(&backup, retained).map_err(|error| {
                    format!("Cannot retain signed plugin rollback version: {error}")
                })?;
            }
            if let Some(previous_metadata) = previous_metadata.as_ref() {
                self.write_signed_version_metadata(previous_metadata)?;
            }
        }
        Ok(manifest.id)
    }

    pub fn rollback_signed(&mut self, plugin_id: &str, version: &str) -> Result<(), String> {
        if !valid_plugin_id(plugin_id) || !valid_semver(version) {
            return Err("Invalid signed plugin rollback target".into());
        }
        let active = self.root.join("signed").join(plugin_id);
        let target = self
            .root
            .join("signed-versions")
            .join(plugin_id)
            .join(version);
        if !active.is_dir() || !target.is_dir() {
            return Err("Signed plugin rollback version is unavailable".into());
        }
        let current = load_manifest(&active)?;
        let rollback = load_manifest(&target)?;
        if rollback.id != plugin_id || rollback.version != version {
            return Err("Signed plugin rollback package identity does not match".into());
        }
        let previous_metadata = self.read_signed_metadata(plugin_id)?;
        let rollback_metadata = self.read_signed_version_metadata(plugin_id, version)?;
        if rollback_metadata.version != version
            || !publisher_is_trusted(
                &self.root,
                &rollback_metadata.publisher_key_id,
                &rollback_metadata.publisher_public_key,
            )
        {
            return Err("Signed plugin rollback publisher is unavailable or revoked".into());
        }
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let swapping = self.root.join(format!(".signed-rollback-{nonce}"));
        fs::rename(&active, &swapping)
            .map_err(|error| format!("Cannot prepare signed plugin rollback: {error}"))?;
        if let Err(error) = fs::rename(&target, &active) {
            let _ = fs::rename(&swapping, &active);
            return Err(format!("Cannot activate signed plugin rollback: {error}"));
        }
        let current_target = self
            .root
            .join("signed-versions")
            .join(plugin_id)
            .join(&current.version);
        if let Err(error) = fs::rename(&swapping, &current_target) {
            let _ = fs::rename(&active, &target);
            let _ = fs::rename(&swapping, &active);
            return Err(format!(
                "Cannot retain current signed plugin version: {error}"
            ));
        }
        if let Err(error) = self.write_signed_metadata(&rollback_metadata) {
            let _ = fs::rename(&active, &target);
            let _ = fs::rename(&current_target, &active);
            return Err(error);
        }
        if let Err(error) = self.write_signed_version_metadata(&previous_metadata) {
            let _ = fs::rename(&active, &target);
            let _ = fs::rename(&current_target, &active);
            let _ = self.write_signed_metadata(&previous_metadata);
            return Err(error);
        }
        if let Err(error) = self.reload_developer_plugins() {
            let _ = fs::rename(&active, &target);
            let _ = fs::rename(&current_target, &active);
            let _ = self.write_signed_metadata(&previous_metadata);
            let _ = self.reload_developer_plugins();
            return Err(error);
        }
        Ok(())
    }

    pub fn revoke_signed_publisher(&mut self, key_id: &str) -> Result<(), String> {
        revoke_publisher(&self.root, key_id)?;
        let affected: Vec<String> = self
            .plugins
            .values()
            .filter(|plugin| plugin.origin == PluginOrigin::Signed)
            .filter_map(|plugin| {
                let metadata = self.read_signed_metadata(&plugin.manifest.id).ok()?;
                (metadata.publisher_key_id == key_id).then(|| plugin.manifest.id.clone())
            })
            .collect();
        for scene in self.state.scenes.values_mut() {
            for plugin_id in &affected {
                scene.entry(plugin_id.clone()).or_default().enabled = Some(false);
            }
        }
        self.save()?;
        self.reload_developer_plugins()
    }

    pub fn uninstall_developer(&mut self, plugin_id: &str) -> Result<(), String> {
        let plugin = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        if !matches!(
            plugin.origin,
            PluginOrigin::Developer | PluginOrigin::Signed
        ) {
            return Err("Built-in plugins cannot be uninstalled".into());
        }
        let package_root = plugin
            .package_root
            .as_ref()
            .ok_or_else(|| "Developer plugin package path is unavailable".to_string())?
            .clone();
        let managed_root = match plugin.origin {
            PluginOrigin::Developer => self.root.join("developer"),
            PluginOrigin::Signed => self.root.join("signed"),
            PluginOrigin::BuiltIn => unreachable!(),
        };
        let package_parent = package_root
            .parent()
            .ok_or_else(|| "Developer plugin package path is invalid".to_string())?;
        if package_parent != managed_root || package_root.file_name().is_none() {
            return Err("Refusing to remove a plugin outside the managed directory".into());
        }
        fs::remove_dir_all(&package_root)
            .map_err(|error| format!("Cannot uninstall plugin {plugin_id}: {error}"))?;
        if plugin.origin == PluginOrigin::Signed {
            let metadata = self.signed_metadata_path(plugin_id);
            if metadata.is_file() {
                fs::remove_file(metadata)
                    .map_err(|error| format!("Cannot remove signed plugin metadata: {error}"))?;
            }
        }
        self.reload_developer_plugins()
    }

    pub fn reload_developer_plugins(&mut self) -> Result<(), String> {
        self.plugins
            .retain(|_, plugin| plugin.origin == PluginOrigin::BuiltIn);
        self.diagnostics.clear();
        self.discover_signed_plugins()?;
        self.discover_developer_plugins()
    }

    fn register_builtins(&mut self) -> Result<(), String> {
        for (value, core, enabled_by_default) in builtin_manifests() {
            let manifest: PluginManifest = serde_json::from_value(value)
                .map_err(|error| format!("Built-in plugin manifest is invalid: {error}"))?;
            validate_manifest(&manifest, None)?;
            self.plugins.insert(
                manifest.id.clone(),
                InstalledPlugin {
                    manifest,
                    origin: PluginOrigin::BuiltIn,
                    core,
                    enabled_by_default,
                    package_root: None,
                },
            );
        }
        Ok(())
    }

    fn discover_developer_plugins(&mut self) -> Result<(), String> {
        let developer_root = self.root.join("developer");
        let entries = fs::read_dir(&developer_root)
            .map_err(|error| format!("Cannot read {}: {error}", developer_root.display()))?;
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    self.diagnostics.push(PluginDiagnostic {
                        package: "developer".into(),
                        code: "directory_entry_failed".into(),
                        message: error.to_string(),
                    });
                    continue;
                }
            };
            let package_root = entry.path();
            if !package_root.is_dir() || entry.file_type().is_ok_and(|kind| kind.is_symlink()) {
                continue;
            }
            let package_name = entry.file_name().to_string_lossy().into_owned();
            match load_manifest(&package_root) {
                Ok(manifest) => {
                    if self.plugins.contains_key(&manifest.id) {
                        self.diagnostics.push(PluginDiagnostic {
                            package: package_name,
                            code: "duplicate_plugin_id".into(),
                            message: format!("Plugin ID {} is already registered", manifest.id),
                        });
                        continue;
                    }
                    self.plugins.insert(
                        manifest.id.clone(),
                        InstalledPlugin {
                            manifest,
                            origin: PluginOrigin::Developer,
                            core: false,
                            enabled_by_default: false,
                            package_root: Some(package_root),
                        },
                    );
                }
                Err(error) => self.diagnostics.push(PluginDiagnostic {
                    package: package_name,
                    code: "manifest_invalid".into(),
                    message: error,
                }),
            }
        }
        Ok(())
    }

    fn discover_signed_plugins(&mut self) -> Result<(), String> {
        let signed_root = self.root.join("signed");
        fs::create_dir_all(&signed_root)
            .map_err(|error| format!("Cannot create signed plugin directory: {error}"))?;
        let entries = fs::read_dir(&signed_root)
            .map_err(|error| format!("Cannot read {}: {error}", signed_root.display()))?;
        for entry in entries.flatten() {
            let package_root = entry.path();
            if !package_root.is_dir() || entry.file_type().is_ok_and(|kind| kind.is_symlink()) {
                continue;
            }
            let package_name = entry.file_name().to_string_lossy().into_owned();
            match load_manifest(&package_root) {
                Ok(manifest)
                    if !self.plugins.contains_key(&manifest.id)
                        && self
                            .read_signed_metadata(&manifest.id)
                            .is_ok_and(|metadata| {
                                metadata.plugin_id == manifest.id
                                    && metadata.version == manifest.version
                                    && publisher_is_trusted(
                                        &self.root,
                                        &metadata.publisher_key_id,
                                        &metadata.publisher_public_key,
                                    )
                            }) =>
                {
                    self.plugins.insert(
                        manifest.id.clone(),
                        InstalledPlugin {
                            manifest,
                            origin: PluginOrigin::Signed,
                            core: false,
                            enabled_by_default: false,
                            package_root: Some(package_root),
                        },
                    );
                }
                Ok(manifest) => {
                    let (code, message) = if self.plugins.contains_key(&manifest.id) {
                        (
                            "duplicate_plugin_id",
                            format!("Plugin ID {} is already registered", manifest.id),
                        )
                    } else {
                        (
                            "signed_trust_invalid",
                            format!(
                                "Signed plugin {} has missing, mismatched, or revoked publisher metadata",
                                manifest.id
                            ),
                        )
                    };
                    self.diagnostics.push(PluginDiagnostic {
                        package: package_name,
                        code: code.into(),
                        message,
                    });
                }
                Err(message) => self.diagnostics.push(PluginDiagnostic {
                    package: package_name,
                    code: "invalid_signed_package".into(),
                    message,
                }),
            }
        }
        Ok(())
    }

    fn signed_metadata_path(&self, plugin_id: &str) -> PathBuf {
        self.root
            .join("signed-metadata")
            .join(format!("{plugin_id}.json"))
    }

    fn signed_retained_versions(&self, plugin_id: &str) -> Vec<String> {
        let root = self.root.join("signed-versions").join(plugin_id);
        let Ok(entries) = fs::read_dir(root) else {
            return Vec::new();
        };
        let mut versions: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.path().is_dir())
            .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
            .filter(|version| valid_semver(version))
            .filter(|version| {
                self.read_signed_version_metadata(plugin_id, version)
                    .is_ok_and(|metadata| {
                        metadata.version == *version
                            && publisher_is_trusted(
                                &self.root,
                                &metadata.publisher_key_id,
                                &metadata.publisher_public_key,
                            )
                    })
            })
            .collect();
        versions.sort();
        versions.reverse();
        versions
    }

    fn read_signed_metadata(&self, plugin_id: &str) -> Result<SignedInstallMetadata, String> {
        let bytes = fs::read(self.signed_metadata_path(plugin_id))
            .map_err(|error| format!("Cannot read signed plugin metadata: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("Signed plugin metadata is invalid: {error}"))
    }

    fn signed_version_metadata_path(&self, plugin_id: &str, version: &str) -> PathBuf {
        self.root
            .join("signed-version-metadata")
            .join(plugin_id)
            .join(format!("{version}.json"))
    }

    fn read_signed_version_metadata(
        &self,
        plugin_id: &str,
        version: &str,
    ) -> Result<SignedInstallMetadata, String> {
        let bytes = fs::read(self.signed_version_metadata_path(plugin_id, version))
            .map_err(|error| format!("Cannot read signed rollback metadata: {error}"))?;
        serde_json::from_slice(&bytes)
            .map_err(|error| format!("Signed rollback metadata is invalid: {error}"))
    }

    fn write_signed_version_metadata(
        &self,
        metadata: &SignedInstallMetadata,
    ) -> Result<(), String> {
        let path = self.signed_version_metadata_path(&metadata.plugin_id, &metadata.version);
        let parent = path
            .parent()
            .ok_or_else(|| "Signed rollback metadata path is invalid".to_string())?;
        fs::create_dir_all(parent).map_err(|error| {
            format!("Cannot create signed rollback metadata directory: {error}")
        })?;
        let bytes = serde_json::to_vec_pretty(metadata)
            .map_err(|error| format!("Cannot serialize signed rollback metadata: {error}"))?;
        let temporary = parent.join(format!(".rollback-{}.tmp", uuid::Uuid::new_v4().simple()));
        fs::write(&temporary, bytes)
            .map_err(|error| format!("Cannot write signed rollback metadata: {error}"))?;
        fs::rename(&temporary, path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Cannot commit signed rollback metadata: {error}")
        })
    }

    fn write_signed_metadata(&self, metadata: &SignedInstallMetadata) -> Result<(), String> {
        let path = self.signed_metadata_path(&metadata.plugin_id);
        let parent = path
            .parent()
            .ok_or_else(|| "Signed plugin metadata path is invalid".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create signed plugin metadata directory: {error}"))?;
        let temporary = parent.join(format!(
            ".{}-{}.tmp",
            metadata.plugin_id,
            uuid::Uuid::new_v4().simple()
        ));
        let bytes = serde_json::to_vec_pretty(metadata)
            .map_err(|error| format!("Cannot serialize signed plugin metadata: {error}"))?;
        fs::write(&temporary, bytes)
            .map_err(|error| format!("Cannot write signed plugin metadata: {error}"))?;
        fs::rename(&temporary, &path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            format!("Cannot commit signed plugin metadata: {error}")
        })
    }

    fn restore_signed_metadata(&self, plugin_id: &str, metadata: Option<&SignedInstallMetadata>) {
        if let Some(metadata) = metadata {
            let _ = self.write_signed_metadata(metadata);
        } else {
            let path = self.signed_metadata_path(plugin_id);
            if path.is_file() {
                let _ = fs::remove_file(path);
            }
        }
    }

    fn scene_plugin_state_mut(&mut self, scene_id: &str, plugin_id: &str) -> &mut PluginSceneState {
        self.state
            .scenes
            .entry(scene_id.to_string())
            .or_default()
            .entry(plugin_id.to_string())
            .or_default()
    }

    fn ensure_pi_tool_names_available(
        &self,
        scene_id: &str,
        plugin_id: &str,
        permission_override: Option<bool>,
    ) -> Result<(), String> {
        let candidate = self
            .plugins
            .get(plugin_id)
            .ok_or_else(|| format!("Unknown application plugin: {plugin_id}"))?;
        let state = self
            .state
            .scenes
            .get(scene_id)
            .and_then(|plugins| plugins.get(plugin_id));
        let granted = permission_override.unwrap_or_else(|| {
            state
                .and_then(|value| value.permissions.get("pi.tools.register"))
                .copied()
                .unwrap_or(candidate.origin == PluginOrigin::BuiltIn)
        });
        if !granted {
            return Ok(());
        }
        let candidate_names = pi_tool_names(&candidate.manifest);
        if candidate_names.is_empty() {
            return Ok(());
        }
        for descriptor in self.list(scene_id) {
            if descriptor.manifest.id == plugin_id
                || !descriptor.enabled
                || !descriptor
                    .permission_grants
                    .get("pi.tools.register")
                    .copied()
                    .unwrap_or(false)
            {
                continue;
            }
            if let Some(name) = pi_tool_names(&descriptor.manifest)
                .intersection(&candidate_names)
                .next()
            {
                return Err(format!(
                    "Pi tool name {name} is already registered by {}",
                    descriptor.manifest.id
                ));
            }
        }
        Ok(())
    }

    fn save(&self) -> Result<(), String> {
        let destination = self.root.join("registry.json");
        let temporary = self
            .root
            .join(format!("registry.json.tmp-{}", std::process::id()));
        let bytes = serde_json::to_vec_pretty(&self.state)
            .map_err(|error| format!("Cannot serialize plugin registry: {error}"))?;
        fs::write(&temporary, bytes)
            .map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
        if destination.exists() {
            fs::remove_file(&destination)
                .map_err(|error| format!("Cannot replace {}: {error}", destination.display()))?;
        }
        fs::rename(&temporary, &destination)
            .map_err(|error| format!("Cannot finish {}: {error}", destination.display()))
    }
}

fn copy_package_tree(source: &Path, destination: &Path) -> Result<(), String> {
    let source_metadata = fs::symlink_metadata(source)
        .map_err(|error| format!("Cannot inspect plugin package: {error}"))?;
    if !source_metadata.is_dir() || source_metadata.file_type().is_symlink() {
        return Err("Plugin package root must be a regular directory".into());
    }
    fs::create_dir(destination)
        .map_err(|error| format!("Cannot create plugin staging directory: {error}"))?;
    let mut pending = vec![(source.to_path_buf(), destination.to_path_buf())];
    let mut file_count = 0usize;
    let mut total_bytes = 0u64;
    while let Some((current_source, current_destination)) = pending.pop() {
        for entry in fs::read_dir(&current_source)
            .map_err(|error| format!("Cannot read plugin package: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("Cannot read plugin package entry: {error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("Cannot inspect plugin package entry: {error}"))?;
            if file_type.is_symlink() {
                let _ = fs::remove_dir_all(destination);
                return Err(format!(
                    "Plugin packages cannot contain symbolic links: {}",
                    entry.path().display()
                ));
            }
            let target = current_destination.join(entry.file_name());
            if file_type.is_dir() {
                fs::create_dir(&target)
                    .map_err(|error| format!("Cannot create plugin package directory: {error}"))?;
                pending.push((entry.path(), target));
                continue;
            }
            if !file_type.is_file() {
                let _ = fs::remove_dir_all(destination);
                return Err("Plugin packages can contain only files and directories".into());
            }
            let metadata = entry
                .metadata()
                .map_err(|error| format!("Cannot inspect plugin package file: {error}"))?;
            file_count += 1;
            total_bytes = total_bytes.saturating_add(metadata.len());
            if file_count > MAX_PACKAGE_FILES
                || metadata.len() > MAX_PACKAGE_FILE_BYTES
                || total_bytes > MAX_PACKAGE_BYTES
            {
                let _ = fs::remove_dir_all(destination);
                return Err("Plugin package exceeds the allowed file or size limits".into());
            }
            fs::copy(entry.path(), &target)
                .map_err(|error| format!("Cannot copy plugin package file: {error}"))?;
        }
    }
    Ok(())
}

fn load_state(path: &Path) -> RegistryState {
    let Ok(bytes) = fs::read(path) else {
        return RegistryState::default();
    };
    let Ok(state) = serde_json::from_slice::<RegistryState>(&bytes) else {
        return RegistryState::default();
    };
    if state.version != REGISTRY_STATE_VERSION {
        RegistryState::default()
    } else {
        state
    }
}

fn load_manifest(package_root: &Path) -> Result<PluginManifest, String> {
    let path = package_root.join("plugin.json");
    let metadata =
        fs::metadata(&path).map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    if !metadata.is_file() || metadata.len() > MAX_MANIFEST_BYTES {
        return Err("plugin.json must be a regular file no larger than 256 KiB".into());
    }
    let bytes = fs::read(&path).map_err(|error| format!("Cannot read plugin.json: {error}"))?;
    let raw: Value = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Malformed plugin.json: {error}"))?;
    validate_json_depth(&raw, 0)?;
    let manifest: PluginManifest =
        serde_json::from_value(raw).map_err(|error| format!("Invalid plugin.json: {error}"))?;
    validate_manifest(&manifest, Some(package_root))?;
    Ok(manifest)
}

fn validate_manifest(manifest: &PluginManifest, package_root: Option<&Path>) -> Result<(), String> {
    if manifest.schema_version != MANIFEST_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported plugin schemaVersion {}",
            manifest.schema_version
        ));
    }
    if !valid_plugin_id(&manifest.id) {
        return Err(format!("Invalid plugin ID {}", manifest.id));
    }
    if manifest.name.trim().is_empty()
        || manifest.description.trim().is_empty()
        || manifest.publisher.trim().is_empty()
    {
        return Err("name, description, and publisher are required".into());
    }
    if !valid_semver(&manifest.version) {
        return Err(format!("Invalid plugin version {}", manifest.version));
    }
    let mut contribution_ids = HashSet::new();
    for (group, id_field) in [
        ("activities", "id"),
        ("views", "id"),
        ("commands", "id"),
        ("capabilities", "id"),
        ("piTools", "name"),
    ] {
        for contribution in manifest
            .contributes
            .get(group)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let id = contribution
                .get(id_field)
                .and_then(Value::as_str)
                .ok_or_else(|| format!("{group} contribution is missing {id_field}"))?;
            let unique = format!("{group}:{id}");
            if !contribution_ids.insert(unique) {
                return Err(format!("Duplicate {group} contribution {id}"));
            }
            if group == "views" {
                let location = contribution
                    .get("location")
                    .and_then(Value::as_str)
                    .ok_or_else(|| format!("View {id} is missing location"))?;
                if !matches!(location, "sidebar" | "main") {
                    return Err(format!("View {id} location must be sidebar or main"));
                }
                if package_root.is_some()
                    && contribution.get("entry").and_then(Value::as_str).is_none()
                {
                    return Err(format!("Developer view {id} is missing entry"));
                }
            }
            for field in ["entry", "icon"] {
                if let Some(path) = contribution.get(field).and_then(Value::as_str) {
                    validate_resource_path(path, package_root)?;
                }
            }
        }
    }
    let capability_ids = manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| value.get("id").and_then(Value::as_str))
        .collect::<HashSet<_>>();
    for capability in manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let schema = capability
            .get("inputSchema")
            .ok_or_else(|| "capabilities contribution is missing inputSchema".to_string())?;
        validate_input_schema(schema)?;
    }
    for tool in manifest
        .contributes
        .get("piTools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = tool.get("name").and_then(Value::as_str).unwrap_or("");
        if !valid_pi_tool_name(name) {
            return Err(format!("Invalid Pi tool name {name}"));
        }
        let capability = tool
            .get("capability")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Pi tool {name} is missing capability"))?;
        if !capability_ids.contains(capability) {
            return Err(format!(
                "Pi tool {name} references undeclared capability {capability}"
            ));
        }
        validate_input_schema(
            tool.get("inputSchema")
                .ok_or_else(|| format!("Pi tool {name} is missing inputSchema"))?,
        )?;
    }
    if let Some(worker) = manifest.runtime.get("worker") {
        let worker = worker
            .as_str()
            .ok_or_else(|| "runtime.worker must be a string path".to_string())?;
        validate_resource_path(worker, package_root)?;
    }
    if let Some(wasi) = manifest.runtime.get("wasi") {
        let wasi = wasi
            .as_str()
            .ok_or_else(|| "runtime.wasi must be a string path".to_string())?;
        validate_resource_path(wasi, package_root)?;
        if Path::new(wasi).extension().and_then(|value| value.to_str()) != Some("wasm") {
            return Err("runtime.wasi must reference a .wasm module".into());
        }
    }
    Ok(())
}

fn validate_input_schema(schema: &Value) -> Result<(), String> {
    validate_json_depth(schema, 0)?;
    let object = schema
        .as_object()
        .ok_or_else(|| "Plugin inputSchema must be a JSON object".to_string())?;
    if object.get("type").and_then(Value::as_str) != Some("object") {
        return Err("Plugin inputSchema root type must be object".into());
    }
    if let Some(properties) = object.get("properties") {
        if !properties.is_object() {
            return Err("Plugin inputSchema properties must be an object".into());
        }
    }
    if let Some(required) = object.get("required") {
        let required = required
            .as_array()
            .ok_or_else(|| "Plugin inputSchema required must be an array".to_string())?;
        if required.iter().any(|value| !value.is_string()) {
            return Err("Plugin inputSchema required entries must be strings".into());
        }
    }
    Ok(())
}

fn valid_pi_tool_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn validate_resource_path(path: &str, package_root: Option<&Path>) -> Result<(), String> {
    let relative = Path::new(path);
    if path.trim().is_empty()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
        || path.contains("://")
    {
        return Err(format!("Resource path escapes the plugin package: {path}"));
    }
    if let Some(root) = package_root {
        let candidate = root.join(relative);
        if !candidate.is_file() {
            return Err(format!("Plugin resource does not exist: {path}"));
        }
        let canonical_root = root
            .canonicalize()
            .map_err(|error| format!("Cannot resolve plugin root: {error}"))?;
        let canonical_candidate = candidate
            .canonicalize()
            .map_err(|error| format!("Cannot resolve plugin resource {path}: {error}"))?;
        if !canonical_candidate.starts_with(&canonical_root) {
            return Err(format!("Resource path escapes the plugin package: {path}"));
        }
    }
    Ok(())
}

fn validate_json_depth(value: &Value, depth: usize) -> Result<(), String> {
    if depth > MAX_SCHEMA_DEPTH {
        return Err(format!(
            "plugin.json exceeds maximum nesting depth {MAX_SCHEMA_DEPTH}"
        ));
    }
    match value {
        Value::Array(items) => {
            for item in items {
                validate_json_depth(item, depth + 1)?;
            }
        }
        Value::Object(fields) => {
            for item in fields.values() {
                validate_json_depth(item, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn valid_plugin_id(id: &str) -> bool {
    let mut segments = id.split('.');
    let mut count = 0;
    for segment in segments.by_ref() {
        count += 1;
        if segment.is_empty()
            || !segment
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return false;
        }
    }
    count >= 2
}

fn valid_semver(version: &str) -> bool {
    let core = version.split_once('+').map_or(version, |(value, _)| value);
    let core = core.split_once('-').map_or(core, |(value, _)| value);
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| {
            !part.is_empty()
                && part.bytes().all(|byte| byte.is_ascii_digit())
                && (part == &"0" || !part.starts_with('0'))
        })
}

fn validate_scene_id(scene_id: &str) -> Result<(), String> {
    if scene_id.is_empty()
        || scene_id.len() > 128
        || !scene_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b':'))
    {
        return Err("Invalid scene ID".into());
    }
    Ok(())
}

fn all_permissions(manifest: &PluginManifest) -> HashSet<String> {
    manifest
        .permissions
        .required
        .iter()
        .chain(&manifest.permissions.optional)
        .map(|permission| permission.name.clone())
        .collect()
}

fn pi_tool_names(manifest: &PluginManifest) -> HashSet<String> {
    manifest
        .contributes
        .get("piTools")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|value| value.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect()
}

fn builtin_manifests() -> Vec<(Value, bool, bool)> {
    vec![
        (
            json!({
                "schemaVersion": 1,
                "id": "core.chat",
                "name": "Chat",
                "description": "Pi conversations, sessions, tools, and workspace context.",
                "version": "1.0.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "contributes": {
                    "activities": [{ "id": "chat", "title": "Chat", "order": 0 }],
                    "views": [
                        { "id": "chat.sessions", "activity": "chat", "location": "sidebar", "title": "Sessions" },
                        { "id": "chat.main", "activity": "chat", "location": "main", "title": "Chat" }
                    ]
                }
            }),
            true,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.projects",
                "name": "Projects",
                "description": "Persistent workspaces that connect conversations, notes, files, and artifacts.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:projects.overview"],
                "contributes": {
                    "activities": [{ "id": "projects", "title": "Projects", "order": 50 }],
                    "views": [
                        { "id": "projects.navigation", "activity": "projects", "location": "sidebar", "title": "Project" },
                        { "id": "projects.overview", "activity": "projects", "location": "main", "title": "Project workspace" }
                    ],
                    "commands": [{ "id": "projects.open", "title": "Open project overview" }]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store project instructions and preferences" }]
                }
            }),
            false,
            // P2-6: project workspace is enabled so the shared project context
            // (instructions, budget, knowledge connections) applies across apps.
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.tasks",
                "name": "Tasks",
                "description": "One place to monitor, recover, pause, and review background work.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:tasks.center"],
                "contributes": {
                    "activities": [{ "id": "tasks", "title": "Tasks", "order": 75 }],
                    "views": [
                        { "id": "tasks.filters", "activity": "tasks", "location": "sidebar", "title": "Task filters" },
                        { "id": "tasks.center", "activity": "tasks", "location": "main", "title": "Task center" }
                    ],
                    "commands": [{ "id": "tasks.open", "title": "Open task center" }]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store task status and history" }],
                    "optional": [{ "name": "notifications.send", "reason": "Notify when background work needs attention" }]
                }
            }),
            false,
            // Task center: dispatch, recovery, completion, and notifications are
            // complete and verified end-to-end (2026-08-20).
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.notes",
                "name": "Notes",
                "description": "Local-first Markdown notebooks and web capture.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": [
                    "onView:notes.library",
                    "onCommand:notes.captureUrl",
                    "onCapability:notes.search",
                    "onCapability:notes.get",
                    "onCapability:notes.create",
                    "onCapability:notes.extractWeb"
                ],
                "contributes": {
                    "activities": [{ "id": "notes", "title": "Notes", "order": 100 }],
                    "views": [
                        { "id": "notes.library", "activity": "notes", "location": "sidebar", "title": "Notebooks" },
                        { "id": "notes.editor", "activity": "notes", "location": "main", "title": "Notes" }
                    ],
                    "commands": [
                        { "id": "notes.new", "title": "New note" },
                        { "id": "notes.captureUrl", "title": "Capture URL" }
                    ],
                    "capabilities": [
                        {
                            "id": "notes.search",
                            "title": "Search notes",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "query": { "type": "string", "minLength": 1, "maxLength": 500 },
                                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                                },
                                "required": ["query"]
                            }
                        },
                        {
                            "id": "notes.get",
                            "title": "Read note",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "notebookId": { "type": "string", "minLength": 1, "maxLength": 100 },
                                    "noteId": { "type": "string", "minLength": 1, "maxLength": 100 }
                                },
                                "required": ["notebookId", "noteId"]
                            }
                        },
                        {
                            "id": "notes.create",
                            "title": "Create note",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "notebookId": { "type": "string", "minLength": 1, "maxLength": 100 },
                                    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
                                    "content": { "type": "string", "maxLength": 1000000 },
                                    "tags": {
                                        "type": "array",
                                        "maxItems": 20,
                                        "items": { "type": "string", "minLength": 1, "maxLength": 64 }
                                    }
                                },
                                "required": ["notebookId", "title"]
                            }
                        },
                        {
                            "id": "notes.extractWeb",
                            "title": "Extract web article",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "url": { "type": "string", "minLength": 1, "maxLength": 2000 }
                                },
                                "required": ["url"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "notes_search",
                            "title": "Search notes",
                            "description": "Search local Markdown notes managed by ZiCode Notes.",
                            "capability": "notes.search",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "query": { "type": "string", "minLength": 1, "maxLength": 500 },
                                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                                },
                                "required": ["query"]
                            }
                        },
                        {
                            "name": "notes_get",
                            "title": "Read note",
                            "description": "Read a specific local Markdown note after finding it.",
                            "capability": "notes.get",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "notebookId": { "type": "string" },
                                    "noteId": { "type": "string" }
                                },
                                "required": ["notebookId", "noteId"]
                            }
                        },
                        {
                            "name": "notes_create",
                            "title": "Create note",
                            "description": "Create a new local Markdown note in a user-selected notebook.",
                            "capability": "notes.create",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "notebookId": { "type": "string" },
                                    "title": { "type": "string" },
                                    "content": { "type": "string" },
                                    "tags": { "type": "array", "items": { "type": "string" } }
                                },
                                "required": ["notebookId", "title"]
                            }
                        },
                        {
                            "name": "notes_extract_web",
                            "title": "Extract web article",
                            "description": "Fetch a public web page and extract its main article content (removing navigation, header, footer, ads and sidebars) as readable Markdown that preserves headings, lists, links, images, quotes, code and tables.",
                            "capability": "notes.extractWeb",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "url": { "type": "string", "minLength": 1, "maxLength": 2000 }
                                },
                                "required": ["url"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store local notebooks and indexes" }],
                    "optional": [
                        { "name": "network.fetch", "reason": "Capture a user-selected web page" },
                        { "name": "pi.tools.register", "reason": "Expose approved note tools to Pi" }
                    ]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.ocr",
                "name": "OCR",
                "description": "Extract text from screenshots and images using the system OCR engine.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:ocr.workbench", "onCapability:ocr.text"],
                "contributes": {
                    "activities": [{ "id": "ocr", "title": "OCR", "order": 110 }],
                    "views": [
                        { "id": "ocr.sidebar", "activity": "ocr", "location": "sidebar", "title": "OCR" },
                        { "id": "ocr.workbench", "activity": "ocr", "location": "main", "title": "Text Extraction" }
                    ],
                    "commands": [{ "id": "ocr.open", "title": "Open Text Extraction" }],
                    "capabilities": [
                        {
                            "id": "ocr.text",
                            "title": "Extract text from image",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "image": { "type": "string", "minLength": 1, "maxLength": 20000000 },
                                    "language": { "type": "string", "minLength": 1, "maxLength": 40 }
                                },
                                "required": ["image"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "ocr_text",
                            "title": "Extract text from image",
                            "description": "Recognize text in a screenshot or image (a data URL or local file path).",
                            "capability": "ocr.text",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "image": { "type": "string" }
                                },
                                "required": ["image"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Read the selected image for OCR" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose OCR to Pi" }]
                }
            }),
            false,
            false,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.watch",
                "name": "Web Watch",
                "description": "Detect when public web pages change with content hash checks.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:watch.center", "onCapability:watch.check"],
                "contributes": {
                    "activities": [{ "id": "watch", "title": "Web Watch", "order": 109 }],
                    "views": [
                        { "id": "watch.sidebar", "activity": "watch", "location": "sidebar", "title": "Web Watch" },
                        { "id": "watch.center", "activity": "watch", "location": "main", "title": "Web Watch" }
                    ],
                    "commands": [{ "id": "watch.open", "title": "Open Web Watch" }],
                    "capabilities": [
                        {
                            "id": "watch.add",
                            "title": "Add page watcher",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "name": { "type": "string", "minLength": 1, "maxLength": 120 },
                                    "url": { "type": "string", "minLength": 1, "maxLength": 2000 }
                                },
                                "required": ["name", "url"]
                            }
                        },
                        {
                            "id": "watch.check",
                            "title": "Check page watcher",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "id": { "type": "string", "minLength": 1, "maxLength": 100 }
                                },
                                "required": ["id"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "watch_add",
                            "title": "Add page watcher",
                            "description": "Add a public web page to the watch list.",
                            "capability": "watch.add",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "name": { "type": "string" },
                                    "url": { "type": "string" }
                                },
                                "required": ["name", "url"]
                            }
                        },
                        {
                            "name": "watch_check",
                            "title": "Check page watcher",
                            "description": "Fetch a watched page and report whether its content changed.",
                            "capability": "watch.check",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "id": { "type": "string" }
                                },
                                "required": ["id"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "network.fetch", "reason": "Fetch watched public pages" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose web watch to Pi" }]
                }
            }),
            false,
            false,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.translate",
                "name": "Translate",
                "description": "Translate text between languages using the configured model.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:translate.workbench", "onCapability:translate.text"],
                "contributes": {
                    "activities": [{ "id": "translate", "title": "Translate", "order": 107 }],
                    "views": [
                        { "id": "translate.sidebar", "activity": "translate", "location": "sidebar", "title": "Translate" },
                        { "id": "translate.workbench", "activity": "translate", "location": "main", "title": "Translation" }
                    ],
                    "commands": [{ "id": "translate.open", "title": "Open Translation" }],
                    "capabilities": [
                        {
                            "id": "translate.text",
                            "title": "Translate text",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "text": { "type": "string", "minLength": 1, "maxLength": 50000 },
                                    "targetLang": { "type": "string", "minLength": 1, "maxLength": 40 },
                                    "sourceLang": { "type": "string", "maxLength": 40 },
                                    "model": { "type": "string", "maxLength": 120 }
                                },
                                "required": ["text", "targetLang"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "translate_text",
                            "title": "Translate text",
                            "description": "Translate a piece of text into another language using the configured model.",
                            "capability": "translate.text",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "text": { "type": "string" },
                                    "targetLang": { "type": "string" },
                                    "sourceLang": { "type": "string" },
                                    "model": { "type": "string" }
                                },
                                "required": ["text", "targetLang"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "network.fetch", "reason": "Call the model gateway for translation" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose translation to Pi" }]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.habits",
                "name": "Habits",
                "description": "Track daily habits and metrics with streaks and history.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": [
                    "onView:habits.dashboard",
                    "onCapability:habits.list",
                    "onCapability:habits.toggle"
                ],
                "contributes": {
                    "activities": [{ "id": "habits", "title": "Habits", "order": 108 }],
                    "views": [
                        { "id": "habits.sidebar", "activity": "habits", "location": "sidebar", "title": "Habits" },
                        { "id": "habits.dashboard", "activity": "habits", "location": "main", "title": "Habit Tracker" }
                    ],
                    "commands": [{ "id": "habits.open", "title": "Open Habit Tracker" }],
                    "capabilities": [
                        {
                            "id": "habits.list",
                            "title": "List habits",
                            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} }
                        },
                        {
                            "id": "habits.toggle",
                            "title": "Toggle habit",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "habitId": { "type": "string", "minLength": 1, "maxLength": 100 },
                                    "date": { "type": "string", "minLength": 10, "maxLength": 10 }
                                },
                                "required": ["habitId", "date"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "habits_list",
                            "title": "List habits",
                            "description": "List the user's habits and their recent check-in history.",
                            "capability": "habits.list",
                            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} }
                        },
                        {
                            "name": "habits_toggle",
                            "title": "Toggle habit",
                            "description": "Mark a habit as done (or undone) for a given YYYY-MM-DD date.",
                            "capability": "habits.toggle",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "habitId": { "type": "string" },
                                    "date": { "type": "string" }
                                },
                                "required": ["habitId", "date"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store habits and check-ins" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose habits to Pi" }]
                }
            }),
            false,
            false,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.graph",
                "name": "Knowledge Graph",
                "description": "Visualize note links, backlinks, similar notes and conflicts.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:graph.main"],
                "contributes": {
                    "activities": [{ "id": "graph", "title": "Knowledge Graph", "order": 106 }],
                    "views": [
                        { "id": "graph.sidebar", "activity": "graph", "location": "sidebar", "title": "Graph" },
                        { "id": "graph.main", "activity": "graph", "location": "main", "title": "Knowledge Graph" }
                    ],
                    "commands": [{ "id": "graph.open", "title": "Open Knowledge Graph" }]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Read note links and similarity data" }]
                }
            }),
            false,
            false,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.idphoto",
                "name": "ID Photo",
                "description": "ID photo layout: crop to templates, replace backgrounds, and arrange printable sheets.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:idphoto.workbench", "onCapability:idphoto.layout"],
                "contributes": {
                    "activities": [{ "id": "idphoto", "title": "ID Photo", "order": 200 }],
                    "views": [
                        { "id": "idphoto.sidebar", "activity": "idphoto", "location": "sidebar", "title": "ID Photo" },
                        { "id": "idphoto.workbench", "activity": "idphoto", "location": "main", "title": "ID Photo Layout" }
                    ],
                    "commands": [{ "id": "idphoto.open", "title": "Open ID Photo Layout" }],
                    "capabilities": [
                        {
                            "id": "idphoto.layout",
                            "title": "证件照排版",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "image": { "type": "string", "minLength": 1, "maxLength": 20000000 },
                                    "template": { "type": "string", "enum": ["one_inch", "small_one_inch", "large_one_inch", "two_inch", "small_two_inch", "visa", "passport", "driving", "us_visa"] },
                                    "sheet": { "type": "string", "enum": ["5inch", "6inch", "a4"] },
                                    "background": { "type": "string", "enum": ["keep", "white", "red", "blue", "lightblue"] },
                                    "tolerance": { "type": "integer", "minimum": 0, "maximum": 255 },
                                    "cols": { "type": "integer", "minimum": 1, "maximum": 30 },
                                    "rows": { "type": "integer", "minimum": 1, "maximum": 30 },
                                    "borderPx": { "type": "integer", "minimum": 0, "maximum": 20 }
                                },
                                "required": ["image", "template", "sheet"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "idphoto_layout",
                            "title": "证件照排版",
                            "description": "把一张人像照片按证件照模板（一寸/二寸/签证等）裁剪、可选替换底色（白/红/蓝/浅蓝），排版到打印纸（5寸/6寸/A4）并输出 PNG；返回可直接展示与打印的图片地址。image 参数传照片的 data URL 或文件路径。",
                            "capability": "idphoto.layout",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "image": { "type": "string", "minLength": 1, "maxLength": 20000000 },
                                    "template": { "type": "string", "enum": ["one_inch", "small_one_inch", "large_one_inch", "two_inch", "small_two_inch", "visa", "passport", "driving", "us_visa"] },
                                    "sheet": { "type": "string", "enum": ["5inch", "6inch", "a4"] },
                                    "background": { "type": "string", "enum": ["keep", "white", "red", "blue", "lightblue"] },
                                    "tolerance": { "type": "integer", "minimum": 0, "maximum": 255 },
                                    "cols": { "type": "integer", "minimum": 1, "maximum": 30 },
                                    "rows": { "type": "integer", "minimum": 1, "maximum": 30 },
                                    "borderPx": { "type": "integer", "minimum": 0, "maximum": 20 }
                                },
                                "required": ["image", "template", "sheet"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "保存证件照排版输出" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "向 Pi 提供证件照排版工具" }]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.imagetools",
                "name": "Image Tools",
                "description": "Image toolbox: resize, format/quality conversion, flip, rotate and grid concat.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:imagetools.workbench", "onCapability:imagetools.process", "onCapability:imagetools.concat"],
                "contributes": {
                    "activities": [{ "id": "imagetools", "title": "Image Tools", "order": 250 }],
                    "views": [
                        { "id": "imagetools.sidebar", "activity": "imagetools", "location": "sidebar", "title": "Image Tools" },
                        { "id": "imagetools.workbench", "activity": "imagetools", "location": "main", "title": "Image Tools" }
                    ],
                    "commands": [{ "id": "imagetools.open", "title": "Open Image Tools" }],
                    "capabilities": [
                        {
                            "id": "imagetools.process",
                            "title": "Process image",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "image": { "type": "string", "minLength": 1, "maxLength": 20000000 },
                                    "resize": {
                                        "type": "object",
                                        "properties": {
                                            "width": { "type": "integer", "minimum": 1, "maximum": 20000 },
                                            "height": { "type": "integer", "minimum": 1, "maximum": 20000 },
                                            "fit": { "type": "string", "enum": ["contain", "cover", "stretch"] }
                                        }
                                    },
                                    "format": { "type": "string", "enum": ["png", "jpeg", "webp"] },
                                    "quality": { "type": "integer", "minimum": 1, "maximum": 100 },
                                    "rotate": { "type": "integer", "enum": [90, 180, 270] },
                                    "flip": { "type": "string", "enum": ["horizontal", "vertical", "both"] }
                                },
                                "required": ["image"]
                            }
                        },
                        {
                            "id": "imagetools.concat",
                            "title": "Concat images",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "images": { "type": "array", "minItems": 1, "maxItems": 50, "items": { "type": "string", "minLength": 1, "maxLength": 20000000 } },
                                    "columns": { "type": "integer", "minimum": 1, "maximum": 20 },
                                    "gap": { "type": "integer", "minimum": 0, "maximum": 200 },
                                    "background": { "type": "string", "minLength": 1, "maxLength": 16 }
                                },
                                "required": ["images"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "image_process",
                            "title": "Process image",
                            "description": "Resize, convert format/quality, rotate or flip an image (input as a data URL or local file path).",
                            "capability": "imagetools.process",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "image": { "type": "string" },
                                    "resize": { "type": "object" },
                                    "format": { "type": "string", "enum": ["png", "jpeg", "webp"] },
                                    "quality": { "type": "integer", "minimum": 1, "maximum": 100 },
                                    "rotate": { "type": "integer", "enum": [90, 180, 270] },
                                    "flip": { "type": "string", "enum": ["horizontal", "vertical", "both"] }
                                },
                                "required": ["image"]
                            }
                        },
                        {
                            "name": "image_concat",
                            "title": "Concat images",
                            "description": "Arrange multiple images into a grid (data URLs or local file paths) and output one combined PNG.",
                            "capability": "imagetools.concat",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "images": { "type": "array", "items": { "type": "string" } },
                                    "columns": { "type": "integer", "minimum": 1, "maximum": 20 },
                                    "gap": { "type": "integer", "minimum": 0, "maximum": 200 },
                                    "background": { "type": "string" }
                                },
                                "required": ["images"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Save processed image output" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose image tools to Pi" }]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.clipboard",
                "name": "Clipboard",
                "description": "A quick capture inbox for text and URLs before you organize them.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": [
                    "onView:clipboard.inbox",
                    "onCapability:clipboard.add",
                    "onCapability:clipboard.list"
                ],
                "contributes": {
                    "activities": [{ "id": "clipboard", "title": "Clipboard", "order": 255 }],
                    "views": [
                        { "id": "clipboard.sidebar", "activity": "clipboard", "location": "sidebar", "title": "Clipboard" },
                        { "id": "clipboard.inbox", "activity": "clipboard", "location": "main", "title": "Clipboard Inbox" }
                    ],
                    "commands": [{ "id": "clipboard.open", "title": "Open Clipboard Inbox" }],
                    "capabilities": [
                        {
                            "id": "clipboard.add",
                            "title": "Add to clipboard inbox",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "text": { "type": "string", "minLength": 1, "maxLength": 200000 },
                                    "source": { "type": "string", "maxLength": 64 }
                                },
                                "required": ["text"]
                            }
                        },
                        {
                            "id": "clipboard.list",
                            "title": "List clipboard inbox",
                            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "clipboard_add",
                            "title": "Add to clipboard inbox",
                            "description": "Capture a piece of text or a URL into the workspace clipboard inbox for later organization.",
                            "capability": "clipboard.add",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "text": { "type": "string" },
                                    "source": { "type": "string" }
                                },
                                "required": ["text"]
                            }
                        },
                        {
                            "name": "clipboard_list",
                            "title": "List clipboard inbox",
                            "description": "List the current clipboard inbox items in this workspace.",
                            "capability": "clipboard.list",
                            "inputSchema": { "type": "object", "additionalProperties": false, "properties": {} }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store captured clipboard items" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose the clipboard inbox to Pi" }]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.documents",
                "name": "Documents",
                "description": "Import PDF and DOCX files as readable Markdown.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:documents.workbench", "onCapability:documents.import"],
                "contributes": {
                    "activities": [{ "id": "documents", "title": "Documents", "order": 260 }],
                    "views": [
                        { "id": "documents.sidebar", "activity": "documents", "location": "sidebar", "title": "Documents" },
                        { "id": "documents.workbench", "activity": "documents", "location": "main", "title": "Document Import" }
                    ],
                    "commands": [{ "id": "documents.open", "title": "Open Document Import" }],
                    "capabilities": [
                        {
                            "id": "documents.import",
                            "title": "Import document",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "document": { "type": "string", "minLength": 1, "maxLength": 50000000 },
                                    "title": { "type": "string", "minLength": 1, "maxLength": 200 },
                                    "kind": { "type": "string", "enum": ["pdf", "docx"] }
                                },
                                "required": ["document"]
                            }
                        }
                    ],
                    "piTools": [
                        {
                            "name": "documents_import",
                            "title": "Import document",
                            "description": "Convert a PDF or DOCX document (a data URL or local file path) into readable Markdown, preserving headings, paragraphs, and lists.",
                            "capability": "documents.import",
                            "inputSchema": {
                                "type": "object",
                                "additionalProperties": false,
                                "properties": {
                                    "document": { "type": "string" },
                                    "title": { "type": "string" },
                                    "kind": { "type": "string", "enum": ["pdf", "docx"] }
                                },
                                "required": ["document"]
                            }
                        }
                    ]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Read documents selected by the user" }],
                    "optional": [{ "name": "pi.tools.register", "reason": "Expose document import to Pi" }]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.automation",
                "name": "Automation",
                "description": "Scheduled, approval-aware workflows with retries and auditable history.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:automation.center"],
                "contributes": {
                    "activities": [{ "id": "automation", "title": "Automation", "order": 150 }],
                    "views": [
                        { "id": "automation.navigation", "activity": "automation", "location": "sidebar", "title": "Automations" },
                        { "id": "automation.center", "activity": "automation", "location": "main", "title": "Automation center" }
                    ],
                    "commands": [{ "id": "automation.open", "title": "Open automations" }]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store workflow definitions and run history" }],
                    "optional": [{ "name": "notifications.send", "reason": "Notify when a workflow needs approval" }]
                }
            }),
            false,
            // Scheduler: enqueue, approval, system notifications, and run-again
            // are complete and verified end-to-end (2026-08-20).
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.finance",
                "name": "Finance",
                "description": "Research, screening, deterministic backtests, and paper accounts.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:finance.workbench"],
                "contributes": {
                    "activities": [{ "id": "finance", "title": "Finance", "order": 200 }],
                    "views": [
                        { "id": "finance.research", "activity": "finance", "location": "sidebar", "title": "Research" },
                        { "id": "finance.workbench", "activity": "finance", "location": "main", "title": "Finance Workbench" }
                    ],
                    "commands": [
                        { "id": "finance.openWorkbench", "title": "Open workbench" },
                        { "id": "finance.configuration", "title": "Configuration" }
                    ]
                },
                "permissions": {
                    "optional": [
                        { "name": "network.fetch", "reason": "Request approved market data providers" },
                        { "name": "pi.runtime.read", "reason": "Read active Pi session context" }
                    ]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.artifacts",
                "name": "Artifacts",
                "description": "Reports, charts, files, provenance, and exports from every plugin.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:artifacts.library"],
                "contributes": {
                    "activities": [{ "id": "artifacts", "title": "Artifacts", "order": 300 }],
                    "views": [
                        { "id": "artifacts.library", "activity": "artifacts", "location": "main", "title": "Artifacts" }
                    ],
                    "commands": [{ "id": "artifacts.export", "title": "Export" }]
                },
                "permissions": {
                    "required": [{ "name": "storage.plugin", "reason": "Store artifact metadata and resource handles" }]
                }
            }),
            false,
            true,
        ),
        (
            json!({
                "schemaVersion": 1,
                "id": "com.zicode.articles",
                "name": "Articles",
                "description": "Create and publish articles to the Astro blog and WeChat Official Account.",
                "version": "0.1.0",
                "publisher": "zicode",
                "engines": { "pluginApi": "^1.0.0" },
                "activationEvents": ["onView:articles.library"],
                "contributes": {
                    "activities": [{ "id": "articles", "title": "Articles", "order": 270 }],
                    "views": [
                        { "id": "articles.library", "activity": "articles", "location": "main", "title": "Articles" }
                    ],
                    "commands": [{ "id": "articles.open", "title": "Open Article Studio" }]
                },
                "permissions": {
                    "required": [{ "name": "network.fetch", "reason": "Publish to WeChat and upload the blog" }]
                }
            }),
            false,
            true,
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::{
        copy_package_tree, load_manifest, PluginOrigin, PluginRegistry, MAX_PACKAGE_FILE_BYTES,
    };
    use crate::plugin_package::write_test_signed_package;
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("zicode-plugin-registry-{label}-{nonce}"))
    }

    fn write_manifest(root: &Path, value: serde_json::Value) {
        fs::create_dir_all(root).unwrap();
        fs::write(
            root.join("plugin.json"),
            serde_json::to_vec_pretty(&value).unwrap(),
        )
        .unwrap();
    }

    fn developer_manifest(id: &str) -> serde_json::Value {
        json!({
            "schemaVersion": 1,
            "id": id,
            "name": "Example",
            "description": "Example developer plugin",
            "version": "1.2.3",
            "publisher": "example",
            "contributes": {
                "commands": [{ "id": "example.run", "title": "Run" }]
            },
            "permissions": {
                "required": [{ "name": "storage.plugin", "reason": "Save state" }]
            }
        })
    }

    #[test]
    fn registers_builtins_and_persists_scene_specific_enablement() {
        let root = temp_root("persistence");
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        assert_eq!(registry.list("programming").len(), 17);
        assert_eq!(registry.capabilities("programming").len(), 11);
        // P2-6: Projects ships enabled so the shared project context applies.
        assert!(registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == "com.zicode.projects")
            .unwrap()
            .enabled);
        for plugin_id in ["com.zicode.tasks", "com.zicode.automation"] {
            assert!(
                registry
                    .list("programming")
                    .into_iter()
                    .find(|plugin| plugin.manifest.id == plugin_id)
                    .unwrap()
                    .enabled,
                "{plugin_id} should be enabled by default now that its loop is complete"
            );
        }
        assert!(registry
            .pi_tools("programming")
            .iter()
            .any(|tool| tool.name == "notes_search"));
        assert!(registry
            .pi_tools("programming")
            .iter()
            .any(|tool| tool.name == "idphoto_layout"));
        registry
            .set_enabled("programming", "com.zicode.notes", false)
            .unwrap();
        assert!(
            !registry
                .list("programming")
                .into_iter()
                .find(|plugin| plugin.manifest.id == "com.zicode.notes")
                .unwrap()
                .enabled
        );
        assert!(
            registry
                .list("finance")
                .into_iter()
                .find(|plugin| plugin.manifest.id == "com.zicode.notes")
                .unwrap()
                .enabled
        );

        let reopened = PluginRegistry::open(root.clone()).unwrap();
        assert!(
            !reopened
                .list("programming")
                .into_iter()
                .find(|plugin| plugin.manifest.id == "com.zicode.notes")
                .unwrap()
                .enabled
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_pi_tools_that_do_not_map_to_declared_capabilities() {
        let root = temp_root("invalid-pi-tool");
        let mut manifest = developer_manifest("com.example.invalid-tool");
        manifest["contributes"]["piTools"] = json!([{
            "name": "example_search",
            "title": "Search",
            "description": "Search",
            "capability": "missing.search",
            "inputSchema": { "type": "object" }
        }]);
        write_manifest(&root, manifest);
        assert!(load_manifest(&root)
            .unwrap_err()
            .contains("references undeclared capability"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_duplicate_enabled_pi_tool_names_in_one_scene() {
        let root = temp_root("tool-collision");
        let package = root.join("developer/example");
        let mut manifest = developer_manifest("com.example.tool-collision");
        manifest["contributes"]["capabilities"] = json!([{
            "id": "example.search",
            "title": "Search",
            "inputSchema": { "type": "object" }
        }]);
        manifest["contributes"]["piTools"] = json!([{
            "name": "notes_search",
            "title": "Search",
            "description": "Search",
            "capability": "example.search",
            "inputSchema": { "type": "object" }
        }]);
        manifest["permissions"]["optional"] = json!([{
            "name": "pi.tools.register",
            "reason": "Expose the search tool"
        }]);
        write_manifest(&package, manifest);
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        registry
            .set_permission(
                "programming",
                "com.example.tool-collision",
                "pi.tools.register",
                true,
            )
            .unwrap_err();
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discovers_valid_developer_plugins_disabled_and_untrusted_by_default() {
        let root = temp_root("developer");
        write_manifest(
            &root.join("developer").join("example"),
            developer_manifest("com.example.local"),
        );
        let registry = PluginRegistry::open(root.clone()).unwrap();
        let plugin = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == "com.example.local")
            .unwrap();
        assert_eq!(plugin.origin, PluginOrigin::Developer);
        assert!(!plugin.enabled);
        assert!(!plugin.permission_grants["storage.plugin"]);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_path_escape_and_reports_corrupt_manifests_without_loading_them() {
        let root = temp_root("invalid");
        let package = root.join("developer").join("escape");
        let mut manifest = developer_manifest("com.example.escape");
        manifest["runtime"] = json!({ "worker": "../outside.js" });
        write_manifest(&package, manifest);
        let registry = PluginRegistry::open(root.clone()).unwrap();
        assert!(registry
            .list("programming")
            .into_iter()
            .all(|plugin| plugin.manifest.id != "com.example.escape"));
        assert_eq!(registry.diagnostics().len(), 1);
        assert_eq!(registry.diagnostics()[0].code, "manifest_invalid");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn revoking_a_required_permission_disables_the_plugin() {
        let root = temp_root("permissions");
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        registry
            .set_permission("programming", "com.zicode.notes", "storage.plugin", false)
            .unwrap();
        let notes = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == "com.zicode.notes")
            .unwrap();
        assert!(!notes.enabled);
        assert!(!notes.permission_grants["storage.plugin"]);
        assert!(registry
            .set_enabled("programming", "com.zicode.notes", true)
            .is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn direct_manifest_loader_requires_declared_resources_to_exist() {
        let root = temp_root("resource");
        let mut manifest = developer_manifest("com.example.resource");
        manifest["contributes"]["views"] = json!([{
            "id": "example.main",
            "activity": "example",
            "location": "main",
            "title": "Example",
            "entry": "views/main.html"
        }]);
        write_manifest(&root, manifest);
        assert!(load_manifest(&root)
            .unwrap_err()
            .contains("Plugin resource does not exist"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_only_declared_enabled_developer_view_documents() {
        let root = temp_root("view-document");
        let package = root.join("developer/example-view");
        let mut manifest = developer_manifest("com.example.view");
        manifest["contributes"]["activities"] =
            json!([{ "id": "example", "title": "Example", "order": 10 }]);
        manifest["contributes"]["views"] = json!([{
            "id": "example.main",
            "activity": "example",
            "location": "main",
            "title": "Example view",
            "entry": "views/main.html"
        }]);
        manifest["permissions"]["required"] = json!([]);
        write_manifest(&package, manifest);
        fs::create_dir_all(package.join("views")).unwrap();
        fs::write(
            package.join("views/main.html"),
            "<main><h1>Sandboxed example</h1></main>",
        )
        .unwrap();
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        assert!(registry
            .view_document("programming", "com.example.view", "example.main")
            .unwrap_err()
            .contains("not enabled"));
        registry
            .set_enabled("programming", "com.example.view", true)
            .unwrap();
        let document = registry
            .view_document("programming", "com.example.view", "example.main")
            .unwrap();
        assert_eq!(document.location, "main");
        assert!(document.html.contains("Sandboxed example"));
        assert!(registry
            .view_document("finance", "com.example.view", "example.main")
            .unwrap_err()
            .contains("not enabled"));
        assert!(registry
            .view_document("programming", "com.example.view", "missing")
            .unwrap_err()
            .contains("does not declare"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installs_upgrades_and_uninstalls_developer_packages_while_preserving_state() {
        let root = temp_root("lifecycle");
        let source = temp_root("lifecycle-source");
        write_manifest(&source, developer_manifest("com.example.lifecycle"));
        let mut registry = PluginRegistry::open(root.clone()).unwrap();

        let plugin_id = registry.install_developer(&source).unwrap();
        assert_eq!(plugin_id, "com.example.lifecycle");
        assert!(source.join("plugin.json").is_file());
        assert!(root
            .join("developer")
            .join("com.example.lifecycle")
            .join("plugin.json")
            .is_file());
        assert!(
            !registry
                .list("programming")
                .into_iter()
                .find(|plugin| plugin.manifest.id == plugin_id)
                .unwrap()
                .enabled
        );

        registry
            .set_permission("programming", &plugin_id, "storage.plugin", true)
            .unwrap();
        registry
            .set_enabled("programming", &plugin_id, true)
            .unwrap();
        let mut upgrade = developer_manifest("com.example.lifecycle");
        upgrade["version"] = json!("1.2.4");
        write_manifest(&source, upgrade);
        registry.install_developer(&source).unwrap();
        let upgraded = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == plugin_id)
            .unwrap();
        assert_eq!(upgraded.manifest.version, "1.2.4");
        assert!(upgraded.enabled);

        registry.uninstall_developer(&plugin_id).unwrap();
        assert!(registry
            .list("programming")
            .into_iter()
            .all(|plugin| plugin.manifest.id != plugin_id));
        assert!(!root
            .join("developer")
            .join("com.example.lifecycle")
            .exists());

        registry.install_developer(&source).unwrap();
        let reinstalled = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == plugin_id)
            .unwrap();
        assert!(reinstalled.enabled);
        assert!(reinstalled.permission_grants["storage.plugin"]);
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(source);
    }

    #[test]
    fn refuses_to_uninstall_builtins_or_replace_them_with_developer_packages() {
        let root = temp_root("builtin-protection");
        let source = temp_root("builtin-protection-source");
        write_manifest(&source, developer_manifest("core.chat"));
        let mut registry = PluginRegistry::open(root.clone()).unwrap();

        assert!(registry
            .install_developer(&source)
            .unwrap_err()
            .contains("cannot replace built-in"));
        assert!(registry
            .uninstall_developer("core.chat")
            .unwrap_err()
            .contains("cannot be uninstalled"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(source);
    }

    #[test]
    fn rejects_packages_that_exceed_file_size_limits_and_cleans_staging() {
        let source = temp_root("oversized-source");
        let destination = temp_root("oversized-destination");
        fs::create_dir_all(&source).unwrap();
        let oversized = fs::File::create(source.join("oversized.bin")).unwrap();
        oversized.set_len(MAX_PACKAGE_FILE_BYTES + 1).unwrap();

        assert!(copy_package_tree(&source, &destination)
            .unwrap_err()
            .contains("exceeds the allowed"));
        assert!(!destination.exists());

        let _ = fs::remove_dir_all(source);
    }

    #[test]
    fn installs_updates_rolls_back_and_revokes_signed_packages_atomically() {
        let root = temp_root("signed-lifecycle");
        let packages = temp_root("signed-lifecycle-packages");
        let mut first = developer_manifest("com.example.signed-lifecycle");
        first["publisher"] = json!("Example Publisher");
        let first_package = write_test_signed_package(&packages, &first, "first.zicode-plugin");
        let mut registry = PluginRegistry::open(root.clone()).unwrap();
        let preview = registry.preview_signed(&first_package).unwrap();
        assert!(!preview.trusted);
        assert!(registry
            .install_signed(&first_package, false)
            .unwrap_err()
            .contains("trust confirmation"));
        registry.install_signed(&first_package, true).unwrap();
        let installed = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == "com.example.signed-lifecycle")
            .unwrap();
        assert_eq!(installed.origin, PluginOrigin::Signed);
        assert_eq!(
            installed.publisher_key_id.as_deref(),
            Some(preview.publisher_key_id.as_str())
        );
        assert!(registry
            .install_signed(&first_package, false)
            .unwrap_err()
            .contains("already installed"));

        let mut second = first.clone();
        second["version"] = json!("1.2.4");
        let second_package = write_test_signed_package(&packages, &second, "second.zicode-plugin");
        registry.install_signed(&second_package, false).unwrap();
        let upgraded = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == "com.example.signed-lifecycle")
            .unwrap();
        assert_eq!(upgraded.manifest.version, "1.2.4");
        assert_eq!(upgraded.retained_versions, vec!["1.2.3"]);
        assert!(registry
            .install_signed(&first_package, false)
            .unwrap_err()
            .contains("explicit rollback"));

        registry
            .rollback_signed("com.example.signed-lifecycle", "1.2.3")
            .unwrap();
        let rolled_back = registry
            .list("programming")
            .into_iter()
            .find(|plugin| plugin.manifest.id == "com.example.signed-lifecycle")
            .unwrap();
        assert_eq!(rolled_back.manifest.version, "1.2.3");
        assert_eq!(rolled_back.retained_versions, vec!["1.2.4"]);

        registry
            .revoke_signed_publisher(&preview.publisher_key_id)
            .unwrap();
        assert!(registry
            .list("programming")
            .into_iter()
            .all(|plugin| plugin.manifest.id != "com.example.signed-lifecycle"));
        assert!(registry
            .install_signed(&second_package, false)
            .unwrap_err()
            .contains("revoked"));

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(packages);
    }
}

//! Read-only manual discovery. Never registers Pi tools, loads a view or starts a Worker.
use super::*;
use sha2::{Digest, Sha256};
use std::io::{BufWriter, Write};

struct HashWriter<'a>(&'a mut Sha256);

impl Write for HashWriter<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.update(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(crate) const PAGE_SIZE: usize = 40;

pub(crate) fn tool_access_id(plugin_id: &str, capability_id: &str) -> String {
    let bytes = serde_json::to_vec(&(plugin_id, capability_id)).expect("string tuple");
    format!("manual.tool:{:x}", Sha256::digest(bytes))
}

pub(crate) fn view_operation_access_id(plugin_id: &str, operation_id: &str) -> String {
    let bytes = serde_json::to_vec(&(plugin_id, operation_id)).expect("string tuple");
    format!("view.operation:{:x}", Sha256::digest(bytes))
}

#[derive(Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum CatalogView {
    #[default]
    All,
    Favorites,
    Recent,
}

#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CatalogQuery {
    pub scene_id: String,
    #[serde(default)]
    pub query: String,
    #[serde(default)]
    pub offset: usize,
    pub revision: Option<String>,
    #[serde(default)]
    pub view: CatalogView,
    pub workspace_id: Option<String>,
    pub access_revision: Option<u64>,
    pub plugin_id: Option<String>,
    pub category_id: Option<String>,
    /// Until the UI has a separate View navigation path, legacy callers receive executable tools only.
    #[serde(default)]
    pub include_view_operations: bool,
    #[serde(default)]
    pub resource_only: bool,
    pub resource_mime_type: Option<String>,
    pub exclude_plugin_id: Option<String>,
    pub exclude_capability_id: Option<String>,
    #[serde(default)]
    pub directory_only: bool,
    pub file_name: Option<String>,
    pub selected_file_count: Option<usize>,
    /// JSON array of Explorer basenames; the Host never receives their paths here.
    pub file_names: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DetailQuery {
    pub scene_id: String,
    pub plugin_id: String,
    pub capability_id: String,
    pub revision: String,
    #[serde(default)]
    pub resource_mime_type: Option<String>,
}

fn invalid_scene(scene: &str) -> Result<(), &'static str> {
    validate_scene_id(scene).map_err(|_| "invalid_parameters")
}

impl PluginRegistry {
    pub(crate) fn manual_revision(&self, scene: &str) -> String {
        // Bind same-version reinstalls, permission changes (including revoke/regrant),
        // scene without copying any executable or compiled module.
        let mut manifests: Vec<_> = self.plugins.values().map(|p| &p.manifest).collect();
        manifests.sort_by(|a, b| a.id.cmp(&b.id));
        let mut digest = Sha256::new();
        {
            let mut writer = BufWriter::with_capacity(8 * 1024, HashWriter(&mut digest));
            serde_json::to_writer(
                &mut writer,
                &(scene, self.result_epoch(), &self.state, manifests),
            )
            .expect("registry metadata is serializable");
            writer.flush().expect("registry metadata hash writer is infallible");
        }
        format!("{:x}", digest.finalize())
    }

    fn manual_revision_for_resource_type(&self, scene: &str, mime_type: Option<&str>) -> String {
        match mime_type {
            Some(mime) => {
                let base = self.manual_revision(scene);
                format!("{:x}", Sha256::digest(serde_json::to_vec(&(base, mime)).expect("catalog query is serializable")))
            }
            None => self.manual_revision(scene),
        }
    }

    #[cfg(test)]
    pub(crate) fn manual_catalog(&self, request: &CatalogQuery) -> Result<Value, &'static str> {
        self.manual_catalog_with_access(request, None)
    }

    pub(crate) fn manual_catalog_with_access(
        &self,
        request: &CatalogQuery,
        access: Option<&crate::metadata_store::tool_access::ToolAccess>,
    ) -> Result<Value, &'static str> {
        invalid_scene(&request.scene_id)?;
        if (request.resource_only && request.directory_only)
            || request.resource_mime_type.as_deref().is_some_and(|mime| {
                !request.resource_only || request.directory_only
                    || !super::resource_input_types::valid_mime_type(mime)
            })
            || request.file_name.as_deref().is_some_and(|name| !request.resource_only || !file_input::valid_name(name)) {
            return Err("invalid_parameters");
        }
        if request.selected_file_count.is_some_and(|count| !(2..=4).contains(&count)
            || !request.resource_only || request.directory_only || request.file_name.is_some()) {
            return Err("invalid_parameters");
        }
        let selected_names = if let Some(raw) = request.file_names.as_deref() {
            if raw.len() > 8192 || request.file_name.is_some() || !request.resource_only || request.directory_only {
                return Err("invalid_parameters");
            }
            let names: Vec<String> = serde_json::from_str(raw).map_err(|_| "invalid_parameters")?;
            if request.selected_file_count != Some(names.len())
                || !(2..=4).contains(&names.len())
                || names.iter().any(|name| !file_input::valid_name(name))
                || names.iter().collect::<std::collections::HashSet<_>>().len() != names.len() {
                return Err("invalid_parameters");
            }
            Some(names)
        } else {
            None
        };
        if request.query.len() > 512 || request.offset > 1_000_000
            || request.plugin_id.as_ref().is_some_and(|id| id.len() > 256)
            || request.category_id.as_ref().is_some_and(|id| id.len() > 64) {
            return Err("invalid_parameters");
        }
        if request.resource_mime_type.as_deref().is_some_and(|mime| {
            !request.resource_only || request.directory_only
                || !super::resource_input_types::valid_mime_type(mime)
        }) {
            return Err("invalid_parameters");
        }
        match (request.exclude_plugin_id.as_deref(), request.exclude_capability_id.as_deref()) {
            (None, None) => {}
            (Some(plugin_id), Some(capability_id))
                if request.resource_only && request.resource_mime_type.is_some()
                    && !plugin_id.is_empty() && plugin_id.len() <= 256
                    && !capability_id.is_empty() && capability_id.len() <= 256 => {}
            _ => return Err("invalid_parameters"),
        }
        let revision = self.manual_revision_for_resource_type(&request.scene_id, request.resource_mime_type.as_deref());
        if request.revision.as_ref().is_some_and(|r| r != &revision)
            || (request.offset != 0 && request.revision.is_none())
        {
            return Err("catalog_changed");
        }
        let selected = match request.view {
            CatalogView::All => None,
            CatalogView::Favorites | CatalogView::Recent => {
                let access = access.ok_or("invalid_parameters")?;
                if request.access_revision.is_some_and(|value| value != access.revision)
                    || (request.offset != 0 && request.access_revision.is_none())
                {
                    return Err("catalog_changed");
                }
                Some(match request.view {
                    CatalogView::Favorites => access.favorites.clone(),
                    _ => access.recent.iter().map(|entry| entry.id.clone()).collect(),
                })
            }
        };
        let ranks: Option<HashMap<&str, usize>> = selected.as_ref().map(|ids| {
            ids.iter().enumerate().map(|(rank, id)| (id.as_str(), rank)).collect()
        });
        let terms: Vec<_> = directory_metadata::normalize(&request.query)
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        let mut entries = Vec::new();
        let mut sources: BTreeMap<String, Value> = BTreeMap::new();
        let mut categories: BTreeMap<String, usize> = BTreeMap::new();
        for plugin in self.plugins.values() {
            let manifest = &plugin.manifest;
            let enabled = self.manual_enabled(&request.scene_id, plugin);
            let source_text = format!("{} {} {} {} {}", manifest.id, manifest.name,
                manifest.display_name.as_deref().unwrap_or(""), manifest.description, manifest.publisher);
            if request.include_view_operations && !request.resource_only && !request.directory_only && request.file_name.is_none()
                && request.file_names.is_none() && request.selected_file_count.is_none() {
                for operation in manifest.contributes.get("viewOperations").and_then(Value::as_array)
                    .into_iter().flatten() {
                    let (Some(id), Some(title), Some(view_id)) = (
                        operation.get("id").and_then(Value::as_str),
                        operation.get("title").and_then(Value::as_str),
                        operation.get("viewId").and_then(Value::as_str),
                    ) else { continue; };
                    let access_id = view_operation_access_id(&manifest.id, id);
                    if ranks.as_ref().is_some_and(|ranks| !ranks.contains_key(access_id.as_str())) {
                        continue;
                    }
                    let metadata = operation.get("directory");
                    let category = metadata.and_then(|m| m.get("categoryId"))
                        .and_then(Value::as_str).unwrap_or("uncategorized");
                    *categories.entry(category.to_owned()).or_default() += 1;
                    let source = sources.entry(manifest.id.clone()).or_insert_with(|| json!({
                        "pluginId":manifest.id,
                        "title":manifest.display_name.as_deref().unwrap_or(&manifest.name),
                        "count":0,"enabled":enabled
                    }));
                    source["count"] = json!(source["count"].as_u64().unwrap_or(0) + 1);
                    if request.plugin_id.as_ref().is_some_and(|selected| !selected.is_empty() && selected != &manifest.id)
                        || request.category_id.as_ref().is_some_and(|selected| !selected.is_empty() && selected != category) {
                        continue;
                    }
                    let aliases = metadata.and_then(|m| m.get("aliases")).and_then(Value::as_array)
                        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_default();
                    let description = metadata.and_then(|m| m.get("description"))
                        .and_then(Value::as_str).unwrap_or("");
                    let Some(rank) = tool_search::relevance(&terms, id, title, &aliases, description, &source_text) else {
                        continue;
                    };
                    entries.push((0, rank, json!({
                        "kind":"view-operation",
                        "toolId":serde_json::to_string(&("view-operation", &manifest.id, id)).expect("string tuple"),
                        "accessId":access_id,"pluginId":manifest.id,"operationId":id,"viewId":view_id,
                        "title":title,"categoryId":category,"description":description,
                        "applicationName":manifest.display_name.as_deref().unwrap_or(&manifest.name),
                        "publisher":manifest.publisher,"version":manifest.version,
                        "enabled":enabled,"status":if enabled {"available_to_open"} else {"plugin_disabled"},
                        "runtime":"view"
                    })));
                }
            }
            let Some(caps) = manifest.contributes.get("capabilities").and_then(Value::as_array) else {
                continue;
            };
            // Metadata-only eligibility; the transfer Host rechecks authority and module bytes.
            let manifest_input_profile = manifest.runtime.get("resourceInputProfile").and_then(Value::as_str);
            if matches!(manifest_input_profile,
                Some(crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE | crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE))
                && !request.resource_only {
                continue;
            }
            let wasi_receiver = manifest.runtime.get("wasi").and_then(Value::as_str).is_some()
                && manifest_input_profile == Some("resource.wasi.input.draft2");
            let resource_permission = manifest.permissions.required.iter().chain(&manifest.permissions.optional)
                .any(|p| p.name == "resource.read")
                && self.state.scenes.get(&request.scene_id).and_then(|s| s.get(&manifest.id))
                    .and_then(|s| s.permissions.get("resource.read")).copied().unwrap_or(plugin.origin == PluginOrigin::BuiltIn);
            if (request.resource_only || request.directory_only) && (!enabled || !resource_permission) {
                continue;
            }
            if request.directory_only && (!manifest.permissions.required.iter().chain(&manifest.permissions.optional)
                .any(|p| p.name == "resource.directory.read")
                || !self.state.scenes.get(&request.scene_id).and_then(|s| s.get(&manifest.id))
                    .and_then(|s| s.permissions.get("resource.directory.read")).copied().unwrap_or(false)) {
                continue;
            }
            for cap in caps {
                let capability_profile = cap.get("resourceInputProfile").and_then(Value::as_str)
                    .or(manifest_input_profile);
                let host_receiver = request.resource_only && !request.directory_only
                    && plugin.origin == PluginOrigin::BuiltIn
                    && ((manifest.id == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID
                        && cap.get("id").and_then(Value::as_str) == Some(crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID)
                        && capability_profile == Some(crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE))
                    || (cfg!(target_os = "windows")
                        && manifest.id == crate::plugin_resource_execution::HOST_OCR_PLUGIN_ID
                        && cap.get("id").and_then(Value::as_str) == Some(crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID)
                        && capability_profile == Some(crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE))
                    || (manifest.id == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID
                        && cap.get("id").and_then(Value::as_str) == Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID)
                        && capability_profile == Some(crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE)));
                if capability_profile == Some(crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE)
                    && !request.resource_only {
                    continue;
                }
                if (request.resource_only || request.directory_only) && !(wasi_receiver || host_receiver) {
                    continue;
                }
                if request.selected_file_count.is_some_and(|count|
                    cap.get("resourceInputMax").and_then(Value::as_u64)
                        .is_none_or(|maximum| maximum < count as u64)) {
                    continue;
                }
                let Some(id) = cap.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if request.exclude_plugin_id.as_deref() == Some(manifest.id.as_str())
                    && request.exclude_capability_id.as_deref() == Some(id) {
                    continue;
                }
                let input_mime_types = super::resource_input_types::declared(cap);
                if request.resource_mime_type.as_deref().is_some_and(|mime| {
                    !super::resource_input_types::accepts(cap, mime)
                }) {
                    continue;
                }
                let title = cap.get("title").and_then(Value::as_str).unwrap_or(id);
                let file_match = if let Some(names) = selected_names.as_ref() {
                    let matches: Vec<_> = names.iter().map(|name| file_input::matches(cap, name)).collect();
                    if matches.contains(&Some(false)) { Some(false) }
                    else if matches.iter().all(|matched| *matched == Some(true)) { Some(true) }
                    else { None }
                } else {
                    request.file_name.as_deref().and_then(|name| file_input::matches(cap, name))
                };
                if file_match == Some(false) { continue; }
                let tool_id = serde_json::to_string(&(&manifest.id, id)).expect("string tuple");
                let access_id = tool_access_id(&manifest.id, id);
                if ranks.as_ref().is_some_and(|ranks| !ranks.contains_key(access_id.as_str())) {
                    continue;
                }
                let metadata = cap.get("directory");
                let category = metadata.and_then(|m| m.get("categoryId")).and_then(Value::as_str).unwrap_or("uncategorized");
                *categories.entry(category.to_owned()).or_default() += 1;
                // Facets describe the entire selected list, not the visible page or search hits.
                let source = sources.entry(manifest.id.clone()).or_insert_with(|| json!({
                    "pluginId":manifest.id,
                    "title":manifest.display_name.as_deref().unwrap_or(&manifest.name),
                    "count":0,"enabled":enabled
                }));
                source["count"] = json!(source["count"].as_u64().unwrap_or(0) + 1);
                if request.plugin_id.as_ref().is_some_and(|selected| !selected.is_empty() && selected != &manifest.id) {
                    continue;
                }
                if request.category_id.as_ref().is_some_and(|selected| !selected.is_empty() && selected != category) {
                    continue;
                }
                let aliases = metadata.and_then(|m| m.get("aliases")).and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>()).unwrap_or_default();
                let description = metadata.and_then(|m| m.get("description")).and_then(Value::as_str)
                    .or_else(|| cap.get("description").and_then(Value::as_str)
                        .filter(|text| text.len() <= 512 && !text.chars().any(char::is_control)))
                    .unwrap_or("");
                let Some(rank) = tool_search::relevance(&terms, id, title, &aliases, description, &source_text) else {
                    continue;
                };
                let file_rank = u8::from((request.file_name.is_some() || selected_names.is_some()) && file_match != Some(true));
                entries.push((file_rank, rank, json!({
                    "toolId":tool_id,"accessId":access_id,
                    "fileInputMatch":(request.file_name.is_some() || selected_names.is_some()).then_some(if file_match == Some(true) {"declared"} else {"unknown"}),
                    "pluginId":manifest.id,"capabilityId":id,"title":title,
                    "categoryId":category,"description":description,
                    "resourceInputMimeTypes":input_mime_types,
                    "applicationName":manifest.display_name.as_deref().unwrap_or(&manifest.name),
                    "publisher":manifest.publisher,"version":manifest.version,
                    "enabled":enabled,"status":if enabled {"available_to_request"} else {"plugin_disabled"},
                    "runtime":if plugin.origin == PluginOrigin::BuiltIn {"builtin"}
                        else if manifest.runtime.get("wasi").is_some() {"wasi"} else {"javascript"}
                })));
            }
        }
        entries.sort_by(|(a_file_rank, a_rank, a), (b_file_rank, b_rank, b)| {
            if request.view == CatalogView::Recent {
                let ranks = ranks.as_ref().expect("recent view has ranks");
                ranks[a["accessId"].as_str().unwrap()].cmp(&ranks[b["accessId"].as_str().unwrap()])
            } else {
                a_file_rank.cmp(b_file_rank).then_with(|| a_rank.cmp(b_rank))
                    .then_with(|| a["toolId"].as_str().cmp(&b["toolId"].as_str()))
            }
        });
        let total = entries.len();
        let items: Vec<_> = entries
            .into_iter()
            .skip(request.offset)
            .take(PAGE_SIZE)
            .map(|(_, _, tool)| tool)
            .collect();
        let next = (request.offset.saturating_add(items.len()) < total)
            .then_some(request.offset + items.len());
        Ok(
            json!({"schemaVersion":1,"sceneId":request.scene_id,"revision":revision,
            "items":items,"total":total,"offset":request.offset,"pageSize":PAGE_SIZE,"nextOffset":next,
            "accessRevision":access.map(|state|state.revision),
            "sources":sources.into_values().collect::<Vec<_>>(),
            "categories":categories.into_iter().map(|(id,count)| json!({"id":id,"count":count})).collect::<Vec<_>>()}),
        )
    }

    fn manual_enabled(&self, scene: &str, plugin: &InstalledPlugin) -> bool {
        plugin.core
            || self
                .state
                .scenes
                .get(scene)
                .and_then(|s| s.get(&plugin.manifest.id))
                .and_then(|s| s.enabled)
                .unwrap_or(plugin.enabled_by_default)
    }

    pub(crate) fn manual_tool_detail(&self, request: &DetailQuery) -> Result<Value, &'static str> {
        invalid_scene(&request.scene_id)?;
        if request.resource_mime_type.as_deref().is_some_and(|mime| !super::resource_input_types::valid_mime_type(mime)) {
            return Err("invalid_parameters");
        }
        if request.plugin_id.len() > 256
            || request.capability_id.len() > 256
            || request.revision.len() != 64
        {
            return Err("invalid_parameters");
        }
        let revision = self.manual_revision_for_resource_type(&request.scene_id, request.resource_mime_type.as_deref());
        if revision != request.revision {
            return Err("catalog_changed");
        }
        let plugin = self
            .plugins
            .get(&request.plugin_id)
            .ok_or("tool_unavailable")?;
        let capability = plugin
            .manifest
            .contributes
            .get("capabilities")
            .and_then(Value::as_array)
            .and_then(|caps| {
                caps.iter()
                    .find(|c| c["id"].as_str() == Some(&request.capability_id))
            })
            .ok_or("tool_unavailable")?;
        let permissions: Vec<_> = plugin.manifest.permissions.required.iter()
            .chain(plugin.manifest.permissions.optional.iter()).map(|permission| {
                let granted = self.state.scenes.get(&request.scene_id)
                    .and_then(|s| s.get(&request.plugin_id)).and_then(|s| s.permissions.get(&permission.name))
                    .copied().unwrap_or(plugin.origin == PluginOrigin::BuiltIn);
                json!({"name":permission.name,"reason":permission.reason,"granted":granted,
                    "required":plugin.manifest.permissions.required.iter().any(|p| p.name == permission.name)})
            }).collect();
        let resource_input_profile = capability.get("resourceInputProfile").and_then(Value::as_str)
            .or_else(|| plugin.manifest.runtime.get("resourceInputProfile").and_then(Value::as_str));
        Ok(
            json!({"schemaVersion":1,"sceneId":request.scene_id,"revision":revision,
            "pluginId":request.plugin_id,"version":plugin.manifest.version,
            "resourceInputProfile":resource_input_profile,
            "enabled":self.manual_enabled(&request.scene_id,plugin),
            "capability":capability,"permissions":permissions}),
        )
    }
}

#[cfg(test)]
#[path = "manual_catalog_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "manual_category_tests.rs"]
mod category_tests;
#[cfg(test)]
#[path = "manual_resource_tests.rs"]
mod resource_tests;

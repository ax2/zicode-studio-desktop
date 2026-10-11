//! Read-only manual discovery. Never registers Pi tools, loads a view or starts a Worker.
use super::*;
use sha2::{Digest, Sha256};

pub(crate) const PAGE_SIZE: usize = 40;

pub(crate) fn tool_access_id(plugin_id: &str, capability_id: &str) -> String {
    let bytes = serde_json::to_vec(&(plugin_id, capability_id)).expect("string tuple");
    format!("manual.tool:{:x}", Sha256::digest(bytes))
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
    #[serde(default)]
    pub resource_only: bool,
    pub file_name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DetailQuery {
    pub scene_id: String,
    pub plugin_id: String,
    pub capability_id: String,
    pub revision: String,
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
        let bytes = serde_json::to_vec(&(scene, self.result_epoch(), &self.state, manifests))
            .expect("registry metadata is serializable");
        format!("{:x}", Sha256::digest(bytes))
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
        if request.file_name.as_deref().is_some_and(|name| !request.resource_only || !file_input::valid_name(name)) {
            return Err("invalid_parameters");
        }
        if request.query.len() > 512 || request.offset > 1_000_000
            || request.plugin_id.as_ref().is_some_and(|id| id.len() > 256)
            || request.category_id.as_ref().is_some_and(|id| id.len() > 64) {
            return Err("invalid_parameters");
        }
        let revision = self.manual_revision(&request.scene_id);
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
            let Some(caps) = manifest
                .contributes
                .get("capabilities")
                .and_then(Value::as_array)
            else {
                continue;
            };
            let enabled = self.manual_enabled(&request.scene_id, plugin);
            // Metadata-only eligibility; the transfer Host rechecks authority and module bytes.
            if request.resource_only && (!enabled
                || manifest.runtime.get("wasi").and_then(Value::as_str).is_none()
                || manifest.runtime.get("resourceInputProfile").and_then(Value::as_str) != Some("resource.wasi.input.draft2")
                || !manifest.permissions.required.iter().chain(&manifest.permissions.optional).any(|p| p.name == "resource.read")
                || !self.state.scenes.get(&request.scene_id).and_then(|s| s.get(&manifest.id))
                    .and_then(|s| s.permissions.get("resource.read")).copied().unwrap_or(plugin.origin == PluginOrigin::BuiltIn)) {
                continue;
            }
            for cap in caps {
                let Some(id) = cap.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let title = cap.get("title").and_then(Value::as_str).unwrap_or(id);
                let file_match = request.file_name.as_deref().and_then(|name| file_input::matches(cap, name));
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
                let text = format!(
                    "{} {} {} {} {} {}",
                    manifest.id,
                    manifest.name,
                    manifest.display_name.as_deref().unwrap_or(""),
                    manifest.description,
                    manifest.publisher,
                    format_args!("{id} {title}")
                )
                ;
                let aliases = metadata.and_then(|m| m.get("aliases")).and_then(Value::as_array)
                    .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ")).unwrap_or_default();
                let description = metadata.and_then(|m| m.get("description")).and_then(Value::as_str).unwrap_or("");
                let text = directory_metadata::normalize(&format!("{text} {aliases} {description}"));
                if !terms.iter().all(|term| text.contains(term)) {
                    continue;
                }
                entries.push(json!({
                    "toolId":tool_id,"accessId":access_id,
                    "fileInputMatch":request.file_name.as_ref().map(|_| if file_match == Some(true) {"declared"} else {"unknown"}),
                    "pluginId":manifest.id,"capabilityId":id,"title":title,
                    "categoryId":category,"description":description,
                    "applicationName":manifest.display_name.as_deref().unwrap_or(&manifest.name),
                    "publisher":manifest.publisher,"version":manifest.version,
                    "enabled":enabled,"status":if enabled {"available_to_request"} else {"plugin_disabled"},
                    "runtime":if plugin.origin == PluginOrigin::BuiltIn {"builtin"}
                        else if manifest.runtime.get("wasi").is_some() {"wasi"} else {"javascript"}
                }));
            }
        }
        entries.sort_by(|a, b| {
            if request.view == CatalogView::Recent {
                let ranks = ranks.as_ref().expect("recent view has ranks");
                ranks[a["accessId"].as_str().unwrap()].cmp(&ranks[b["accessId"].as_str().unwrap()])
            } else {
                a["toolId"].as_str().cmp(&b["toolId"].as_str())
            }
        });
        let total = entries.len();
        let items: Vec<_> = entries
            .into_iter()
            .skip(request.offset)
            .take(PAGE_SIZE)
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
        if request.plugin_id.len() > 256
            || request.capability_id.len() > 256
            || request.revision.len() != 64
        {
            return Err("invalid_parameters");
        }
        let revision = self.manual_revision(&request.scene_id);
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
        Ok(
            json!({"schemaVersion":1,"sceneId":request.scene_id,"revision":revision,
            "pluginId":request.plugin_id,"version":plugin.manifest.version,
            "resourceInputProfile":plugin.manifest.runtime.get("resourceInputProfile").and_then(Value::as_str),
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

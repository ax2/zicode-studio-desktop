//! Bounded desktop result receiver search; schemas stay inside the Host.
use super::*;
use crate::plugin_registry::manual_catalog::{tool_access_id, CatalogView};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Search {
    scope: Scope,
    result_id: String,
    #[serde(default)]
    query: String,
    #[serde(default)]
    offset: usize,
    revision: Option<String>,
    #[serde(default)]
    view: CatalogView,
    access_revision: Option<u64>,
}

pub(in crate::host_server) async fn search(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Search>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.query.len() > 256 || request.offset > 1_000_000 {
        return Err(rejected("result_target_query_invalid"));
    }
    // Read preference metadata before taking registry/result locks. Never start a Worker.
    let access = if request.view == CatalogView::All {
        None
    } else {
        state.data.workspace_root_path(&request.scope.workspace_id)
            .map_err(|_| rejected("result_workspace_invalid"))?;
        let metadata = state.tool_access.clone();
        let scene = request.scope.scene_id.clone();
        let workspace = request.scope.workspace_id.clone();
        Some(tokio::task::spawn_blocking(move || {
            metadata.lock().map_err(|_| ())?.read_tool_access(&scene, &workspace).map_err(|_| ())
        }).await.map_err(|_| rejected("result_target_access_unavailable"))?
            .map_err(|_| rejected("result_target_access_unavailable"))?)
    };
    let access_revision = access.as_ref().map(|access| access.revision);
    if request.access_revision.is_some_and(|value| Some(value) != access_revision)
        || (request.offset != 0 && access.is_some() && request.access_revision.is_none()) {
        return Err(rejected("result_target_revision_changed"));
    }
    let selected = access.as_ref().map(|access| match request.view {
        CatalogView::Favorites => access.favorites.clone(),
        _ => access.recent.iter().map(|entry| entry.id.clone()).collect(),
    });
    let ranks: Option<HashMap<&str, usize>> = selected.as_ref().map(|ids| {
        ids.iter().enumerate().map(|(rank, id)| (id.as_str(), rank)).collect()
    });
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let source = proof(&registry, &request.scope)?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    let record = store.record(&request.scope, &request.result_id)?;
    if source.0 != record.proof {
        return Err(rejected("result_source_changed"));
    }
    let view = match request.view { CatalogView::All => "all", CatalogView::Favorites => "favorites", CatalogView::Recent => "recent" };
    let revision = sha256_hex(&serde_json::to_vec(&(
        &source.0, registry.manual_revision(&request.scope.scene_id),
        &request.scope.workspace_id, &request.query, view, access_revision,
    )).expect("receiver search metadata is serializable"));
    if request
        .revision
        .as_ref()
        .is_some_and(|value| value != &revision)
        || (request.offset != 0 && request.revision.is_none()) {
        return Err(rejected("result_target_revision_changed"));
    }
    let plugins = registry.list(&request.scope.scene_id);
    let terms: Vec<_> = request
        .query
        .split_whitespace()
        .map(str::to_lowercase)
        .collect();
    let mut matches = Vec::new();
    for capability in registry.capabilities(&request.scope.scene_id) {
        let access_id = tool_access_id(&capability.plugin_id, &capability.id);
        if ranks.as_ref().is_some_and(|ranks| !ranks.contains_key(access_id.as_str())) {
            continue;
        }
        let Some(plugin) = plugins.iter().find(|plugin| {
            plugin.manifest.id == capability.plugin_id
                && plugin.enabled
                && plugin.manifest.runtime["wasi"].is_string()
        }) else {
            continue;
        };
        let Some(properties) = capability.input_schema["properties"].as_object() else {
            continue;
        };
        for field in properties.keys() {
            let Ok(inputs) = required_inputs(&capability.input_schema, field, &record.text) else {
                continue;
            };
            if inputs.is_empty() && mapped_input(&capability.input_schema, field, &record.text, &serde_json::Map::new()).is_err() {
                continue;
            }
            let searchable = format!(
                "{} {} {} {}",
                plugin.manifest.name, capability.plugin_id, capability.title, field
            )
            .to_lowercase();
            if !terms.iter().all(|term| searchable.contains(term)) {
                continue;
            }
            matches.push(json!({"accessId":access_id,"pluginId":capability.plugin_id,"capabilityId":capability.id,"title":capability.title,"field":field,"packageVersion":plugin.manifest.version,"requiredInputs":inputs}));
        }
    }
    matches.sort_by_key(|item| {
        (
            ranks.as_ref().map(|ranks| ranks[item["accessId"].as_str().unwrap()]).unwrap_or(0),
            item["pluginId"].as_str().unwrap_or("").to_string(),
            item["capabilityId"].as_str().unwrap_or("").to_string(),
            item["field"].as_str().unwrap_or("").to_string(),
        )
    });
    let total = matches.len();
    if request.offset > total {
        return Err(rejected("result_target_query_invalid"));
    }
    let items: Vec<_> = matches.into_iter().skip(request.offset).take(20).collect();
    let next = request.offset + items.len();
    let response = json!({"schemaVersion":1,"revision":revision,"accessRevision":access_revision,"total":total,"items":items,"nextOffset":(next < total).then_some(next)});
    if serde_json::to_vec(&response)
        .map(|bytes| bytes.len() > 32 * 1024)
        .unwrap_or(true)
    {
        return Err(rejected("result_target_response_too_large"));
    }
    Ok(Json(response))
}

//! Bounded desktop result receiver search; schemas stay inside the Host.
use super::*;

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
    let revision = sha256_hex(source.0.as_bytes());
    if request
        .revision
        .as_ref()
        .is_some_and(|value| value != &revision)
    {
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
            matches.push(json!({"pluginId":capability.plugin_id,"capabilityId":capability.id,"title":capability.title,"field":field,"packageVersion":plugin.manifest.version,"requiredInputs":inputs}));
        }
    }
    matches.sort_by_key(|item| {
        (
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
    let response = json!({"schemaVersion":1,"revision":revision,"total":total,"items":items,"nextOffset":(next < total).then_some(next)});
    if serde_json::to_vec(&response)
        .map(|bytes| bytes.len() > 32 * 1024)
        .unwrap_or(true)
    {
        return Err(rejected("result_target_response_too_large"));
    }
    Ok(Json(response))
}

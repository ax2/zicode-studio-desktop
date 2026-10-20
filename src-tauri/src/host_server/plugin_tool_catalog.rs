use super::*;
use crate::plugin_registry::tool_search;
use crate::plugin_registry::{
    PluginCapabilityDescriptor, PluginDescriptor, PluginPiToolDescriptor,
};
use hmac::{Hmac, Mac};
use std::collections::{BTreeMap, BTreeSet};

type ApiError = (StatusCode, Json<Value>);
const PAGE_SIZE: usize = 20;
const MAX_SEARCH_BYTES: usize = 32 * 1024;
const MAX_LOAD_BYTES: usize = 256 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CatalogSearch {
    schema_version: u32,
    runtime_id: String,
    session_id: String,
    #[serde(default)]
    query: String,
    cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct CatalogLoad {
    schema_version: u32,
    runtime_id: String,
    session_id: String,
    revision: String,
    tool_id: String,
}

fn rejected(code: &'static str) -> ApiError {
    plugin_api_error(
        StatusCode::BAD_REQUEST,
        code,
        "Refresh the plugin tool catalog and retry",
    )
}

fn tool_id(tool: &PluginPiToolDescriptor) -> String {
    serde_json::to_string(&(&tool.plugin_id, &tool.capability))
        .expect("string tuple is serializable")
}

#[derive(serde::Serialize)]
struct SearchMetadata {
    aliases: Vec<String>,
    description: String,
    source: String,
}

type SearchIndex = BTreeMap<String, BTreeMap<String, SearchMetadata>>;

fn search_index(plugins: &[PluginDescriptor], tools: &[PluginPiToolDescriptor]) -> SearchIndex {
    let identities: BTreeSet<_> = tools
        .iter()
        .map(|tool| (tool.plugin_id.as_str(), tool.capability.as_str()))
        .collect();
    let mut index = SearchIndex::new();
    for plugin in plugins {
        let manifest = &plugin.manifest;
        let source = format!(
            "{} {} {} {} {}",
            manifest.id,
            manifest.name,
            manifest.display_name.as_deref().unwrap_or(""),
            manifest.description,
            manifest.publisher
        );
        let Some(capabilities) = manifest
            .contributes
            .get("capabilities")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for capability in capabilities {
            let Some(id) = capability.get("id").and_then(Value::as_str) else {
                continue;
            };
            if !identities.contains(&(manifest.id.as_str(), id)) {
                continue;
            }
            let directory = capability.get("directory");
            let mut aliases = vec![capability
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_owned()];
            if let Some(extra) = directory
                .and_then(|value| value.get("aliases"))
                .and_then(Value::as_array)
            {
                aliases.extend(extra.iter().filter_map(Value::as_str).map(str::to_owned));
            }
            let description = format!(
                "{} {}",
                capability
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or(""),
                directory
                    .and_then(|value| value.get("description"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
            );
            index.entry(manifest.id.clone()).or_default().insert(
                id.to_owned(),
                SearchMetadata {
                    aliases,
                    description,
                    source: source.clone(),
                },
            );
        }
    }
    index
}

fn ranked_matches<'a>(
    tools: &'a [PluginPiToolDescriptor],
    index: &SearchIndex,
    query: &str,
) -> Vec<&'a PluginPiToolDescriptor> {
    let terms: Vec<_> = query.split_whitespace().map(str::to_owned).collect();
    if terms.is_empty() {
        return tools.iter().collect();
    }
    let mut matches: Vec<_> = tools
        .iter()
        .filter_map(|tool| {
            let metadata = index
                .get(&tool.plugin_id)
                .and_then(|items| items.get(&tool.capability));
            let aliases = metadata
                .map(|value| value.aliases.iter().map(String::as_str).collect::<Vec<_>>())
                .unwrap_or_default();
            let description = metadata.map_or_else(
                || tool.description.clone(),
                |value| format!("{} {}", tool.description, value.description),
            );
            let source = metadata.map_or(tool.plugin_id.as_str(), |value| value.source.as_str());
            tool_search::relevance(
                &terms,
                &tool.capability,
                &tool.title,
                &aliases,
                &description,
                source,
            )
            .map(|rank| (rank, tool))
        })
        .collect();
    // Stable sort preserves the catalog's tool ID order for equal relevance.
    matches.sort_by_key(|(rank, _)| *rank);
    matches.into_iter().map(|(_, tool)| tool).collect()
}

struct CatalogInputs {
    tools: Vec<PluginPiToolDescriptor>,
    plugins: Vec<PluginDescriptor>,
    capabilities: Vec<PluginCapabilityDescriptor>,
}

fn catalog_inputs(registry: &PluginRegistry, scene: &str) -> CatalogInputs {
    CatalogInputs {
        tools: registry.pi_tools(scene),
        plugins: registry.list(scene),
        capabilities: registry.capabilities(scene),
    }
}

fn catalog_from_inputs(
    CatalogInputs {
        mut tools,
        plugins,
        capabilities,
    }: CatalogInputs,
) -> (Vec<PluginPiToolDescriptor>, Value, String, SearchIndex) {
    tools.sort_by_cached_key(|tool| (tool_id(tool), tool.name.clone()));
    tools.dedup_by_key(|tool| tool_id(tool));
    let plugin_ids: BTreeSet<_> = tools.iter().map(|tool| tool.plugin_id.as_str()).collect();
    let versions: std::collections::BTreeMap<_, _> = plugins
        .iter()
        .filter(|plugin| plugin_ids.contains(plugin.manifest.id.as_str()))
        .map(|plugin| (plugin.manifest.id.clone(), plugin.manifest.version.clone()))
        .collect();
    let versions = json!(versions);
    let search = search_index(&plugins, &tools);
    // A same-version development reinstall can change capability contracts without
    // changing Pi's input metadata. Bind every registered tool to its current contract.
    let identities: std::collections::BTreeSet<_> = tools
        .iter()
        .map(|tool| (tool.plugin_id.as_str(), tool.capability.as_str()))
        .collect();
    let mut contracts: Vec<_> = capabilities
        .into_iter()
        .filter(|capability| {
            identities.contains(&(capability.plugin_id.as_str(), capability.id.as_str()))
        })
        .collect();
    contracts.sort_by(|a, b| (&a.plugin_id, &a.id).cmp(&(&b.plugin_id, &b.id)));
    let revision = sha256_hex(
        &serde_json::to_vec(&(&tools, &versions, &contracts, &search))
            .expect("catalog is serializable"),
    );
    (tools, versions, revision, search)
}

fn catalog(
    registry: &PluginRegistry,
    scene: &str,
) -> (Vec<PluginPiToolDescriptor>, Value, String, SearchIndex) {
    catalog_from_inputs(catalog_inputs(registry, scene))
}

fn cursor_mac(
    secret: &str,
    binding: &str,
    revision: &str,
    query: &str,
    offset: usize,
) -> Hmac<Sha256> {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(
        &serde_json::to_vec(&(binding, revision, query, offset))
            .expect("cursor tuple is serializable"),
    );
    mac
}

fn encode_cursor(
    secret: &str,
    binding: &str,
    revision: &str,
    query: &str,
    offset: usize,
) -> String {
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(
        cursor_mac(secret, binding, revision, query, offset)
            .finalize()
            .into_bytes(),
    );
    base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&(offset, signature)).expect("cursor is serializable"))
}

fn decode_cursor(
    value: &str,
    secret: &str,
    binding: &str,
    revision: &str,
    query: &str,
) -> Result<usize, ApiError> {
    if value.len() > 1024 {
        return Err(rejected("catalog_cursor_invalid"));
    }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| rejected("catalog_cursor_invalid"))?;
    let (offset, signature): (usize, String) =
        serde_json::from_slice(&bytes).map_err(|_| rejected("catalog_cursor_invalid"))?;
    let signature = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(signature)
        .map_err(|_| rejected("catalog_cursor_invalid"))?;
    cursor_mac(secret, binding, revision, query, offset)
        .verify_slice(&signature)
        .map_err(|_| rejected("catalog_cursor_invalid"))?;
    Ok(offset)
}

fn bounded(payload: Value, limit: usize) -> Result<Json<Value>, ApiError> {
    if serde_json::to_vec(&payload)
        .map_err(|_| rejected("catalog_encoding_failed"))?
        .len()
        > limit
    {
        return Err(plugin_api_error(
            StatusCode::PAYLOAD_TOO_LARGE,
            "catalog_response_too_large",
            "Tool metadata exceeds the catalog response limit",
        ));
    }
    Ok(Json(payload))
}

fn search_snapshot(
    inputs: CatalogInputs,
    query: String,
    cursor: Option<String>,
    secret: String,
    binding: String,
) -> Result<Json<Value>, ApiError> {
    let (tools, versions, revision, index) = catalog_from_inputs(inputs);
    let offset = cursor
        .as_deref()
        .map(|cursor| decode_cursor(cursor, &secret, &binding, &revision, &query))
        .transpose()?
        .unwrap_or(0);
    let matches = ranked_matches(&tools, &index, &query);
    if offset > matches.len() {
        return Err(rejected("catalog_cursor_invalid"));
    }
    let items: Vec<_> = matches
        .iter()
        .skip(offset)
        .take(PAGE_SIZE)
        .map(|tool| {
            json!({
                "toolId": tool_id(tool), "pluginId": tool.plugin_id, "capability": tool.capability,
                "name": tool.name, "title": tool.title, "description": tool.description,
                "packageVersion": versions[&tool.plugin_id], "toolVersion": null
            })
        })
        .collect();
    let next = offset + items.len();
    let cursor = (next < matches.len())
        .then(|| encode_cursor(&secret, &binding, &revision, &query, next));
    bounded(
        json!({"schemaVersion":1,"revision":revision,"items":items,"nextCursor":cursor,"total":matches.len()}),
        MAX_SEARCH_BYTES,
    )
}

pub(super) async fn search(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CatalogSearch>,
) -> Result<Json<Value>, ApiError> {
    if request.schema_version != 1 || request.query.len() > 256 {
        return Err(rejected("catalog_request_invalid"));
    }
    let record = super::plugin_tool_auth::authorize(
        &state,
        &headers,
        &request.runtime_id,
        &request.session_id,
    )?;
    // Keep the slot in the worker even if the HTTP waiter disconnects.
    let permit = state
        .plugin_catalog_search_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            plugin_api_error(
                StatusCode::TOO_MANY_REQUESTS,
                "catalog_busy",
                "Tool catalog searches are busy",
            )
        })?;
    let inputs = {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected("registry_unavailable"))?;
        catalog_inputs(&registry, &record.target.scene_id)
    };
    let binding = serde_json::to_string(&(&record.target, &record.token_hash))
        .expect("runtime is serializable");
    let query = tool_search::normalize_query(&request.query);
    let cursor = request.cursor.clone();
    let secret = state.desktop_token.clone();
    let result = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        search_snapshot(inputs, query, cursor, secret, binding)
    })
    .await
    .map_err(|_| {
        plugin_api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "catalog_search_unavailable",
            "Tool catalog search is unavailable",
        )
    })??;
    let current = super::plugin_tool_auth::authorize(
        &state,
        &headers,
        &request.runtime_id,
        &request.session_id,
    )?;
    if current.target != record.target || current.token_hash != record.token_hash {
        return Err(plugin_api_error(
            StatusCode::CONFLICT,
            "catalog_revision_changed",
            "Search the catalog again after the runtime changes",
        ));
    }
    Ok(result)
}

pub(super) async fn load(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CatalogLoad>,
) -> Result<Json<Value>, ApiError> {
    if request.schema_version != 1 || request.revision.len() != 64 || request.tool_id.len() > 1024 {
        return Err(rejected("catalog_request_invalid"));
    }
    let record = super::plugin_tool_auth::authorize(
        &state,
        &headers,
        &request.runtime_id,
        &request.session_id,
    )?;
    let changed = || {
        plugin_api_error(
            StatusCode::CONFLICT,
            "catalog_revision_changed",
            "Search the catalog again before loading a tool",
        )
    };
    let integrity_error = || {
        plugin_api_error(
            StatusCode::CONFLICT,
            "plugin_integrity_invalid",
            "Repair the original signed plugin package before loading tools",
        )
    };
    let (tool, package_version, snapshot) = {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected("registry_unavailable"))?;
        let (tools, versions, revision, _) = catalog(&registry, &record.target.scene_id);
        if revision != request.revision {
            return Err(changed());
        }
        let tool = tools
            .into_iter()
            .find(|tool| tool_id(tool) == request.tool_id)
            .ok_or_else(|| rejected("tool_unavailable"))?;
        let snapshot = registry
            .signed_integrity_snapshot(&tool.plugin_id)
            .map_err(|_| integrity_error())?;
        let package_version = versions[&tool.plugin_id].clone();
        (tool, package_version, snapshot)
    };
    if let Some(proof) = snapshot.clone() {
        tokio::task::spawn_blocking(move || proof.verify())
            .await
            .map_err(|_| integrity_error())?
            .map_err(|_| integrity_error())?;
    }
    let current_record = super::plugin_tool_auth::authorize(
        &state,
        &headers,
        &request.runtime_id,
        &request.session_id,
    )?;
    if current_record.target != record.target || current_record.token_hash != record.token_hash {
        return Err(changed());
    }
    // A package can be replaced while its files are being checked. Never return
    // details from the old catalog after that replacement.
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let (tools, _, revision, _) = catalog(&registry, &record.target.scene_id);
    if revision != request.revision
        || !tools
            .iter()
            .any(|current| tool_id(current) == request.tool_id)
    {
        return Err(changed());
    }
    if registry
        .signed_integrity_snapshot(&tool.plugin_id)
        .map_err(|_| integrity_error())?
        != snapshot
    {
        return Err(changed());
    }
    bounded(
        json!({"schemaVersion":1,"revision":revision,"toolId":request.tool_id,"tool":tool,
        "packageVersion":package_version,"toolVersion":null}),
        MAX_LOAD_BYTES,
    )
}

#[cfg(test)]
mod tests;

pub(super) fn validate_invocation(
    registry: &PluginRegistry,
    scene: &str,
    name: &str,
    id: Option<&str>,
    expected_revision: Option<&str>,
) -> Result<(), ApiError> {
    let (id, expected_revision) = match (id, expected_revision) {
        (None, None) => return Ok(()),
        (Some(id), Some(revision)) if id.len() <= 1024 && revision.len() == 64 => (id, revision),
        _ => return Err(rejected("catalog_request_invalid")),
    };
    let (tools, _, revision, _) = catalog(registry, scene);
    if revision != expected_revision {
        return Err(plugin_api_error(
            StatusCode::CONFLICT,
            "catalog_revision_changed",
            "Search and load this tool again before invoking it",
        ));
    }
    if !tools
        .iter()
        .any(|tool| tool.name == name && tool_id(tool) == id)
    {
        return Err(rejected("tool_unavailable"));
    }
    Ok(())
}

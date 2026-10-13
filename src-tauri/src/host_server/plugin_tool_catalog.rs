use super::*;
use crate::plugin_registry::PluginPiToolDescriptor;
use crate::plugin_registry::tool_search;
use hmac::{Hmac, Mac};

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

fn ranked_matches<'a>(
    tools: &'a [PluginPiToolDescriptor],
    query: &str,
) -> Vec<&'a PluginPiToolDescriptor> {
    let terms: Vec<_> = query.split_whitespace().map(str::to_owned).collect();
    let mut matches: Vec<_> = tools
        .iter()
        .filter_map(|tool| {
            tool_search::relevance(
                &terms,
                &tool.capability,
                &tool.title,
                &[],
                &tool.description,
                &tool.plugin_id,
            )
            .map(|rank| (rank, tool))
        })
        .collect();
    // Stable sort preserves the catalog's tool ID order for equal relevance.
    matches.sort_by_key(|(rank, _)| *rank);
    matches.into_iter().map(|(_, tool)| tool).collect()
}

fn catalog(registry: &PluginRegistry, scene: &str) -> (Vec<PluginPiToolDescriptor>, Value, String) {
    let mut tools = registry.pi_tools(scene);
    tools.sort_by_key(|tool| (tool_id(tool), tool.name.clone()));
    tools.dedup_by_key(|tool| tool_id(tool));
    let versions: std::collections::BTreeMap<_, _> = registry
        .list(scene)
        .into_iter()
        .filter(|plugin| {
            tools
                .iter()
                .any(|tool| tool.plugin_id == plugin.manifest.id)
        })
        .map(|plugin| (plugin.manifest.id, plugin.manifest.version))
        .collect();
    let versions = json!(versions);
    // A same-version development reinstall can change capability contracts without
    // changing Pi's input metadata. Bind every registered tool to its current contract.
    let identities: std::collections::BTreeSet<_> = tools
        .iter()
        .map(|tool| (tool.plugin_id.as_str(), tool.capability.as_str()))
        .collect();
    let mut contracts: Vec<_> = registry
        .capabilities(scene)
        .into_iter()
        .filter(|capability| {
            identities.contains(&(capability.plugin_id.as_str(), capability.id.as_str()))
        })
        .collect();
    contracts.sort_by(|a, b| (&a.plugin_id, &a.id).cmp(&(&b.plugin_id, &b.id)));
    let revision = sha256_hex(
        &serde_json::to_vec(&(&tools, &versions, &contracts)).expect("catalog is serializable"),
    );
    (tools, versions, revision)
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
    let query = tool_search::normalize_query(&request.query);
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let (tools, versions, revision) = catalog(&registry, &record.target.scene_id);
    let binding = serde_json::to_string(&(&record.target, &record.token_hash))
        .expect("runtime is serializable");
    let offset = request
        .cursor
        .as_deref()
        .map(|cursor| decode_cursor(cursor, &state.desktop_token, &binding, &revision, &query))
        .transpose()?
        .unwrap_or(0);
    let matches = ranked_matches(&tools, &query);
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
        .then(|| encode_cursor(&state.desktop_token, &binding, &revision, &query, next));
    bounded(
        json!({"schemaVersion":1,"revision":revision,"items":items,"nextCursor":cursor,"total":matches.len()}),
        MAX_SEARCH_BYTES,
    )
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
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let (tools, versions, revision) = catalog(&registry, &record.target.scene_id);
    if revision != request.revision {
        return Err(plugin_api_error(
            StatusCode::CONFLICT,
            "catalog_revision_changed",
            "Search the catalog again before loading a tool",
        ));
    }
    let tool = tools
        .iter()
        .find(|tool| tool_id(tool) == request.tool_id)
        .ok_or_else(|| rejected("tool_unavailable"))?;
    registry
        .verify_current_integrity(&tool.plugin_id)
        .map_err(|_| {
            plugin_api_error(
                StatusCode::CONFLICT,
                "plugin_integrity_invalid",
                "Repair the original signed plugin package before loading tools",
            )
        })?;
    bounded(
        json!({"schemaVersion":1,"revision":revision,"toolId":request.tool_id,"tool":tool,
        "packageVersion":versions[&tool.plugin_id],"toolVersion":null}),
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
    let (tools, _, revision) = catalog(registry, scene);
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

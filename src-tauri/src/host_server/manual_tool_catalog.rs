use super::*;
use crate::plugin_registry::manual_catalog::{CatalogQuery, CatalogView, DetailQuery};

type ApiError = (StatusCode, Json<Value>);

fn error(code: &'static str) -> ApiError {
    let status = match code {
        "catalog_changed" => StatusCode::CONFLICT,
        "tool_unavailable" => StatusCode::NOT_FOUND,
        "tool_access_unavailable" => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::BAD_REQUEST,
    };
    plugin_api_error(status, code, "Refresh the tool directory and retry")
}

fn authorize(headers: &HeaderMap, state: &HostState) -> Result<(), ApiError> {
    if !desktop_http_token_authorized(headers, &state.desktop_token) {
        return Err(plugin_api_error(StatusCode::FORBIDDEN, "desktop_only", ""));
    }
    Ok(())
}

pub(super) async fn search(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Query(query): Query<CatalogQuery>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let access = if query.view == CatalogView::All {
        None
    } else {
        let workspace = query
            .workspace_id
            .as_deref()
            .ok_or_else(|| error("invalid_parameters"))?;
        state
            .data
            .workspace_root_path(workspace)
            .map_err(|_| error("invalid_parameters"))?;
        let metadata = state.tool_access.clone();
        let scene = query.scene_id.clone();
        let workspace = workspace.to_owned();
        Some(
            tokio::task::spawn_blocking(move || {
                metadata
                    .lock()
                    .map_err(|_| ())?
                    .read_tool_access(&scene, &workspace)
                    .map_err(|_| ())
            })
            .await
            .map_err(|_| error("tool_access_unavailable"))?
            .map_err(|_| error("tool_access_unavailable"))?,
        )
    };
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    registry
        .manual_catalog_with_access(&query, access.as_ref())
        .map(Json)
        .map_err(error)
}

pub(super) async fn detail(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Query(query): Query<DetailQuery>,
) -> Result<Json<Value>, ApiError> {
    authorize(&headers, &state)?;
    let registry = state.plugins.lock().map_err(|_| {
        plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
    })?;
    registry.manual_tool_detail(&query).map(Json).map_err(error)
}

#[cfg(test)]
#[path = "manual_tool_catalog_tests.rs"]
mod tests;

use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Control {
    schema_version: u32,
    scope: Scope,
    call_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct Reconcile {
    schema_version: u32,
    scope: Scope,
    call_id: String,
    host_instance_id: String,
}
fn desktop(state: &HostState, headers: &HeaderMap) -> Result<(), ApiError> {
    if !desktop_http_token_authorized(headers, &state.desktop_token) {
        return Err(plugin_api_error(StatusCode::FORBIDDEN, "desktop_only", ""));
    }
    Ok(())
}
pub(in crate::host_server) async fn protocol(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    Ok(Json(
        json!({"schemaVersion":1,"profile":"manual.tool.call.v1","prepareRequired":true,
        "capacity":CAPACITY,"activeLimit":ACTIVE_LIMIT,"retentionSeconds":RETENTION.as_secs(),
        "runtimes":["worker","wasi"],"cancellationAcknowledgementIsTerminal":false,
        "reconcileProfile":"manual.tool.reconcile.v1"}),
    ))
}
pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<CapabilityInvokeRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.call_id.is_some() {
        return Err(rejected("manual_call_invalid"));
    }
    state
        .data
        .workspace_root_path(&request.workspace_id)
        .map_err(|_| rejected("manual_call_scope_invalid"))?;
    tokio::task::spawn_blocking(move || {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected("registry_unavailable"))?;
        let revision = request
            .catalog_revision
            .as_ref()
            .ok_or_else(|| rejected("manual_call_revision_required"))?;
        let detail = registry
            .manual_tool_detail(&crate::plugin_registry::manual_catalog::DetailQuery {
                scene_id: request.scene_id.clone(),
                plugin_id: request.plugin_id.clone(),
                capability_id: request.capability_id.clone(),
                revision: revision.clone(),
                resource_mime_type: None,
            })
            .map_err(rejected)?;
        if detail["enabled"] != true {
            return Err(rejected("plugin_disabled"));
        }
        let supported = registry.has_external_runtime(&request.plugin_id);
        if !supported {
            return Err(rejected("manual_call_runtime_unsupported"));
        }
        crate::plugin_capabilities::validate_value(
            &detail["capability"]["inputSchema"],
            &request.input,
            "$",
        )
        .map_err(capability_api_error)?;
        let call_id = state.manual_tool_calls.prepare(&request)?;
        Ok(Json(
            json!({"schemaVersion":1,"profile":"manual.tool.call.v1","callId":call_id,
            "hostInstanceId":state.manual_tool_calls.1.as_str(),
            "status":"prepared","executionFinished":false}),
        ))
    })
    .await
    .map_err(|_| rejected("manual_call_prepare_failed"))?
}
async fn control(
    state: Arc<HostState>,
    headers: HeaderMap,
    request: Control,
    cancel: bool,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1 || uuid::Uuid::parse_str(&request.call_id).is_err() {
        return Err(rejected("manual_call_invalid"));
    }
    // Do not require current plugin permissions: revocation must not prevent stopping an existing call.
    state
        .manual_tool_calls
        .inspect(&request.scope, &request.call_id, cancel)
        .map(Json)
}
pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Control>,
) -> Result<Json<Value>, ApiError> {
    control(state, headers, request, true).await
}
pub(in crate::host_server) async fn status(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Control>,
) -> Result<Json<Value>, ApiError> {
    control(state, headers, request, false).await
}

pub(in crate::host_server) async fn reconcile(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Reconcile>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if request.schema_version != 1
        || uuid::Uuid::parse_str(&request.call_id).is_err()
        || uuid::Uuid::parse_str(&request.host_instance_id).is_err()
    {
        return Err(rejected("manual_call_invalid"));
    }
    state
        .manual_tool_calls
        .reconcile(&request.scope, &request.call_id, &request.host_instance_id)
        .map(Json)
}

//! Explicit desktop confirmation for version-bound, local WASI text mapping.
use super::*;
#[cfg(test)]
pub(in crate::host_server) mod fixture;
pub(in crate::host_server) mod targets;
mod mapping;
use mapping::{mapped_input, required_inputs};

const MAX_GRANTS: usize = 32;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Target {
    plugin_id: String,
    capability_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct PrepareTransfer {
    scope: Scope,
    result_id: String,
    target: Target,
    field: String,
    #[serde(default)]
    inputs: serde_json::Map<String, Value>,
}

struct Grant {
    scope: Scope,
    result_id: String,
    source_proof: String,
    target_scope: Scope,
    target_proof: String,
    field: String,
    inputs: serde_json::Map<String, Value>,
    expires: Instant,
    response: Option<Value>,
}

#[derive(Default)]
pub(super) struct Transfers {
    grants: HashMap<String, Grant>,
}

impl Transfers {
    fn prune(&mut self) {
        self.grants
            .retain(|_, grant| grant.expires > Instant::now());
    }
}

fn input(
    registry: &PluginRegistry,
    target: &Scope,
    field: &str,
    text: &str,
    values: &serde_json::Map<String, Value>,
) -> Result<Value, ApiError> {
    let capability = registry
        .capability(&target.scene_id, &target.plugin_id, &target.capability_id)
        .ok_or_else(|| rejected("result_target_unavailable"))?;
    let schema = &capability.input_schema;
    let mapped = mapped_input(schema, field, text, values)?;
    mapping::request_budget(target, &mapped)?;
    Ok(mapped)
}

pub(in crate::host_server) async fn prepare(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<PrepareTransfer>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let source = proof(&registry, &request.scope)?;
    let target_scope = Scope {
        workspace_id: request.scope.workspace_id.clone(),
        scene_id: request.scope.scene_id.clone(),
        plugin_id: request.target.plugin_id,
        capability_id: request.target.capability_id,
    };
    let target = proof(&registry, &target_scope)?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    let record = store.record(&request.scope, &request.result_id)?;
    if source.0 != record.proof {
        return Err(rejected("result_source_changed"));
    }
    input(&registry, &target_scope, &request.field, &record.text, &request.inputs)?;
    store.transfers.prune();
    if store.transfers.grants.len() >= MAX_GRANTS {
        return Err(rejected("result_transfer_budget_exceeded"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let preview = json!({"schemaVersion":1,"grantId":id,"expiresInSeconds":120,
        "preview":{"operation":"invoke_local_wasi","text":record.text,"field":request.field,"inputs":request.inputs,
        "workspaceId":request.scope.workspace_id,"sceneId":request.scope.scene_id,"byteLength":record.text.len(),
        "source":{"pluginId":request.scope.plugin_id,"capabilityId":request.scope.capability_id,"packageVersion":source.1},
        "target":{"pluginId":target_scope.plugin_id,"capabilityId":target_scope.capability_id,"packageVersion":target.1}}});
    store.transfers.grants.insert(
        id,
        Grant {
            scope: request.scope,
            result_id: record.id,
            source_proof: source.0,
            target_scope,
            target_proof: target.0,
            field: request.field,
            inputs: request.inputs,
            expires: Instant::now() + Duration::from_secs(120),
            response: None,
        },
    );
    Ok(Json(preview))
}

pub(in crate::host_server) async fn commit(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<Commit>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    if !request.confirmed {
        return Err(rejected("result_confirmation_required"));
    }
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let mut broker = state
        .capability_broker
        .lock()
        .map_err(|_| rejected("capability_broker_unavailable"))?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    store.transfers.prune();
    let grant = store
        .transfers
        .grants
        .get(&request.grant_id)
        .ok_or_else(|| rejected("result_grant_unavailable"))?;
    if grant.scope != request.scope {
        return Err(rejected("result_unavailable"));
    }
    let source = proof(&registry, &grant.scope)?;
    let target = proof(&registry, &grant.target_scope)?;
    if source.0 != grant.source_proof || target.0 != grant.target_proof {
        return Err(rejected("result_source_changed"));
    }
    let result_id = grant.result_id.clone();
    let target_scope = grant.target_scope.clone();
    let field = grant.field.clone();
    let values = grant.inputs.clone();
    let cached = grant.response.clone();
    let record = store.record(&request.scope, &result_id)?;
    if source.0 != record.proof {
        return Err(rejected("result_source_changed"));
    }
    if let Some(mut cached) = cached {
        cached["replayed"] = json!(true);
        return Ok(Json(cached));
    }
    let mapped = input(&registry, &target_scope, &field, &record.text, &values)?;
    let result = broker.invoke(
        &registry,
        CapabilityInvocation {
            caller: "result-transfer".into(),
            scene_id: target_scope.scene_id.clone(),
            workspace_id: target_scope.workspace_id.clone(),
            plugin_id: target_scope.plugin_id.clone(),
            capability_id: target_scope.capability_id.clone(),
            tool_call_id: Some(request.grant_id.clone()),
            idempotency_scope: Some("result-transfer.v1".into()),
            input: mapped,
        },
    );
    // Cache errors too: confirmation cannot silently repeat an already attempted computation.
    let mut response = match result {
        Ok(result)
            if serde_json::to_vec(&result)
                .map(|v| v.len() <= MAX_RESPONSE_BYTES)
                .unwrap_or(false) =>
        {
            json!({"schemaVersion":1,"result":result,"replayed":false})
        }
        Ok(_) => {
            json!({"schemaVersion":1,"error":{"code":"result_transfer_output_too_large"},"replayed":false})
        }
        Err(error) => json!({"schemaVersion":1,"error":{"code":error.code},"replayed":false}),
    };
    match proof(&registry, &target_scope) {
        Ok(current) if current == target => {
            if let Some(result) = response.get("result") {
                match store.capture(target_scope, target.0, target.1, result) {
                    Ok(reference) => response["resultRef"] = reference,
                    Err((_, error)) => response["resultCaptureError"] = error.0["error"].clone(),
                }
            }
        }
        _ => {
            response =
                json!({"schemaVersion":1,"error":{"code":"result_source_changed"},"replayed":false})
        }
    }
    if serde_json::to_vec(&response)
        .map(|bytes| bytes.len() > MAX_RESPONSE_BYTES)
        .unwrap_or(true)
    {
        response = json!({"schemaVersion":1,"error":{"code":"result_transfer_output_too_large"},"replayed":false});
    }
    store
        .transfers
        .grants
        .get_mut(&request.grant_id)
        .unwrap()
        .response = Some(response.clone());
    Ok(Json(response))
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod http_multi_tests;

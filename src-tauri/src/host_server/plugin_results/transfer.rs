//! Explicit desktop confirmation for version-bound, local WASI text mapping.
use super::*;
#[cfg(test)]
pub(in crate::host_server) mod fixture;
mod mapping;
pub(in crate::host_server) mod targets;
use crate::plugin_capabilities::detached_worker::Dispatch;
use mapping::{mapped_input, mapped_json_input, required_inputs, required_json_inputs};
use std::sync::atomic::{AtomicBool, Ordering};

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
    in_progress: bool,
    cancelled: Arc<AtomicBool>,
    response: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::host_server) struct TransferGrantRequest {
    scope: Scope,
    grant_id: String,
}

#[derive(Default)]
pub(super) struct Transfers {
    grants: HashMap<String, Grant>,
}

impl Transfers {
    pub(super) fn invalidate_workspace(&mut self, workspace_id: &str) {
        self.grants.retain(|_, grant| {
            grant.scope.workspace_id != workspace_id
                && grant.target_scope.workspace_id != workspace_id
        });
    }

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

fn input_json(
    registry: &PluginRegistry,
    target: &Scope,
    field: &str,
    value: &Value,
    values: &serde_json::Map<String, Value>,
) -> Result<Value, ApiError> {
    let capability = registry
        .capability(&target.scene_id, &target.plugin_id, &target.capability_id)
        .ok_or_else(|| rejected("result_target_unavailable"))?;
    let mapped = mapped_json_input(&capability.input_schema, field, value, values)?;
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
    if let Some(value) = &record.json_value {
        input_json(
            &registry,
            &target_scope,
            &request.field,
            value,
            &request.inputs,
        )?;
    } else {
        input(
            &registry,
            &target_scope,
            &request.field,
            &record.text,
            &request.inputs,
        )?;
    }
    store.transfers.prune();
    if store.transfers.grants.len() >= MAX_GRANTS {
        return Err(rejected("result_transfer_budget_exceeded"));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let preview = json!({"schemaVersion":if record.json_value.is_some() { 2 } else { 1 },"grantId":id,"expiresInSeconds":120,
        "preview":{"operation":"invoke_local_wasi","text":record.text,"mimeType":record.mime_type,"field":request.field,"inputs":request.inputs,
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
            in_progress: false,
            cancelled: Arc::new(AtomicBool::new(false)),
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
    tokio::task::spawn_blocking(move || commit_blocking(state, request))
        .await
        .map_err(|_| rejected("result_transfer_failed"))?
}

pub(in crate::host_server) async fn cancel(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<TransferGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    store.transfers.prune();
    let grant = store
        .transfers
        .grants
        .get_mut(&request.grant_id)
        .ok_or_else(|| rejected("result_grant_unavailable"))?;
    if grant.scope != request.scope {
        return Err(rejected("result_unavailable"));
    }
    let status = if grant.response.is_some() {
        "completed"
    } else {
        grant.cancelled.store(true, Ordering::Release);
        if grant.in_progress {
            "cancellation_requested"
        } else {
            "cancelled"
        }
    };
    Ok(Json(json!({"schemaVersion":1,"status":status})))
}

/// Recover a submission's state without starting or repeating its Worker.
pub(in crate::host_server) async fn status(
    State(state): State<Arc<HostState>>,
    headers: HeaderMap,
    Json(request): Json<TransferGrantRequest>,
) -> Result<Json<Value>, ApiError> {
    desktop(&state, &headers)?;
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    store.transfers.prune();
    let (
        scope,
        result_id,
        source_proof,
        target_scope,
        target_proof,
        in_progress,
        cancelled,
        response,
    ) = {
        let grant = store
            .transfers
            .grants
            .get(&request.grant_id)
            .ok_or_else(|| rejected("result_grant_unavailable"))?;
        if grant.scope != request.scope {
            return Err(rejected("result_unavailable"));
        }
        (
            grant.scope.clone(),
            grant.result_id.clone(),
            grant.source_proof.clone(),
            grant.target_scope.clone(),
            grant.target_proof.clone(),
            grant.in_progress,
            grant.cancelled.load(Ordering::Acquire),
            grant.response.clone(),
        )
    };
    let source = proof(&registry, &scope)?;
    let target = proof(&registry, &target_scope)?;
    if source.0 != source_proof || target.0 != target_proof {
        return Err(rejected("result_source_changed"));
    }
    let record = store.record(&scope, &result_id)?;
    if record.proof != source_proof {
        return Err(rejected("result_source_changed"));
    }
    let result = if let Some(response) = response {
        json!({"schemaVersion":1,"status":"completed","response":response})
    } else if in_progress {
        json!({"schemaVersion":1,"status":if cancelled {
            "cancellation_requested"
        } else { "running" }})
    } else if cancelled {
        json!({"schemaVersion":1,"status":"cancelled"})
    } else {
        json!({"schemaVersion":1,"status":"ready"})
    };
    Ok(Json(result))
}

fn commit_blocking(state: Arc<HostState>, request: Commit) -> Result<Json<Value>, ApiError> {
    let (result_id, target_scope, source_proof, target_proof, cancelled, dispatch) = {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected("registry_unavailable"))?;
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
        let in_progress = grant.in_progress;
        let cancelled = grant.cancelled.clone();
        let record = store.record(&request.scope, &result_id)?;
        if source.0 != record.proof {
            return Err(rejected("result_source_changed"));
        }
        if cancelled.load(Ordering::Acquire) && !in_progress {
            return Err(rejected("result_transfer_cancelled"));
        }
        if let Some(mut cached) = cached {
            cached["replayed"] = json!(true);
            return Ok(Json(cached));
        }
        if in_progress {
            return Err(rejected("plugin_call_in_progress"));
        }
        let mapped = if let Some(value) = &record.json_value {
            input_json(&registry, &target_scope, &field, value, &values)?
        } else {
            input(&registry, &target_scope, &field, &record.text, &values)?
        };
        let idempotency_scope = if record.json_value.is_some() {
            "result-transfer.json.v1"
        } else {
            "result-transfer.v1"
        };
        store
            .transfers
            .grants
            .get_mut(&request.grant_id)
            .unwrap()
            .in_progress = true;
        drop(store);
        let mut broker = state
            .capability_broker
            .lock()
            .map_err(|_| rejected("capability_broker_unavailable"))?;
        let dispatch = broker.prepare_worker_invocation(
            &registry,
            CapabilityInvocation {
                caller: "result-transfer".into(),
                scene_id: target_scope.scene_id.clone(),
                workspace_id: target_scope.workspace_id.clone(),
                plugin_id: target_scope.plugin_id.clone(),
                capability_id: target_scope.capability_id.clone(),
                tool_call_id: Some(request.grant_id.clone()),
                idempotency_scope: Some(idempotency_scope.into()),
                input: mapped,
            },
            &cancelled,
        );
        (
            result_id,
            target_scope,
            source.0,
            target.0,
            cancelled,
            dispatch,
        )
    };
    // A slow or failed guest must not hold the registry, broker, or result store.
    let result = match dispatch {
        Dispatch::Complete(outcome) => outcome,
        Dispatch::Worker(mut job) => {
            let outcome = job.execute(&cancelled);
            let registry = state
                .plugins
                .lock()
                .map_err(|_| rejected("registry_unavailable"))?;
            let mut broker = state
                .capability_broker
                .lock()
                .map_err(|_| rejected("capability_broker_unavailable"))?;
            broker.finish_worker_invocation(&registry, *job, outcome, &cancelled)
        }
    };
    if result
        .as_ref()
        .is_err_and(|error| error.code == "plugin_call_in_progress")
    {
        if let Ok(mut store) = state.plugin_results.lock() {
            if let Some(grant) = store.transfers.grants.get_mut(&request.grant_id) {
                grant.in_progress = false;
            }
        }
        return Err(rejected("plugin_call_in_progress"));
    }
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
    let registry = state
        .plugins
        .lock()
        .map_err(|_| rejected("registry_unavailable"))?;
    let mut store = state
        .plugin_results
        .lock()
        .map_err(|_| rejected("result_store_unavailable"))?;
    let current_grant = store
        .transfers
        .grants
        .get(&request.grant_id)
        .ok_or_else(|| rejected("result_grant_unavailable"))?;
    if current_grant.scope != request.scope || current_grant.result_id != result_id {
        return Err(rejected("result_unavailable"));
    }
    let authority_current = proof(&registry, &request.scope)
        .is_ok_and(|current| current.0 == source_proof)
        && proof(&registry, &target_scope).is_ok_and(|current| current.0 == target_proof)
        && store
            .record(&request.scope, &result_id)
            .is_ok_and(|record| record.proof == source_proof);
    match authority_current {
        true => {
            if let Some(result) = response.get("result") {
                let version = proof(&registry, &target_scope)?.1;
                match super::capture_with_declared_type(
                    &mut store,
                    &registry,
                    target_scope,
                    &(target_proof, version),
                    result,
                ) {
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
    if let Some(grant) = store.transfers.grants.get_mut(&request.grant_id) {
        grant.response = Some(response.clone());
        grant.in_progress = false;
    }
    Ok(Json(response))
}

#[cfg(test)]
mod http_multi_tests;
#[cfg(test)]
mod target_access_tests;
#[cfg(test)]
mod tests;

//! Native View/tool calls share the detached Worker lifecycle used by Pi.
use super::*;
use crate::plugin_capabilities::detached_worker::Dispatch;
use std::sync::atomic::AtomicBool;

type ApiError = (StatusCode, Json<Value>);

pub(super) async fn invoke(
    state: Arc<HostState>,
    headers: HeaderMap,
    request: CapabilityInvokeRequest,
) -> Result<Json<Value>, ApiError> {
    let lease = if request.call_id.is_some() {
        if !desktop_http_token_authorized(&headers, &state.desktop_token) {
            return Err(plugin_api_error(StatusCode::FORBIDDEN, "desktop_only", ""));
        }
        state
            .data
            .workspace_root_path(&request.workspace_id)
            .map_err(|_| plugin_api_error(StatusCode::CONFLICT, "manual_call_scope_invalid", ""))?;
        Some(state.manual_tool_calls.begin(&request)?)
    } else {
        None
    };
    tokio::task::spawn_blocking(move || {
        let cancelled = lease
            .as_ref()
            .map(|lease| lease.flag.clone())
            .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
        let result = (|| {
            let (dispatch, result_proof) = {
                let registry = state.plugins.lock().map_err(|_| registry_unavailable())?;
                let desktop = desktop_http_token_authorized(&headers, &state.desktop_token);
                if !desktop
                    && (request.capture_result
                        || registry.plugin_origin(&request.plugin_id).is_some_and(|origin| {
                            origin != PluginOrigin::BuiltIn
                        }))
                {
                    return Err(plugin_api_error(StatusCode::FORBIDDEN, "desktop_only", ""));
                }
                if let Some(revision) = &request.catalog_revision {
                    registry
                        .manual_tool_detail(&crate::plugin_registry::manual_catalog::DetailQuery {
                            scene_id: request.scene_id.clone(),
                            plugin_id: request.plugin_id.clone(),
                            capability_id: request.capability_id.clone(),
                            revision: revision.clone(),
                            resource_mime_type: None,
                        })
                        .map_err(|code| {
                            plugin_api_error(
                                StatusCode::CONFLICT,
                                code,
                                "Reload the tool before execution",
                            )
                        })?;
                }
                let proof = request
                    .capture_result
                    .then(|| plugin_results::source_proof(&registry, &request));
                let mut broker = state
                    .capability_broker
                    .lock()
                    .map_err(|_| broker_unavailable())?;
                let dispatch = broker.prepare_worker_invocation(
                    &registry,
                    CapabilityInvocation {
                        caller: "chat".into(),
                        scene_id: request.scene_id.clone(),
                        workspace_id: request.workspace_id.clone(),
                        plugin_id: request.plugin_id.clone(),
                        capability_id: request.capability_id.clone(),
                        tool_call_id: None,
                        idempotency_scope: None,
                        input: request.input.clone(),
                    },
                    &cancelled,
                );
                (dispatch, proof)
            };
            let result = match dispatch {
                Dispatch::Complete(outcome) => outcome.map_err(capability_api_error)?,
                Dispatch::Worker(mut job) => {
                    // Neither registry nor broker is held while waiting for the child process.
                    let outcome = job.execute(&cancelled);
                    let registry = state.plugins.lock().map_err(|_| registry_unavailable())?;
                    let mut broker = state
                        .capability_broker
                        .lock()
                        .map_err(|_| broker_unavailable())?;
                    broker
                        .finish_worker_invocation(&registry, *job, outcome, &cancelled)
                        .map_err(capability_api_error)?
                }
            };
            let mut response = json!({"result": result});
            if let Some(proof) = result_proof {
                let registry = state.plugins.lock().map_err(|_| registry_unavailable())?;
                let captured = proof.and_then(|proof| {
                    plugin_results::capture(&state, &registry, &request, &proof, &result)
                });
                match captured {
                    Ok(reference) => response["resultRef"] = reference,
                    Err((_, error)) => response["resultCaptureError"] = error.0["error"].clone(),
                }
            }
            Ok(Json(response))
        })();
        if let Some(lease) = &lease {
            lease.finish(&result);
        }
        result
    })
    .await
    .map_err(|_| {
        plugin_api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            "plugin_execution_failed",
            "Plugin execution task failed",
        )
    })?
}

fn registry_unavailable() -> ApiError {
    plugin_api_error(StatusCode::SERVICE_UNAVAILABLE, "registry_unavailable", "")
}
fn broker_unavailable() -> ApiError {
    plugin_api_error(
        StatusCode::SERVICE_UNAVAILABLE,
        "capability_broker_unavailable",
        "",
    )
}

#[cfg(test)]
#[path = "plugin_desktop_execution_tests.rs"]
mod tests;

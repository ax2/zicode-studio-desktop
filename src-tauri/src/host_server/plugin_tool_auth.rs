use super::*;

pub(super) fn call_target(
    state: &HostState,
    authorized: &RuntimePluginToken,
) -> Result<RuntimeTarget, (StatusCode, Json<Value>)> {
    state
        .runtimes
        .broker_call_target(&authorized.target)
        .ok_or_else(|| plugin_api_error(StatusCode::GONE, "runtime_stopped", ""))
}

pub(super) fn authorize(
    state: &HostState,
    headers: &HeaderMap,
    runtime_id: &str,
    session_id: &str,
) -> Result<RuntimePluginToken, (StatusCode, Json<Value>)> {
    let bearer = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            plugin_api_error(
                StatusCode::UNAUTHORIZED,
                "broker_auth_required",
                "A runtime broker token is required",
            )
        })?;
    let record = {
        let mut tokens = state.plugin_tokens.lock().map_err(|_| {
            plugin_api_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "broker_auth_unavailable",
                "",
            )
        })?;
        let now = SystemTime::now();
        tokens.retain(|_, record| record.expires_at > now);
        tokens.get(runtime_id).cloned()
    }
    .ok_or_else(|| {
        plugin_api_error(
            StatusCode::UNAUTHORIZED,
            "broker_token_invalid",
            "Runtime broker token is invalid or expired",
        )
    })?;
    if record.token_hash != sha256_hex(bearer.as_bytes()) || record.target.instance_id != runtime_id
    {
        return Err(plugin_api_error(
            StatusCode::UNAUTHORIZED,
            "broker_token_invalid",
            "Runtime broker token does not match this runtime",
        ));
    }
    let current = state.runtimes.broker_target(&record.target);
    let live = state
        .runtimes
        .statuses()
        .map(|statuses| {
            statuses
                .iter()
                .any(|status| Some(&status.target) == current.as_ref())
        })
        .unwrap_or(false);
    if !live {
        return Err(plugin_api_error(
            StatusCode::GONE,
            "runtime_stopped",
            "The runtime that owns this broker token is no longer active",
        ));
    }

    let current = current.expect("A live target was verified");
    if session_id != record.target.session_id && session_id != current.session_id {
        return Err(plugin_api_error(
            StatusCode::UNAUTHORIZED,
            "broker_token_invalid",
            "",
        ));
    }
    // Pi retains its launch environment; downstream scope always uses the live formal target.
    Ok(RuntimePluginToken {
        target: current,
        ..record
    })
}

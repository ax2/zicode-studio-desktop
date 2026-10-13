//! Trusted output decoding and admission. This grants no filesystem write authority.
use super::*;

pub(super) fn selection(runtime: &Value) -> Result<bool, ApiError> {
    match runtime.get("resourceOutputProfile") {
        None => Ok(false),
        Some(Value::String(value)) if value == crate::plugin_worker::resource_output::PROFILE => {
            Ok(true)
        }
        Some(_) => Err(rejected("resource_output_profile_unsupported")),
    }
}

pub(super) fn register(
    state: &HostState,
    request: &Invoke,
    proof: &str,
    frame: &[u8],
    cancelled: &std::sync::atomic::AtomicBool,
    capability: &crate::plugin_registry::PluginCapabilityDescriptor,
) -> Result<Execution, ApiError> {
    let bundle = crate::plugin_worker::resource_output::decode(frame)
        .map_err(|_| rejected("worker_protocol_error"))?;
    if bundle.result.is_null()
        || serde_json::to_vec(&bundle.result)
            .map_err(|_| rejected("worker_protocol_error"))?
            .len()
            > 1024 * 1024
    {
        return Err(rejected("result_too_large"));
    }
    validate_result(capability, &bundle.result)?;
    let sources = request.accesses().cloned().collect::<Vec<_>>();
    let pending=super::super::store::Pending::prepare(&sources,proof,bundle.resources)?;
    #[cfg(test)] {
        let observer=state.plugin_resource_workers.observer.lock().unwrap().clone();
        if let Some(observer)=observer { observer("output_prepared",0); }
    }
    // Decoding/hashing may take time; recheck live authority immediately before admission.
    if identity(state, &request.access.owner, None)? != proof {
        return Err(rejected("resource_authorization_changed"));
    }
    for access in request.accesses() {
        authority::check_ancestors(state, access, proof)?;
    }
    let mut store = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    let resources = store.publish_outputs(pending, cancelled)?;
    Ok(Execution {
        result: bundle.result,
        resources: Some(resources),
    })
}

fn validate_result(
    capability: &crate::plugin_registry::PluginCapabilityDescriptor,
    result: &Value,
) -> Result<(), ApiError> {
    crate::plugin_capabilities::output_contract::validate_result(capability, result).map_err(
        |error| {
            rejected(if error.code == "result_too_large" {
                "result_too_large"
            } else {
                "invalid_output"
            })
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_profile_requires_exact_explicit_manifest_selection() {
        assert!(!selection(&json!({})).unwrap());
        assert!(selection(
            &json!({"resourceOutputProfile":crate::plugin_worker::resource_output::PROFILE})
        )
        .unwrap());
        for value in [
            Value::Null,
            json!(true),
            json!("resource.v1"),
            json!("resource.wasi.output.draft2"),
        ] {
            assert!(selection(&json!({"resourceOutputProfile":value})).is_err());
        }
    }
    #[test]
    fn declared_result_schema_rejects_invalid_output_before_admission() {
        let schema = json!({"type":"object","properties":{"text":{"type":"string"}},"required":["text"],"additionalProperties":false});
        let mut capability = crate::plugin_registry::PluginCapabilityDescriptor {
            plugin_id: "p".into(),
            id: "c".into(),
            title: "c".into(),
            input_schema: json!({}),
            resource_input_max: None,
            output_schema: Some(schema),
            max_result_bytes: None,
        };
        assert!(validate_result(&capability, &json!({"text":"copied"})).is_ok());
        for result in [
            json!({"text":1}),
            json!({}),
            json!({"text":"copied","path":"forbidden"}),
        ] {
            assert_eq!(
                validate_result(&capability, &result).unwrap_err().1 .0["error"]["code"],
                "invalid_output"
            );
        }
        capability.output_schema = Some(json!({"oneOf":[{"type":"string"},{"type":"null"}]}));
        assert!(validate_result(&capability, &json!("ok")).is_ok());
        assert!(validate_result(&capability, &json!(1)).is_err());
        capability.output_schema = None;
        capability.max_result_bytes = Some(2);
        assert_eq!(
            validate_result(&capability, &json!("long"))
                .unwrap_err()
                .1
                 .0["error"]["code"],
            "result_too_large"
        );
        capability.max_result_bytes = None;
        assert!(validate_result(&capability, &json!({"text":"copied"})).is_ok());
    }
}

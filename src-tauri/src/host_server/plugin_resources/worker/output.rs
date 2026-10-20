//! Trusted output decoding and admission. This grants no filesystem write authority.
use super::*;

pub(super) struct Profiles {
    pub(super) extended_output_types: bool,
    pub(super) image_resize: bool,
}

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
    profiles: Profiles,
) -> Result<Execution, ApiError> {
    let bundle = crate::plugin_worker::resource_output::decode(frame)
        .map_err(|_| rejected("worker_protocol_error"))?;
    validate_types(&bundle, profiles.extended_output_types)?;
    if profiles.image_resize {
        if let Some(result) = normalize_image_resize_failure(&bundle.result)? {
            if !bundle.resources.is_empty() {
                return Err(rejected("invalid_output"));
            }
            return Ok(Execution {
                result,
                resources: None,
            });
        }
        validate_image_resize_outputs(&bundle)?;
    }
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
    let pending = super::super::store::Pending::prepare(&sources, proof, bundle.resources)?;
    #[cfg(test)]
    {
        let observer = state
            .plugin_resource_workers
            .observer
            .lock()
            .unwrap()
            .clone();
        if let Some(observer) = observer {
            observer("output_prepared", 0);
        }
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

/// Accepts only the image adapter's bounded public error envelope. Guest text is discarded so
/// it cannot leak paths or arbitrary diagnostics into Studio's UI or logs.
fn normalize_image_resize_failure(result: &Value) -> Result<Option<Value>, ApiError> {
    if result.get("ok") != Some(&Value::Bool(false)) {
        return Ok(None);
    }
    let invalid = || rejected("invalid_output");
    let object = result.as_object().ok_or_else(invalid)?;
    if object.len() != 2 {
        return Err(invalid());
    }
    let error = object
        .get("error")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    if error.len() != 2 {
        return Err(invalid());
    }
    let code = error
        .get("code")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    if message.len() > 512 {
        return Err(invalid());
    }
    let message = match code {
        "INVALID_PARAMETERS" => "图片处理参数无效",
        "INPUT_LIMIT" => "输入图片为空或超过 32 MiB",
        "IMAGE_DIMENSION_LIMIT" => "图片尺寸超过当前能力上限",
        "IMAGE_MEMORY_LIMIT" => "图片解码内存超过当前能力上限",
        "INVALID_IMAGE" => "输入内容不是受支持的 PNG、JPEG 或 WebP 图片",
        "OUTPUT_LIMIT" => "编码结果超过 32 MiB 输出限制",
        "IMAGE_OPERATION_FAILED" => "图片处理失败或超出运行资源限制",
        _ => return Err(invalid()),
    };
    Ok(Some(
        json!({"ok":false,"error":{"code":code,"message":message}}),
    ))
}

fn validate_image_resize_outputs(
    bundle: &crate::plugin_worker::resource_output::Bundle,
) -> Result<(), ApiError> {
    if bundle.resources.len() != 1 {
        return Err(rejected("invalid_output"));
    }
    let output = &bundle.resources[0];
    if output.bytes.len() > crate::plugin_resource_execution::IMAGE_RESIZE_MAX_RESOURCE_BYTES {
        return Err(rejected("result_too_large"));
    }
    if !crate::plugin_resource_execution::IMAGE_MIME_TYPES.contains(&output.mime_type.as_str()) {
        return Err(rejected("invalid_output"));
    }
    Ok(())
}

fn validate_types(
    bundle: &crate::plugin_worker::resource_output::Bundle,
    extended_output_types: bool,
) -> Result<(), ApiError> {
    if !extended_output_types
        && bundle
            .resources
            .iter()
            .any(|item| crate::plugin_output_types::requires_profile(&item.mime_type))
    {
        return Err(rejected("resource_output_profile_unsupported"));
    }
    Ok(())
}

pub(super) fn validate_result(
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
    fn output_types_require_the_manifest_profile_before_publication() {
        let mut bundle = crate::plugin_worker::resource_output::Bundle {
            binary: true,
            result: json!({}),
            resources: vec![crate::plugin_worker::resource_output::Blob {
                mime_type: "image/png".into(),
                bytes: vec![1],
            }],
        };
        assert!(validate_types(&bundle, false).is_ok());
        for mime in [
            "application/x-zicode-archive-zip",
            "text/html",
            "application/x-zicode-sqlite",
        ] {
            bundle.resources[0].mime_type = mime.into();
            assert_eq!(
                validate_types(&bundle, false).unwrap_err().1 .0["error"]["code"],
                "resource_output_profile_unsupported"
            );
            assert!(validate_types(&bundle, true).is_ok());
        }
    }
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
    fn image_resize_output_is_single_bounded_and_uses_an_image_mime_type() {
        let blob = || crate::plugin_worker::resource_output::Blob {
            mime_type: "image/webp".into(),
            bytes: vec![1, 2, 3],
        };
        let bundle = |resources| crate::plugin_worker::resource_output::Bundle {
            binary: true,
            result: json!({}),
            resources,
        };
        assert!(validate_image_resize_outputs(&bundle(vec![blob()])).is_ok());
        assert_eq!(
            validate_image_resize_outputs(&bundle(vec![]))
                .unwrap_err()
                .1
                 .0["error"]["code"],
            "invalid_output"
        );
        assert_eq!(
            validate_image_resize_outputs(&bundle(vec![blob(), blob()]))
                .unwrap_err()
                .1
                 .0["error"]["code"],
            "invalid_output"
        );
        let invalid_mime = crate::plugin_worker::resource_output::Blob {
            mime_type: "application/octet-stream".into(),
            bytes: vec![1, 2, 3],
        };
        assert_eq!(
            validate_image_resize_outputs(&bundle(vec![invalid_mime]))
                .unwrap_err()
                .1
                 .0["error"]["code"],
            "invalid_output"
        );
        let oversized = crate::plugin_worker::resource_output::Blob {
            mime_type: "image/png".into(),
            bytes: vec![0; crate::plugin_resource_execution::IMAGE_RESIZE_MAX_RESOURCE_BYTES + 1],
        };
        assert_eq!(
            validate_image_resize_outputs(&bundle(vec![oversized]))
                .unwrap_err()
                .1
                 .0["error"]["code"],
            "result_too_large"
        );
    }

    #[test]
    fn image_resize_failure_envelopes_are_allowlisted_and_guest_text_is_discarded() {
        let normalized = normalize_image_resize_failure(&json!({
            "ok": false,
            "error": {"code":"INVALID_IMAGE", "message":"C:\\private\\input.png failed"}
        }))
        .unwrap()
        .unwrap();
        assert_eq!(normalized["error"]["code"], "INVALID_IMAGE");
        assert_eq!(
            normalized["error"]["message"],
            "输入内容不是受支持的 PNG、JPEG 或 WebP 图片"
        );

        for invalid in [
            json!({"ok":false,"error":{"code":"UNKNOWN","message":"failed"}}),
            json!({"ok":false,"error":{"code":"INVALID_IMAGE","message":"failed","path":"secret"}}),
            json!({"ok":false,"error":{"code":"INVALID_IMAGE","message":"x".repeat(513)}}),
            json!({"ok":false,"error":"failed"}),
        ] {
            assert_eq!(
                normalize_image_resize_failure(&invalid).unwrap_err().1 .0["error"]["code"],
                "invalid_output"
            );
        }
        assert_eq!(
            normalize_image_resize_failure(&json!({"ok":true})).unwrap(),
            None
        );
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
            resource_input_mime_types: None,
            execution_profile: None,
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

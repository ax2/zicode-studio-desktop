//! Fixed Host-side receiver for Windows OCR over one explicitly shared image.
use super::*;
use crate::plugin_capabilities::validate_value;
use crate::plugin_worker::resource_output::Blob;
use base64::Engine;
use std::sync::{Mutex, OnceLock};

static OCR_SLOT: OnceLock<Mutex<()>> = OnceLock::new();

pub(super) fn execute(
    state: &HostState,
    request: &Invoke,
    cancelled: &std::sync::atomic::AtomicBool,
    package_version: &mut Option<String>,
) -> Result<Execution, ApiError> {
    if !cfg!(target_os = "windows") || !request.additional_accesses.is_empty() {
        return Err(rejected("resource_profile_unsupported"));
    }
    let _slot = OCR_SLOT
        .get_or_init(|| Mutex::new(()))
        .try_lock()
        .map_err(|_| rejected("resource_worker_busy"))?;
    let owner = &request.access.owner;
    let capability = {
        let registry = state
            .plugins
            .lock()
            .map_err(|_| rejected("registry_unavailable"))?;
        let target = state
            .runtimes
            .statuses()
            .map_err(|_| rejected("runtime_unavailable"))?
            .into_iter()
            .find(|status| {
                status.target.instance_id == owner.runtime_id
                    && status.target.session_id == owner.session_id
            })
            .map(|status| status.target)
            .ok_or_else(|| rejected("runtime_stopped"))?;
        let plugin = registry
            .execution_plugin(&target.scene_id, &owner.plugin_id)
            .filter(|plugin| plugin.enabled)
            .ok_or_else(|| rejected("resource_plugin_unavailable"))?;
        let cap_profile = plugin
            .manifest
            .contributes
            .get("capabilities")
            .and_then(Value::as_array)
            .and_then(|caps| {
                caps.iter().find(|cap| {
                    cap.get("id").and_then(Value::as_str) == Some(owner.capability_id.as_str())
                })
            })
            .and_then(|cap| cap.get("resourceInputProfile").and_then(Value::as_str));
        if plugin.origin != crate::plugin_registry::PluginOrigin::BuiltIn
            || owner.plugin_id != crate::plugin_resource_execution::HOST_OCR_PLUGIN_ID
            || owner.capability_id != crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID
            || cap_profile != Some(crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE)
            || plugin.permission_grants.get("resource.read") != Some(&true)
        {
            return Err(rejected("resource_profile_unsupported"));
        }
        *package_version = Some(plugin.manifest.version.clone());
        registry
            .capability(&target.scene_id, &owner.plugin_id, &owner.capability_id)
            .ok_or_else(|| rejected("capability_unavailable"))?
    };
    validate_value(&capability.input_schema, &request.input, "$")
        .map_err(|_| rejected("invalid_parameters"))?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    let proof = super::super::identity(state, owner, None)?;
    super::authority::check_ancestors(state, &request.access, &proof)?;
    let resource = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .snapshot(&request.access, &proof)?;
    if capability
        .resource_input_mime_types
        .as_ref()
        .is_none_or(|accepted| !accepted.contains(&resource.descriptor.mime_type))
    {
        return Err(rejected("resource_input_type_unsupported"));
    }
    if resource.descriptor.byte_length != resource.bytes.len()
        || resource.descriptor.byte_length > crate::plugin_resource_execution::HOST_IMAGE_MAX_BYTES
    {
        return Err(rejected("resource_input_invalid"));
    }
    // Validate decoder/MIME agreement and image allocation bounds before the OCR bridge.
    crate::plugin_resource_execution::inspect_image(
        &resource.bytes,
        &resource.descriptor.mime_type,
    )
    .map_err(rejected)?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&resource.bytes);
    let image = format!("data:{};base64,{encoded}", resource.descriptor.mime_type);
    let input = json!({"image":image,"language":request.input.get("language").cloned()});
    let root = std::path::Path::new("");
    let result = crate::ocr::extract_text_cancellable(
        &serde_json::from_value(input).map_err(|_| rejected("invalid_parameters"))?,
        root,
        Some(cancelled),
    )
    .map_err(|error| match error.as_str() {
        "[worker_cancelled]" => rejected("worker_cancelled"),
        "[worker_timeout]" => rejected("worker_timeout"),
        _ => rejected("resource_ocr_failed"),
    })?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    if super::super::identity(state, owner, None)? != proof {
        return Err(rejected("resource_authorization_changed"));
    }
    super::authority::check_ancestors(state, &request.access, &proof)?;
    let result = serde_json::to_value(result).map_err(|_| rejected("resource_ocr_failed"))?;
    super::output::validate_result(&capability, &result)?;
    let text = result
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| rejected("resource_ocr_failed"))?;
    let pending = super::super::store::Pending::prepare(
        std::slice::from_ref(&request.access),
        &proof,
        vec![Blob {
            mime_type: "text/plain".into(),
            bytes: text.as_bytes().to_vec(),
        }],
    )?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    if super::super::identity(state, owner, None)? != proof {
        return Err(rejected("resource_authorization_changed"));
    }
    super::authority::check_ancestors(state, &request.access, &proof)?;
    let resources = state
        .plugin_resources
        .lock()
        .map_err(|_| rejected("resource_store_unavailable"))?
        .publish_outputs(pending, cancelled)?;
    Ok(Execution {
        result,
        resources: Some(resources),
    })
}

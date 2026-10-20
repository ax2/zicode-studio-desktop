//! Fixed Host-side receiver for one explicitly shared UTF-8 text resource.
use super::*;
use crate::plugin_capabilities::validate_value;

pub(super) fn execute(
    state: &HostState,
    request: &Invoke,
    cancelled: &std::sync::atomic::AtomicBool,
    package_version: &mut Option<String>,
) -> Result<Execution, ApiError> {
    if !request.additional_accesses.is_empty() {
        return Err(rejected("resource_profile_unsupported"));
    }
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
        if plugin.origin != crate::plugin_registry::PluginOrigin::BuiltIn
            || owner.plugin_id != crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID
            || owner.capability_id
                != crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID
            || plugin
                .manifest
                .runtime
                .get("resourceInputProfile")
                .and_then(Value::as_str)
                != Some(crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE)
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
        || resource.descriptor.byte_length > crate::plugin_resource_execution::HOST_TEXT_MAX_BYTES
    {
        return Err(rejected("resource_input_invalid"));
    }
    let result = crate::plugin_resource_execution::inspect_text(
        &resource.bytes,
        &resource.descriptor.mime_type,
    )
    .map_err(rejected)?;
    if cancelled.load(Ordering::Acquire) {
        return Err(rejected("worker_cancelled"));
    }
    if super::super::identity(state, owner, None)? != proof {
        return Err(rejected("resource_authorization_changed"));
    }
    super::authority::check_ancestors(state, &request.access, &proof)?;
    super::output::validate_result(&capability, &result)?;
    Ok(Execution {
        result,
        resources: None,
    })
}

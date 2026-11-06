//! Explicit resource-only execution policy for bounded regex replacement.
use crate::plugin_registry::PluginManifest;
use serde_json::Value;

pub(crate) const PROFILE: &str = "resource.wasi.regex.replace.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.1";
pub(crate) const FUEL: u64 = 1_000_000_000;
pub(crate) const TIMEOUT_SECS: u64 = 10;
pub(crate) const TEXT_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const TEMPLATE_BYTES: usize = 64 * 1024;

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE) || crate::plugin_regex_review::selected(profile)
}

/// Manual detail uses manifest capabilities, rather than the execution descriptor.
/// Never accept parent-owned role/count metadata supplied by an ordinary manifest.
pub(crate) fn manual_capability(value: &Value) -> Value {
    let mut value = value.clone();
    let regex = selected(value.get("executionProfile").and_then(Value::as_str));
    let markdown = crate::plugin_resource_execution::markdown::selected(value.get("executionProfile").and_then(Value::as_str));
    if let Some(object) = value.as_object_mut() {
        object.remove("resourceInputMin");
        object.remove("resourceInputLabels");
        if regex {
            object.insert("resourceInputMin".into(), serde_json::json!(2));
            object.insert(
                "resourceInputLabels".into(),
                serde_json::json!(["Input text", "Replacement template"]),
            );
        } else if markdown {
            object.insert("resourceInputMin".into(), serde_json::json!(1));
            object.insert("resourceInputMax".into(), serde_json::json!(1));
            object.insert("resourceInputLabels".into(), serde_json::json!(["Markdown text"]));
        }
    }
    value
}

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    let requirements = &manifest.required_profiles;
    let legacy= requirements.get(PROFILE).is_some();
    let review= requirements.get(crate::plugin_regex_review::PROFILE).is_some();
    if legacy == review {
        return Err("Select exactly one regex resource execution profile".into());
    }
    let profile=if review { crate::plugin_regex_review::PROFILE } else { PROFILE };
    if requirements.get(profile).and_then(Value::as_str) != Some("=1.0.0-preview.1") {
        return Err("Regex replacement execution requires its exact preview profile".into());
    }
    let capabilities = manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|c| selected(c.get("executionProfile").and_then(Value::as_str)))
        .collect::<Vec<_>>();
    let permission = manifest
        .permissions
        .required
        .iter()
        .chain(&manifest.permissions.optional)
        .any(|p| p.name == "resource.read");
    if manifest.schema_version != 2
        || !permission
        || capabilities.len() != 1
        || requirements.get("output.schema.v1").is_none()
        || requirements.get("resource.output.types.v1").is_none()
        || manifest
            .runtime
            .get("wasi")
            .and_then(Value::as_str)
            .is_none()
        || manifest
            .runtime
            .get("resourceInputProfile")
            .and_then(Value::as_str)
            != Some("resource.wasi.input.draft2")
        || manifest
            .runtime
            .get("resourceOutputProfile")
            .and_then(Value::as_str)
            != Some("resource.wasi.output.draft1")
    {
        return Err("Regex replacement requires resource WASI input/output, output profiles and resource.read permission".into());
    }
    let capability = capabilities[0];
    if capability.get("executionProfile").and_then(Value::as_str) != Some(profile)
        || capability.get("resourceInputMax").and_then(Value::as_u64) != Some(2)
        || capability.get("outputSchema").is_none()
    {
        return Err(
            "Regex replacement requires two ordered resource inputs and a declared result schema"
                .into(),
        );
    }
    if review { crate::plugin_regex_review::validate_capability(capability,requirements)?; }
    Ok(())
}

/// Input 0 is source text; input 1 is replacement text. The pattern remains a bounded parameter.
pub(crate) fn validate_resources(inputs: &[(&str, usize)]) -> Result<(), &'static str> {
    if inputs.len() != 2 {
        return Err("resource_profile_unsupported");
    }
    if inputs.iter().any(|(mime, _)| *mime != "text/plain") {
        return Err("resource_input_type_unsupported");
    }
    if inputs[0].1 > TEXT_BYTES || inputs[1].1 > TEMPLATE_BYTES {
        return Err("resource_input_too_large");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn full_text_template_and_empty_inputs_keep_order_and_bounds() {
        assert!(
            validate_resources(&[("text/plain", TEXT_BYTES), ("text/plain", TEMPLATE_BYTES)])
                .is_ok()
        );
        assert!(validate_resources(&[("text/plain", 0), ("text/plain", 0)]).is_ok());
        assert!(
            validate_resources(&[("text/plain", TEMPLATE_BYTES), ("text/plain", TEXT_BYTES)])
                .is_err()
        );
        assert!(validate_resources(&[("text/plain", TEXT_BYTES + 1), ("text/plain", 0)]).is_err());
        assert!(
            validate_resources(&[("text/plain", 0), ("text/plain", TEMPLATE_BYTES + 1)]).is_err()
        );
        assert!(validate_resources(&[("image/png", 3), ("text/plain", 1)]).is_err());
        assert!(validate_resources(&[("text/plain", 1)]).is_err());
        assert!(validate_resources(&[("text/plain", 1); 3]).is_err());
    }
    #[test]
    fn profile_name_is_exact_and_does_not_select_plain_compute() {
        assert!(selected(Some(PROFILE)));
        assert!(!selected(None));
        assert!(!selected(Some("compute.wasi.v1")));
        assert!(!selected(Some("resource.wasi.regex.replace.v2")));
    }
}

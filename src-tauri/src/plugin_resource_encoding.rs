//! Opt-in full-file encoding inspection with a fixed scope and a bounded Worker budget.
use crate::plugin_registry::PluginManifest;
use serde_json::{json, Value};

pub(crate) const PROFILE: &str = "resource.wasi.encoding-inspect.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.1";
pub(crate) const PLUGIN: &str = "com.zicode.devtools.encoding";
pub(crate) const CAPABILITY: &str = "devtools.encoding.inspect";
pub(crate) const MAX_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const LEGACY_MAX_BYTES: usize = 128 * 1024;
pub(crate) const MEMORY_MIB: usize = 64;
pub(crate) const TIMEOUT_SECS: u64 = 15;
pub(crate) const FUEL: u64 = 64_000_000_000;
const MIME_TYPES: [&str; 3] = ["text/plain", "application/octet-stream", "text/csv"];

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    let selected_caps = manifest.contributes["capabilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|cap| selected(cap["executionProfile"].as_str()))
        .collect::<Vec<_>>();
    if selected_caps.is_empty() && manifest.required_profiles.get(PROFILE).is_none() {
        return Ok(());
    }
    let fail = || "Encoding inspection requires the fixed read-only resource contract".to_owned();
    if manifest.schema_version != 2
        || manifest.id != PLUGIN
        || manifest
            .required_profiles
            .get(PROFILE)
            .and_then(Value::as_str)
            != Some("=1.0.0-preview.1")
        || manifest.runtime["wasi"].as_str().is_none()
        || manifest.runtime["resourceInputProfile"] != "resource.wasi.input.draft2"
        || manifest.runtime["resourceOutputProfile"] != "resource.wasi.output.draft1"
        || !manifest
            .permissions
            .required
            .iter()
            .any(|permission| permission.name == "resource.read")
        || [
            "output.schema.v1",
            "resource.input.types.v1",
            "tool.directory.v1",
        ]
        .iter()
        .any(|name| manifest.required_profiles.get(*name).is_none())
        || ["commands", "views", "activities", "piTools"]
            .iter()
            .any(|name| {
                manifest.contributes[*name]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
            })
        || selected_caps.len() != 1
    {
        return Err(fail());
    }
    let cap = selected_caps[0];
    if cap["id"] != CAPABILITY
        || cap["inputSchema"]
            != json!({"type":"object","properties":{},"required":[],"additionalProperties":false})
        || cap["resourceInputMimeTypes"] != json!(MIME_TYPES)
        || [
            "resourceInputMin",
            "resourceInputMax",
            "resourceInputLabels",
        ]
        .iter()
        .any(|name| cap.get(*name).is_some())
        || !cap["outputSchema"].is_object()
        || cap["maxResultBytes"] != 8192
    {
        return Err(fail());
    }
    Ok(())
}

pub(crate) fn validate_input(
    plugin: &str,
    capability: Option<&str>,
    lengths: &[usize],
) -> Result<(), &'static str> {
    if plugin != PLUGIN || capability != Some(CAPABILITY) || lengths.len() != 1 {
        return Err("resource_profile_unsupported");
    }
    if lengths[0] > MAX_BYTES {
        return Err("resource_input_too_large");
    }
    Ok(())
}

pub(crate) fn validate_output(
    result: &Value,
    source_bytes: usize,
    outputs: usize,
) -> Result<(), &'static str> {
    let valid = match result["ok"].as_bool() {
        Some(true) => {
            result["operation"] == "inspect"
                && result["sourceByteCount"].as_u64() == Some(source_bytes as u64)
                && source_bytes > 0
                && result["preview"]
                    .as_str()
                    .is_some_and(|preview| preview.chars().count() <= 256)
        }
        Some(false) => result["error"]["code"].as_str().is_some_and(|code| {
            ["EMPTY_RESOURCE", "RESOURCE_READ_FAILED", "INVALID_REQUEST"].contains(&code)
        }),
        None => false,
    };
    if outputs == 0 && valid {
        Ok(())
    } else {
        Err("invalid_output")
    }
}

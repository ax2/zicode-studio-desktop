//! Explicit same-scope resource execution policy for the shared Markdown adapter.
use crate::{plugin_registry::PluginManifest, plugin_worker::resource_output::Bundle};
use serde_json::{json, Value};
pub(crate) const PROFILE: &str = "resource.wasi.markdown.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.2";
pub(crate) const LEGACY_VERSION: &str = "1.0.0-preview.1";
pub(crate) const CAPABILITY: &str = "devtools.markdown.render";
pub(crate) const INPUT_MAX: usize = 2 * 1024 * 1024;
pub(crate) const HTML_MAX: usize = 16 * 1024 * 1024;
pub(crate) const MEMORY_MIB: usize = 256;
pub(crate) const FUEL: u64 = 1_000_000_000;
pub(crate) const TIMEOUT_SECS: u64 = 10;
pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}
pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    let caps = manifest.contributes["capabilities"].as_array();
    let required = manifest.required_profiles.get(PROFILE).is_some();
    let declares = caps
        .into_iter()
        .flatten()
        .any(|cap| selected(cap["executionProfile"].as_str()));
    if !required && !declares {
        return Ok(());
    }
    let fail = || {
        "Markdown requires the exact UTF-8 resource profile, one render operation, resource.read and input/output snapshots".to_owned()
    };
    if !required
        || manifest.schema_version != 2
        || !matches!(
            manifest.required_profiles[PROFILE].as_str(),
            Some("=1.0.0-preview.1" | "=1.0.0-preview.2")
        )
        || caps.is_none_or(|caps| caps.len() != 1)
        || manifest.runtime["wasi"].as_str().is_none()
        || manifest.runtime["resourceInputProfile"] != "resource.wasi.input.draft2"
        || manifest.runtime["resourceOutputProfile"] != "resource.wasi.output.draft1"
        || !manifest
            .permissions
            .required
            .iter()
            .chain(&manifest.permissions.optional)
            .any(|permission| permission.name == "resource.read")
        || manifest.contributes["commands"]
            .as_array()
            .is_some_and(|commands| !commands.is_empty())
        || [
            "output.schema.v1",
            "resource.output.types.v1",
            "tool.directory.v1",
        ]
        .iter()
        .any(|key| manifest.required_profiles.get(*key).is_none())
    {
        return Err(fail());
    }
    let cap = &caps.unwrap()[0];
    let input_schema = if manifest.required_profiles[PROFILE] == "=1.0.0-preview.2" {
        json!({"type":"object","properties":{"sourceMode":{"type":"string","enum":["file","draft"],"default":"file"}},"required":[],"additionalProperties":false})
    } else {
        json!({"type":"object","properties":{},"required":[],"additionalProperties":false})
    };
    if cap["id"] != CAPABILITY
        || !selected(cap["executionProfile"].as_str())
        || cap.get("resourceInputMax").is_some()
        || cap.get("resourceInputMin").is_some()
        || cap.get("resourceInputLabels").is_some()
        || cap.get("resourceInputMimeTypes").is_some()
        || manifest
            .required_profiles
            .get("resource.input.types.v1")
            .is_some()
        || cap["inputSchema"] != input_schema
        || !cap["outputSchema"].is_object()
        || cap["maxResultBytes"] != 2048
    {
        return Err(fail());
    }
    Ok(())
}
pub(crate) fn validate_resources(resources: &[(&str, usize)]) -> Result<(), &'static str> {
    if resources.len() != 1 {
        return Err("resource_profile_unsupported");
    }
    if resources[0].1 > INPUT_MAX {
        return Err("resource_input_too_large");
    }
    Ok(())
}
pub(crate) fn validate_outputs(bundle: &Bundle) -> Result<Option<Value>, &'static str> {
    if bundle.profile != crate::plugin_worker::resource_output::Profile::Draft1 {
        return Err("invalid_output");
    }
    let value = &bundle.result;
    let object = value.as_object().ok_or("invalid_output")?;
    if value["ok"] == false {
        let error = value["error"].as_object().ok_or("invalid_output")?;
        if object.len() != 2
            || error.len() != 2
            || error.get("code") != Some(&json!("MARKDOWN_FAILED"))
            || !error
                .get("message")
                .and_then(Value::as_str)
                .is_some_and(|text| text.len() <= 512)
            || !bundle.resources.is_empty()
        {
            return Err("invalid_output");
        }
        return Ok(Some(
            json!({"ok":false,"error":{"code":"MARKDOWN_FAILED","message":"Markdown处理失败，请检查UTF-8编码、2MiB输入和结构复杂度。"}}),
        ));
    }
    let keys = [
        "ok",
        "inputBytes",
        "utf8Bytes",
        "htmlBytes",
        "eventCount",
        "mimeType",
        "sourceUnchanged",
        "sourceToolVersion",
    ];
    if object.len() != keys.len()
        || keys.iter().any(|key| !object.contains_key(*key))
        || value["ok"] != true
        || value["sourceUnchanged"] != true
        || value["mimeType"] != "text/html"
        || bundle.resources.len() != 1
    {
        return Err("invalid_output");
    }
    let input = value["inputBytes"].as_u64().ok_or("invalid_output")?;
    let utf8 = value["utf8Bytes"].as_u64().ok_or("invalid_output")?;
    let html = value["htmlBytes"].as_u64().ok_or("invalid_output")?;
    let events = value["eventCount"].as_u64().ok_or("invalid_output")?;
    let blob = &bundle.resources[0];
    if input > INPUT_MAX as u64
        || utf8 > input
        || !matches!(input - utf8, 0 | 3)
        || events > 200_000
        || html == 0
        || html > HTML_MAX as u64
        || html != blob.bytes.len() as u64
        || blob.mime_type != "text/html"
        || !value["sourceToolVersion"]
            .as_str()
            .is_some_and(|version| version.len() <= 32 && semver::Version::parse(version).is_ok())
    {
        return Err("invalid_output");
    }
    let text = std::str::from_utf8(&blob.bytes).map_err(|_| "invalid_output")?;
    if !text.starts_with("<!doctype html>\n")
        || !text.ends_with("</html>")
        || !text.contains("default-src 'none'")
    {
        return Err("invalid_output");
    }
    Ok(None)
}
#[cfg(test)]
#[path = "plugin_resource_markdown_tests.rs"]
mod tests;

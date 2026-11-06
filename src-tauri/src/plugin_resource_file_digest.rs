//! Bounded execution contract for explicitly shared file snapshots.
use crate::plugin_registry::PluginManifest;
use serde_json::{json, Value};
use sha2::{Digest, Sha512};

pub(crate) const PROFILE: &str = "resource.wasi.file-digest.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.1";
pub(crate) const CAPABILITY: &str = "devtools.files.hash";
pub(crate) const MAX_BYTES: usize = 32 * 1024 * 1024;
pub(crate) const MAX_FILES: usize = 4;
pub(crate) const FUEL: u64 = 8_000_000_000;
pub(crate) const TIMEOUT_SECS: u64 = 30;

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
    let fail = || "File digest requires the exact bounded resource-only contract".to_owned();
    let input = json!({"type":"object","properties":{"expected":{"type":"string","maxLength":128}},"additionalProperties":false});
    if manifest.schema_version != 2
        || manifest.required_profiles[PROFILE] != "=1.0.0-preview.1"
        || caps.is_none_or(|items| items.len() != 1)
        || manifest.runtime["wasi"].as_str().is_none()
        || manifest.runtime["resourceInputProfile"] != "resource.wasi.input.draft2"
        || manifest.runtime["resourceOutputProfile"] != "resource.wasi.output.draft1"
        || !manifest
            .permissions
            .required
            .iter()
            .chain(&manifest.permissions.optional)
            .any(|p| p.name == "resource.read")
        || [
            "output.schema.v1",
            "resource.input.types.v1",
            "tool.directory.v1",
        ]
        .iter()
        .any(|key| manifest.required_profiles.get(*key).is_none())
        || ["commands", "views", "activities", "piTools"]
            .iter()
            .any(|key| {
                manifest.contributes[*key]
                    .as_array()
                    .is_some_and(|items| !items.is_empty())
            })
    {
        return Err(fail());
    }
    let cap = &caps.unwrap()[0];
    let mut declared_input = cap["inputSchema"].clone();
    if let Some(expected) = declared_input
        .get_mut("properties")
        .and_then(|v| v.get_mut("expected"))
        .and_then(Value::as_object_mut)
    {
        expected.remove("title");
    }
    if cap["id"] != CAPABILITY
        || !selected(cap["executionProfile"].as_str())
        || cap["resourceInputMax"] != MAX_FILES
        || cap["resourceInputMin"] != 1
        || cap.get("resourceInputLabels").is_some()
        || declared_input != input
        || !cap["outputSchema"].is_object()
        || cap["maxResultBytes"] != 8192
    {
        return Err(fail());
    }
    Ok(())
}

pub(crate) fn validate_resources(lengths: &[usize]) -> Result<(), &'static str> {
    if lengths.is_empty() || lengths.len() > MAX_FILES {
        return Err("resource_profile_unsupported");
    }
    let total = lengths
        .iter()
        .try_fold(0usize, |sum, length| sum.checked_add(*length))
        .ok_or("resource_input_too_large")?;
    if total > MAX_BYTES {
        return Err("resource_input_too_large");
    }
    Ok(())
}

pub(crate) fn validate_result(
    result: &Value,
    sources: &[(&str, &[u8])],
    expected: &str,
    output_count: usize,
) -> Result<Option<Value>, &'static str> {
    let invalid = || "invalid_output";
    if output_count != 0 {
        return Err(invalid());
    }
    let object = result.as_object().ok_or_else(invalid)?;
    if result["ok"] == false {
        let error = result["error"].as_object().ok_or_else(invalid)?;
        let code = error
            .get("code")
            .and_then(Value::as_str)
            .ok_or_else(invalid)?;
        if object.len() != 2
            || error.len() != 2
            || ![
                "INVALID_REQUEST",
                "INVALID_EXPECTED_DIGEST",
                "INPUT_TOO_LARGE",
                "RESOURCE_READ_FAILED",
            ]
            .contains(&code)
            || error
                .get("message")
                .and_then(Value::as_str)
                .is_none_or(|message| message.len() > 512)
        {
            return Err(invalid());
        }
        return Ok(Some(
            json!({"ok":false,"error":{"code":code,"message":"文件校验未完成；原文件未修改。"}}),
        ));
    }
    let files = result["files"].as_array().ok_or_else(invalid)?;
    if object.len() != 4
        || result["ok"] != true
        || result["schemaVersion"] != 2
        || result["material"] != "file-integrity-report-list"
        || files.len() != sources.len()
        || files.is_empty()
        || files.len() > MAX_FILES
    {
        return Err(invalid());
    }
    for (index, (file, (version, bytes))) in files.iter().zip(sources).enumerate() {
        let row = file.as_object().ok_or_else(invalid)?;
        let sha256 = file["sha256"].as_str().ok_or_else(invalid)?;
        let sha512 = file["sha512"].as_str().ok_or_else(invalid)?;
        let hex = |s: &str, len| {
            s.len() == len
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        };
        if row.len() != 5
            || ["index", "bytes", "sha256", "sha512", "matches"]
                .iter()
                .any(|key| !row.contains_key(*key))
            || file["index"].as_u64() != Some(index as u64)
            || file["bytes"].as_u64() != Some(bytes.len() as u64)
            || !hex(sha256, 64)
            || sha256 != *version
            || !hex(sha512, 128)
            || sha512 != format!("{:x}", Sha512::digest(bytes))
        {
            return Err(invalid());
        }
        let expected = expected.trim();
        if !expected.is_empty() && !expected.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(invalid());
        }
        let matches = if expected.is_empty() {
            Value::Null
        } else if expected.len() == 64 {
            json!(expected.eq_ignore_ascii_case(sha256))
        } else if expected.len() == 128 {
            json!(expected.eq_ignore_ascii_case(sha512))
        } else {
            return Err(invalid());
        };
        if file["matches"] != matches {
            return Err(invalid());
        }
    }
    Ok(None)
}

#[cfg(test)]
#[path = "plugin_resource_file_digest_tests.rs"]
mod tests;

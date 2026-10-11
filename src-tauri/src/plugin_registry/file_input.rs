//! Inert discovery hints. Filename matching is never file access authorization.
use super::PluginManifest;
use serde_json::Value;

pub(crate) const PROFILE: &str = "file.input.hints.v1";

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    for cap in manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(hint) = cap.get("fileInput") else {
            continue;
        };
        if manifest.schema_version != 2 || manifest.required_profiles.get(PROFILE).is_none() {
            return Err("fileInput requires schemaVersion 2 and file.input.hints.v1".into());
        }
        super::profile_compatibility::validate(manifest)?;
        let fields = hint.as_object().ok_or("Invalid fileInput hints")?;
        if fields.len() != 1 {
            return Err("fileInput requires either extensions or anyFile".into());
        }
        if hint.get("anyFile") == Some(&Value::Bool(true)) {
            continue;
        }
        let extensions = hint
            .get("extensions")
            .and_then(Value::as_array)
            .ok_or("Invalid fileInput extensions")?;
        let mut seen = std::collections::HashSet::new();
        if extensions.is_empty()
            || extensions.len() > 32
            || extensions.iter().any(|v| {
                let Some(s) = v.as_str() else { return true };
                !valid_extension(s) || !seen.insert(s)
            })
        {
            return Err("Invalid fileInput extensions".into());
        }
    }
    Ok(())
}

fn valid_extension(s: &str) -> bool {
    s.len() >= 2
        && s.len() <= 32
        && s.starts_with('.')
        && s[1..].split('.').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
}

pub(super) fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 1024
        && name != "."
        && name != ".."
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '/' | '\\' | ':'))
}

/// None is legacy/undeclared, not evidence of compatibility or incompatibility.
pub(super) fn matches(cap: &Value, name: &str) -> Option<bool> {
    let hint = cap.get("fileInput")?;
    if hint.get("anyFile") == Some(&Value::Bool(true)) {
        return Some(true);
    }
    let name = name.to_ascii_lowercase();
    Some(
        hint.get("extensions")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .any(|suffix| name.ends_with(suffix))
            }),
    )
}

#[cfg(test)]
#[path = "file_input_tests.rs"]
mod tests;

//! Versioned, inert discovery metadata. Never changes capability identity or permissions.
use super::PluginManifest;
use serde_json::Value;
use unicode_normalization::UnicodeNormalization;

pub(super) const CATEGORIES: &[&str] = &[
    "text",
    "data",
    "web",
    "code",
    "files",
    "media",
    "system",
    "ai",
    "knowledge",
    "automation",
    "security",
    "other",
];

pub(super) fn normalize(text: &str) -> String {
    text.nfkc().flat_map(char::to_lowercase).collect()
}

fn plain(value: &Value, limit: usize) -> bool {
    value.as_str().is_some_and(|text| {
        !text.trim().is_empty() && text.len() <= limit && !text.chars().any(char::is_control)
    })
}

pub(super) fn validate(manifest: &PluginManifest, capability: &Value) -> Result<(), String> {
    let Some(metadata) = capability.get("directory") else {
        return Ok(());
    };
    if manifest.schema_version != 2
        || manifest
            .required_profiles
            .get("tool.directory.v1")
            .is_none()
    {
        return Err("Directory metadata requires schemaVersion 2 and tool.directory.v1".into());
    }
    let object = metadata.as_object().ok_or("Invalid directory metadata")?;
    if object
        .keys()
        .any(|key| !matches!(key.as_str(), "categoryId" | "aliases" | "description"))
    {
        return Err("Unsupported directory metadata field".into());
    }
    if !metadata
        .get("categoryId")
        .and_then(Value::as_str)
        .is_some_and(|id| CATEGORIES.contains(&id))
    {
        return Err("Invalid directory categoryId".into());
    }
    if metadata
        .get("description")
        .is_some_and(|value| !plain(value, 512))
    {
        return Err("Invalid directory description".into());
    }
    if let Some(aliases) = metadata.get("aliases") {
        let aliases = aliases.as_array().ok_or("Invalid directory aliases")?;
        let mut seen = std::collections::HashSet::new();
        if aliases.len() > 16
            || aliases.iter().any(|value| {
                !plain(value, 128)
                    || !seen.insert(normalize(value.as_str().unwrap()).trim().to_owned())
            })
        {
            return Err("Invalid directory aliases".into());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "directory_metadata_tests.rs"]
mod tests;

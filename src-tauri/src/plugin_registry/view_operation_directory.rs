//! Metadata-only View operations. These never become callable capabilities or Pi tools.
use super::{directory_metadata, PluginManifest};
use serde_json::Value;
use std::collections::HashSet;

const PROFILE: &str = "view.operation.directory.v1";
const MAX_OPERATIONS: usize = 128;

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
}

pub(super) fn validate(manifest: &PluginManifest) -> Result<(), String> {
    let declared = manifest.required_profiles.get(PROFILE).is_some();
    let operations = manifest.contributes.get("viewOperations");
    if !declared && operations.is_none() {
        return Ok(());
    }
    if !declared {
        return Err(format!("viewOperations requires {PROFILE}"));
    }
    let operations = operations
        .and_then(Value::as_array)
        .filter(|items| !items.is_empty() && items.len() <= MAX_OPERATIONS)
        .ok_or("view.operation.directory.v1 requires 1 to 128 viewOperations")?;
    let main_views: HashSet<_> = manifest
        .contributes
        .get("views")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|view| view.get("location").and_then(Value::as_str) == Some("main"))
        .filter_map(|view| view.get("id").and_then(Value::as_str))
        .collect();
    let capabilities: HashSet<_> = manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|capability| capability.get("id").and_then(Value::as_str))
        .collect();
    let mut seen = HashSet::new();
    for operation in operations {
        let object = operation
            .as_object()
            .ok_or("Invalid View operation declaration")?;
        if object.keys().any(|key| {
            !matches!(
                key.as_str(),
                "id" | "title" | "viewId" | "directory" | "sourceToolId"
            )
        }) {
            return Err("Unsupported View operation field".into());
        }
        let id = operation
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| identifier(id))
            .ok_or("Invalid View operation ID")?;
        if !seen.insert(id) || capabilities.contains(id) {
            return Err("Duplicate or executable View operation ID".into());
        }
        if !operation
            .get("title")
            .and_then(Value::as_str)
            .is_some_and(|title| {
                !title.trim().is_empty()
                    && title.len() <= 128
                    && !title.chars().any(char::is_control)
            })
        {
            return Err("Invalid View operation title".into());
        }
        let view_id = operation
            .get("viewId")
            .and_then(Value::as_str)
            .ok_or("View operation is missing viewId")?;
        if !main_views.contains(view_id) {
            return Err("View operation must reference a declared main View".into());
        }
        if operation
            .get("sourceToolId")
            .is_some_and(|source| !source.as_str().is_some_and(identifier))
        {
            return Err("Invalid View operation sourceToolId".into());
        }
        if operation.get("directory").is_none() {
            return Err("View operation is missing directory metadata".into());
        }
        directory_metadata::validate_view_operation(manifest, operation)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "view_operation_directory_tests.rs"]
mod tests;

//! Bounded resource-only JSON path queries and structural comparisons.
pub(crate) const PROFILE: &str = "resource.wasi.json-file-compare.v1";
pub(crate) const PLUGIN: &str = "com.zicode.devtools.compare-json-file";
pub(crate) const MAX_FILE: usize = 1024 * 1024;
pub(crate) const MAX_OUTPUT: usize = 8 * MAX_FILE;
pub(crate) const TIMEOUT_SECS: u64 = 10;
const VERSION: &str = "=1.0.0-preview.1";
const TYPES: [&str; 3] = ["application/octet-stream", "application/json", "text/plain"];
const CAPABILITIES: [&str; 3] = [
    "devtools.compare.json-file.path",
    "devtools.compare.json-file.diff.ordered",
    "devtools.compare.json-file.diff.unordered",
];
pub(crate) const FUEL: u64 = 4_000_000_000;

pub(crate) fn input_count(plugin: &str, capability: Option<&str>) -> Option<usize> {
    if plugin != PLUGIN {
        return None;
    }
    CAPABILITIES
        .iter()
        .position(|id| Some(*id) == capability)
        .map(|index| if index == 0 { 1 } else { 2 })
}

pub(crate) fn accepts_mime(mime: &str) -> bool {
    TYPES.contains(&mime)
}

pub(crate) fn validate_manifest(
    manifest: &crate::plugin_registry::PluginManifest,
) -> Result<(), String> {
    use serde_json::Value;
    let Some(version) = manifest.required_profiles.get(PROFILE) else {
        return Ok(());
    };
    let invalid = || "Invalid JSON file compare profile declaration".to_owned();
    let caps = manifest.contributes["capabilities"]
        .as_array()
        .ok_or_else(invalid)?;
    if manifest.id != PLUGIN
        || version.as_str() != Some(VERSION)
        || manifest.schema_version != 2
        || caps.len() != CAPABILITIES.len()
        || manifest.runtime["wasi"].as_str().is_none()
        || manifest.runtime["resourceInputProfile"] != "resource.wasi.input.draft2"
        || manifest.runtime["resourceOutputProfile"] != "resource.wasi.output.draft1"
        || ![
            "resource.input.types.v1",
            "resource.output.types.v1",
            "output.schema.v1",
            "tool.directory.v1",
        ]
        .into_iter()
        .all(|profile| manifest.required_profiles.get(profile).is_some())
        || !manifest
            .permissions
            .required
            .iter()
            .any(|permission| permission.name == "resource.read")
        || ["piTools", "commands", "views"].into_iter().any(|key| {
            manifest.contributes[key]
                .as_array()
                .is_some_and(|items| !items.is_empty())
        })
    {
        return Err(invalid());
    }
    for id in CAPABILITIES {
        let cap = caps
            .iter()
            .find(|cap| cap["id"] == id)
            .ok_or_else(invalid)?;
        let count = input_count(&manifest.id, Some(id)).ok_or_else(invalid)? as u64;
        let types = cap["resourceInputMimeTypes"]
            .as_array()
            .ok_or_else(invalid)?;
        if cap["executionProfile"] != PROFILE
            || !cap["outputSchema"].is_object()
            || (count == 1
                && (cap.get("resourceInputMin").is_some() || cap.get("resourceInputMax").is_some()))
            || (count == 2
                && (cap["resourceInputMin"].as_u64() != Some(count)
                    || cap["resourceInputMax"].as_u64() != Some(count)))
            || types.len() != TYPES.len()
            || !TYPES
                .iter()
                .all(|mime| types.iter().any(|value| value.as_str() == Some(mime)))
            || cap["resourceInputProfile"]
                .as_str()
                .is_some_and(|value| value != "resource.wasi.input.draft2")
            || cap["maxResultBytes"]
                .as_u64()
                .is_none_or(|size| size > 8192)
            || !cap.get("directory").is_some_and(Value::is_object)
        {
            return Err(invalid());
        }
    }
    Ok(())
}

pub(crate) fn validate_output(
    bundle: &crate::plugin_worker::resource_output::Bundle,
    source_bytes: &[&[u8]],
    capability: &str,
) -> Result<(), &'static str> {
    let invalid = "invalid_output";
    if bundle.result["ok"] == false {
        let error = bundle.result["error"]["code"].as_str();
        if bundle.resources.is_empty()
            && matches!(
                error,
                Some(
                    "INVALID_REQUEST"
                        | "INPUT_TOO_LARGE"
                        | "INVALID_UTF8"
                        | "INVALID_JSON_OR_QUERY"
                        | "RESULT_TOO_LARGE"
                        | "RESOURCE_READ_FAILED"
                        | "OUTPUT_FAILED"
                )
            )
        {
            return Ok(());
        }
        return Err(invalid);
    }
    let [blob] = bundle.resources.as_slice() else {
        return Err(invalid);
    };
    let count = input_count(PLUGIN, Some(capability)).ok_or(invalid)?;
    let lengths = bundle.result["sourceByteCounts"]
        .as_array()
        .ok_or(invalid)?;
    if bundle.result["ok"] != true
        || blob.mime_type != crate::plugin_output_types::JSON
        || blob.bytes.len() > MAX_OUTPUT
        || bundle.result["outputByteCount"].as_u64() != Some(blob.bytes.len() as u64)
        || count != source_bytes.len()
        || lengths.len() != source_bytes.len()
        || !lengths
            .iter()
            .zip(source_bytes)
            .all(|(length, bytes)| length.as_u64() == Some(bytes.len() as u64))
    {
        return Err(invalid);
    }
    let value = parse_output(&blob.bytes).ok_or(invalid)?;
    if count == 1 {
        return value
            .as_array()
            .filter(|rows| rows.len() <= 10_000)
            .map(|_| ())
            .ok_or(invalid);
    }
    let changes = value["changes"].as_array().ok_or(invalid)?;
    let order = if capability == CAPABILITIES[1] {
        "by index"
    } else {
        "ignored (duplicates retained)"
    };
    if value.as_object().is_none_or(|object| object.len() != 3)
        || value["arrayOrder"] != order
        || value["equal"].as_bool() != Some(changes.is_empty())
        || changes.len() > 10_000
        || changes.iter().any(|change| {
            let valid_path = change["path"]
                .as_str()
                .is_some_and(|path| path.is_empty() || path.starts_with('/'));
            let Some(object) = change.as_object() else {
                return true;
            };
            !valid_path
                || match change["kind"].as_str() {
                    Some("changed") => {
                        object.len() != 4
                            || !object.contains_key("before")
                            || !object.contains_key("after")
                    }
                    Some("added") => object.len() != 3 || !object.contains_key("after"),
                    Some("removed") => object.len() != 3 || !object.contains_key("before"),
                    _ => true,
                }
        })
    {
        return Err(invalid);
    }
    Ok(())
}

fn parse_output(bytes: &[u8]) -> Option<serde_json::Value> {
    use serde::Deserialize;
    // Inputs allow 127 nested arrays or objects. A diff adds three wrappers:
    // the report, its changes array, and the change record.
    const MAX_DEPTH: usize = 130;
    let mut depth = 0usize;
    let mut inside_string = false;
    let mut escaped = false;
    for byte in bytes {
        if inside_string {
            if escaped {
                escaped = false;
            } else {
                match byte {
                    b'\\' => escaped = true,
                    b'"' => inside_string = false,
                    _ => {}
                }
            }
        } else {
            match byte {
                b'"' => inside_string = true,
                b'[' | b'{' => {
                    depth += 1;
                    if depth > MAX_DEPTH {
                        return None;
                    }
                }
                b']' | b'}' => depth = depth.checked_sub(1)?,
                _ => {}
            }
        }
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    deserializer.disable_recursion_limit();
    let value = serde_json::Value::deserialize(&mut deserializer).ok()?;
    deserializer.end().ok()?;
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::parse_output;

    #[test]
    fn json_file_output_preserves_allowed_input_depth_and_rejects_unbounded_nesting() {
        let nested = |depth: usize| format!("{}0{}", "[".repeat(depth), "]".repeat(depth));
        assert!(parse_output(nested(130).as_bytes()).is_some());
        assert!(parse_output(nested(131).as_bytes()).is_none());
        let brackets = "[{".repeat(200) + "\"}]";
        assert!(parse_output(&serde_json::to_vec(&brackets).unwrap()).is_some());
        assert!(parse_output(br#""\uD800""#).is_none());
        assert!(parse_output(b"[{}] {}").is_none());
    }
}

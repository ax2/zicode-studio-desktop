//! Explicit resource-only JSON formatting, minification and validation.
pub(crate) const PROFILE: &str = "resource.wasi.json-file-transform.v1";
pub(crate) const PLUGIN: &str = "com.zicode.devtools.json-file";
pub(crate) use super::json_compare::{MAX_FILE, MAX_OUTPUT};
const VERSION: &str = "=1.0.0-preview.1";
const TYPES: [&str; 3] = ["application/octet-stream", "application/json", "text/plain"];
const CAPABILITIES: [&str; 3] = [
    "devtools.json-file.format",
    "devtools.json-file.minify",
    "devtools.json-file.validate",
];

pub(crate) fn input_count(plugin: &str, capability: Option<&str>) -> Option<usize> {
    if plugin != PLUGIN {
        return None;
    }
    CAPABILITIES
        .iter()
        .position(|id| Some(*id) == capability)
        .map(|_| 1)
}

pub(crate) fn validate_manifest(
    manifest: &crate::plugin_registry::PluginManifest,
) -> Result<(), String> {
    use serde_json::Value;
    let Some(version) = manifest.required_profiles.get(PROFILE) else {
        return Ok(());
    };
    let invalid = || "Invalid JSON file transform profile declaration".to_owned();
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
        let types = cap["resourceInputMimeTypes"]
            .as_array()
            .ok_or_else(invalid)?;
        if cap["executionProfile"] != PROFILE
            || !cap["outputSchema"].is_object()
            || cap.get("resourceInputMin").is_some()
            || cap.get("resourceInputMax").is_some()
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

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn validate_output(
    bundle: &crate::plugin_worker::resource_output::Bundle,
    source_bytes: &[&[u8]],
    capability: &str,
) -> Result<(), &'static str> {
    let invalid = "invalid_output";
    if input_count(PLUGIN, Some(capability)) != Some(1) {
        return Err(invalid);
    }
    if bundle.result["ok"] == false {
        return if bundle.resources.is_empty()
            && matches!(
                bundle.result["error"]["code"].as_str(),
                Some(
                    "INVALID_REQUEST"
                        | "INPUT_TOO_LARGE"
                        | "INVALID_UTF8"
                        | "INVALID_JSON"
                        | "JSON_POLICY_REJECTED"
                        | "RESULT_TOO_LARGE"
                        | "RESOURCE_READ_FAILED"
                        | "OUTPUT_FAILED"
                )
            ) {
            Ok(())
        } else {
            Err(invalid)
        };
    }
    let [source] = source_bytes else {
        return Err(invalid);
    };
    let [blob] = bundle.resources.as_slice() else {
        return Err(invalid);
    };
    if bundle.result["ok"] != true
        || bundle.result["schemaVersion"] != 1
        || bundle.result["material"] != "json-file-result"
        || bundle.result["sourceByteCounts"] != serde_json::json!([source.len()])
        || bundle.result["outputByteCount"].as_u64() != Some(blob.bytes.len() as u64)
        || blob.mime_type != crate::plugin_output_types::JSON
        || blob.bytes.len() > MAX_OUTPUT
        || source.len() > MAX_FILE
    {
        return Err(invalid);
    }
    let text = std::str::from_utf8(source).map_err(|_| invalid)?;
    if !crate::plugin_json_file_numbers::lossless_numbers(text) {
        return Err(invalid);
    }
    let source = crate::plugin_json_decode::parse(source).map_err(|_| invalid)?;
    let output_text = std::str::from_utf8(&blob.bytes).map_err(|_| invalid)?;
    if !crate::plugin_json_file_numbers::lossless_numbers(output_text) {
        return Err(invalid);
    }
    let output = crate::plugin_json_decode::parse(&blob.bytes).map_err(|_| invalid)?;
    if capability == CAPABILITIES[2] {
        return if output == serde_json::json!({"valid":true}) {
            Ok(())
        } else {
            Err(invalid)
        };
    }
    if source == output {
        Ok(())
    } else {
        Err(invalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_worker::resource_output::{Blob, Bundle, Profile};
    fn bundle(source: &[u8], output: &[u8]) -> Bundle {
        Bundle {
            profile: Profile::JsonCompare1,
            binary: true,
            result: serde_json::json!({"ok":true,"schemaVersion":1,"material":"json-file-result",
                "sourceByteCounts":[source.len()],"outputByteCount":output.len()}),
            resources: vec![Blob {
                mime_type: "application/json".into(),
                bytes: output.to_vec(),
            }],
        }
    }
    #[test]
    fn json_transform_host_rejects_false_validation_and_lossy_result() {
        for source in [
            b"{".as_slice(),
            br#"{"x":1,"\u0078":2}"#,
            b"18446744073709551616",
            b"0.123456789012345678901234567890",
        ] {
            assert!(
                validate_output(
                    &bundle(source, br#"{"valid":true}"#),
                    &[source],
                    CAPABILITIES[2]
                )
                .is_err()
            );
        }
        assert!(
            validate_output(
                &bundle(b"0.1", b"0.100000000000000000001"),
                &[b"0.1"],
                CAPABILITIES[1]
            )
            .is_err()
        );
        assert!(validate_output(&bundle(b"0.125", b"0.125"), &[b"0.125"], CAPABILITIES[1]).is_ok());
        assert!(
            validate_output(
                &bundle(b"0.125", br#"{"valid":true}"#),
                &[b"0.125"],
                CAPABILITIES[2]
            )
            .is_ok()
        );
    }
}

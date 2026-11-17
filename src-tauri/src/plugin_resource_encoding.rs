//! Opt-in full-file encoding operations with a fixed scope and a bounded Worker budget.
use crate::plugin_registry::PluginManifest;
use crate::plugin_worker::resource_output::{Blob, Bundle};
use serde_json::{json, Value};

pub(crate) const PROFILE: &str = "resource.wasi.encoding-inspect.v1";
pub(crate) const CONVERT_PROFILE: &str = "resource.wasi.encoding-utf8.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.1";
pub(crate) const PLUGIN: &str = "com.zicode.devtools.encoding";
pub(crate) const CAPABILITY: &str = "devtools.encoding.inspect";
pub(crate) const MAX_BYTES: usize = 8 * 1024 * 1024;
pub(crate) const LEGACY_MAX_BYTES: usize = 128 * 1024;
pub(crate) const MEMORY_MIB: usize = 64;
pub(crate) const TIMEOUT_SECS: u64 = 15;
const INSPECT_FUEL: u64 = 64_000_000_000;
const CONVERT_FUEL: u64 = 8_000_000_000;
const MAX_OUTPUT_BYTES: usize = 16 * 1024 * 1024;
const CONVERT_CAPABILITY: &str = "devtools.encoding.to_utf8";
const CHARSETS: [&str; 7] = [
    "utf8",
    "utf16le",
    "utf16be",
    "gb18030",
    "big5",
    "shiftjis",
    "windows1252",
];

#[derive(Clone, Copy)]
pub(crate) enum Operation {
    Inspect,
    Convert,
}

pub(crate) fn operation(profile: Option<&str>) -> Option<Operation> {
    match profile? {
        PROFILE => Some(Operation::Inspect),
        CONVERT_PROFILE => Some(Operation::Convert),
        _ => None,
    }
}

impl Operation {
    fn capability(self) -> &'static str {
        match self {
            Self::Inspect => CAPABILITY,
            Self::Convert => CONVERT_CAPABILITY,
        }
    }

    pub(crate) fn fuel(self) -> u64 {
        match self {
            Self::Inspect => INSPECT_FUEL,
            Self::Convert => CONVERT_FUEL,
        }
    }

    pub(crate) fn validate_input(
        self,
        plugin: &str,
        capability: Option<&str>,
        lengths: &[usize],
    ) -> Result<(), &'static str> {
        if plugin != PLUGIN || capability != Some(self.capability()) || lengths.len() != 1 {
            return Err("resource_profile_unsupported");
        }
        if lengths[0] > MAX_BYTES {
            return Err("resource_input_too_large");
        }
        Ok(())
    }

    pub(crate) fn validate_output(
        self,
        bundle: &Bundle,
        source_bytes: usize,
        input: &Value,
    ) -> Result<(), &'static str> {
        let valid = match (&bundle.result["ok"], self) {
            (Value::Bool(true), Self::Inspect) => {
                bundle.resources.is_empty()
                    && bundle.result["operation"] == "inspect"
                    && bundle.result["preview"]
                        .as_str()
                        .is_some_and(|preview| preview.chars().count() <= 256)
            }
            (Value::Bool(true), Self::Convert) => validate_conversion(bundle, input),
            (Value::Bool(false), _) => {
                let code = bundle.result["error"]["code"].as_str().unwrap_or_default();
                bundle.resources.is_empty()
                    && (matches!(
                        code,
                        "EMPTY_RESOURCE" | "RESOURCE_READ_FAILED" | "INVALID_REQUEST"
                    ) || matches!(self, Self::Convert)
                        && matches!(code, "OUTPUT_TOO_LARGE" | "DECODE_FAILED" | "ENCODE_FAILED"))
            }
            _ => false,
        };
        let size_matches = bundle.result["ok"] == false
            || (source_bytes > 0
                && bundle.result["sourceByteCount"].as_u64() == Some(source_bytes as u64));
        if valid && size_matches {
            Ok(())
        } else {
            Err("invalid_output")
        }
    }
}

fn validate_conversion(bundle: &Bundle, input: &Value) -> bool {
    let [Blob { mime_type, bytes }] = bundle.resources.as_slice() else {
        return false;
    };
    let report = &bundle.result;
    let bom = input["bom"].as_bool().unwrap_or(false);
    if mime_type != "text/plain"
        || bytes.len() > MAX_OUTPUT_BYTES
        || report["operation"] != "to_utf8"
        || report["targetEncoding"] != "utf8"
        || report["sourceEncoding"] != input["sourceEncoding"]
        || report["bom"] != bom
        || report["outputByteCount"].as_u64() != Some(bytes.len() as u64)
    {
        return false;
    }
    let data = if bom {
        let Some(data) = bytes.strip_prefix(b"\xef\xbb\xbf") else {
            return false;
        };
        data
    } else {
        bytes
    };
    let Ok(text) = std::str::from_utf8(data) else {
        return false;
    };
    let preview = text.chars().take(256).collect::<String>();
    report["preview"].as_str() == Some(preview.as_str())
        && report["characterCount"].as_u64() == Some(text.chars().count() as u64)
}
const MIME_TYPES: [&str; 3] = ["text/plain", "application/octet-stream", "text/csv"];

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    validate_profile(manifest, PROFILE, Operation::Inspect)?;
    validate_profile(manifest, CONVERT_PROFILE, Operation::Convert)
}

fn validate_profile(
    manifest: &PluginManifest,
    profile: &str,
    operation: Operation,
) -> Result<(), String> {
    let selected_caps = manifest.contributes["capabilities"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|cap| cap["executionProfile"].as_str() == Some(profile))
        .collect::<Vec<_>>();
    if selected_caps.is_empty() && manifest.required_profiles.get(profile).is_none() {
        return Ok(());
    }
    let fail = || "Encoding requires the fixed resource contract".to_owned();
    if manifest.schema_version != 2
        || manifest.id != PLUGIN
        || manifest
            .required_profiles
            .get(profile)
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
    let mut schema = cap["inputSchema"].clone();
    let expected = match operation {
        Operation::Inspect => {
            json!({"type":"object","properties":{},"required":[],"additionalProperties":false})
        }
        Operation::Convert => {
            if let Some(properties) = schema["properties"].as_object_mut() {
                for property in properties.values_mut().filter_map(Value::as_object_mut) {
                    property.remove("title");
                }
            }
            json!({"type":"object","properties":{
                "sourceEncoding":{"type":"string","enum":CHARSETS},
                "bom":{"type":"boolean","default":false}
            },"required":["sourceEncoding"],"additionalProperties":false})
        }
    };
    if cap["id"] != operation.capability()
        || schema != expected
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

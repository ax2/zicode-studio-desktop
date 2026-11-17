//! Opt-in full-file encoding operations with a fixed scope and a bounded Worker budget.
use crate::plugin_registry::PluginManifest;
use crate::plugin_worker::resource_output::{Blob, Bundle};
use serde_json::{json, Value};

pub(crate) const PROFILE: &str = "resource.wasi.encoding-inspect.v1";
pub(crate) const MULTI_TARGET_PROFILE: &str = "resource.wasi.encoding-convert.v1";
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
    ToUtf8,
    Convert,
}

pub(crate) fn operation(profile: Option<&str>) -> Option<Operation> {
    match profile? {
        PROFILE => Some(Operation::Inspect),
        CONVERT_PROFILE => Some(Operation::ToUtf8),
        MULTI_TARGET_PROFILE => Some(Operation::Convert),
        _ => None,
    }
}

impl Operation {
    fn capability(self) -> &'static str {
        match self {
            Self::Inspect => CAPABILITY,
            Self::ToUtf8 => CONVERT_CAPABILITY,
            Self::Convert => "devtools.encoding.convert",
        }
    }

    pub(crate) fn fuel(self) -> u64 {
        match self {
            Self::Inspect => INSPECT_FUEL,
            Self::ToUtf8 | Self::Convert => CONVERT_FUEL,
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
            (Value::Bool(true), Self::ToUtf8 | Self::Convert) => {
                self.validate_conversion(bundle, input)
            }
            (Value::Bool(false), _) => {
                let code = bundle.result["error"]["code"].as_str().unwrap_or_default();
                bundle.resources.is_empty()
                    && (matches!(
                        code,
                        "EMPTY_RESOURCE" | "RESOURCE_READ_FAILED" | "INVALID_REQUEST"
                    ) || matches!(self, Self::ToUtf8 | Self::Convert)
                        && matches!(
                            code,
                            "OUTPUT_TOO_LARGE" | "DECODE_FAILED" | "ENCODE_FAILED" | "INVALID_BOM"
                        ))
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

    fn validate_conversion(self, bundle: &Bundle, input: &Value) -> bool {
        let [Blob { mime_type, bytes }] = bundle.resources.as_slice() else {
            return false;
        };
        let report = &bundle.result;
        let bom = input["bom"].as_bool().unwrap_or(false);
        let (operation, target) = match self {
            Self::ToUtf8 => ("to_utf8", "utf8"),
            Self::Convert => (
                "convert",
                input["targetEncoding"].as_str().unwrap_or_default(),
            ),
            Self::Inspect => return false,
        };
        let Some((encoding, prefix)) = target_encoding(target) else {
            return false;
        };
        let expected_mime = if encoding == encoding_rs::UTF_8 {
            "text/plain"
        } else {
            crate::plugin_output_types::ENCODED_TEXT
        };
        if mime_type != expected_mime
            || bytes.len() > MAX_OUTPUT_BYTES
            || report["operation"] != operation
            || report["targetEncoding"] != target
            || report["sourceEncoding"] != input["sourceEncoding"]
            || report["bom"] != bom
            || report["outputByteCount"].as_u64() != Some(bytes.len() as u64)
        {
            return false;
        }
        if matches!(self, Self::Convert) {
            use std::fmt::Write;
            let mut hex = String::new();
            for byte in bytes.iter().take(64) {
                write!(hex, "{byte:02x}").expect("writing to String cannot fail");
            }
            if report["bytePreviewHex"].as_str() != Some(hex.as_str()) {
                return false;
            }
        }
        let data = if bom {
            let Some(data) = prefix.and_then(|prefix| bytes.strip_prefix(prefix)) else {
                return false;
            };
            data
        } else {
            if prefix.is_some_and(|prefix| bytes.starts_with(prefix)) {
                return false;
            }
            bytes
        };
        let Some(text) = encoding.decode_without_bom_handling_and_without_replacement(data) else {
            return false;
        };
        let preview = text.chars().take(256).collect::<String>();
        report["preview"].as_str() == Some(preview.as_str())
            && report["characterCount"].as_u64() == Some(text.chars().count() as u64)
    }
}

fn target_encoding(slug: &str) -> Option<(&'static encoding_rs::Encoding, Option<&'static [u8]>)> {
    use encoding_rs::{BIG5, GB18030, SHIFT_JIS, UTF_16BE, UTF_16LE, UTF_8, WINDOWS_1252};
    Some(match slug {
        "utf8" => (UTF_8, Some(b"\xef\xbb\xbf")),
        "utf16le" => (UTF_16LE, Some(b"\xff\xfe")),
        "utf16be" => (UTF_16BE, Some(b"\xfe\xff")),
        "gb18030" => (GB18030, None),
        "big5" => (BIG5, None),
        "shiftjis" => (SHIFT_JIS, None),
        "windows1252" => (WINDOWS_1252, None),
        _ => return None,
    })
}

const MIME_TYPES: [&str; 3] = ["text/plain", "application/octet-stream", "text/csv"];

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    validate_profile(manifest, PROFILE, Operation::Inspect)?;
    validate_profile(manifest, CONVERT_PROFILE, Operation::ToUtf8)?;
    validate_profile(manifest, MULTI_TARGET_PROFILE, Operation::Convert)
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
        Operation::ToUtf8 | Operation::Convert => {
            if let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut) {
                for property in properties.values_mut().filter_map(Value::as_object_mut) {
                    property.remove("title");
                }
            }
            let mut expected = json!({"type":"object","properties":{
                "sourceEncoding":{"type":"string","enum":CHARSETS},
                "bom":{"type":"boolean","default":false}
            },"required":["sourceEncoding"],"additionalProperties":false});
            if matches!(operation, Operation::Convert) {
                expected["properties"]["targetEncoding"] = json!({"type":"string","enum":CHARSETS});
                expected["required"] = json!(["sourceEncoding", "targetEncoding"]);
            }
            expected
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
        || (matches!(operation, Operation::Convert)
            && manifest
                .required_profiles
                .get("resource.output.types.v1")
                .is_none())
    {
        return Err(fail());
    }
    Ok(())
}

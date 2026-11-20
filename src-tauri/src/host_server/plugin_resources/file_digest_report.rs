//! Host-owned report metadata for validated file digest results.
use super::*;

// Both receipt-verified Files 0.1.0 candidates contain this module. Their
// catalogs declare source tool `files` version 1.2.0. The package version
// alone would not identify a candidate or prove its source tool version.
const FILES_012_MODULE_SHA256: &str =
    "5ad444f573c238b5f22b92d18b6f16543ba5ebdf5435a36172c512794bbd9f4d";

const FILES_STREAM_MODULE_SHA256: &str =
    "9b69130fa4b9445c17faee3d1a92ebd263c125d221a8ccd7e81e4d0cab9867ce";

pub(super) fn safe_file_name(name: &str) -> Option<&str> {
    (!name.is_empty() && name.chars().take(256).count() <= 255 && !name.chars().any(|ch| {
        ch.is_control()
            || matches!(ch, '/' | '\\' | ':' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
    }) && !matches!(name, "." | ".."))
    .then_some(name)
}

pub(super) fn provenance(owner: &Owner, package_version: &str, module: &[u8]) -> Value {
    let tool_version = if file_reference::is_source(owner)
        && match package_version {
            "0.1.0" => sha256_hex(module) == FILES_012_MODULE_SHA256,
            "0.2.0" => sha256_hex(module) == FILES_STREAM_MODULE_SHA256,
            _ => false,
        }
    {
        Some("1.2.0")
    } else {
        None
    };
    let app_version = env!("CARGO_PKG_VERSION");
    let os = std::env::consts::OS;
    let architecture = std::env::consts::ARCH;
    let build_profile = if cfg!(debug_assertions) {
        "debug"
    } else {
        "release"
    };
    let version = sha256_hex(format!("ZiDevTools runtime environment v1\0{app_version}\0{os}\0{architecture}\0{build_profile}").as_bytes());
    json!({"toolId":"files","toolVersion":tool_version,
        "runtimeFingerprint":{"schema":1,"appVersion":app_version,"os":os,
            "architecture":architecture,"buildProfile":build_profile,"sha256":version}})
}

pub(super) fn material(
    verified_result: &Value,
    expected: &str,
    names: &[Option<String>],
    generated_by: Value,
    package_version: &str,
) -> Result<Value, ApiError> {
    let mut report = verified_result.clone();
    let files = report["files"]
        .as_array_mut()
        .ok_or_else(|| rejected("invalid_output"))?;
    if files.len() != names.len() {
        return Err(rejected("invalid_output"));
    }
    for (row, name) in files.iter_mut().zip(names) {
        row["name"] = name
            .as_deref()
            .and_then(safe_file_name)
            .map_or(Value::Null, |name| json!(name));
    }
    report["generatedBy"] = generated_by;
    report["packageVersion"] = json!(package_version);
    let expected = expected.trim();
    report["comparison"] = match expected.len() {
        64 if expected.bytes().all(|ch| ch.is_ascii_hexdigit()) => {
            json!({"algorithm":"SHA-256","expected":expected.to_ascii_lowercase()})
        }
        128 if expected.bytes().all(|ch| ch.is_ascii_hexdigit()) => {
            json!({"algorithm":"SHA-512","expected":expected.to_ascii_lowercase()})
        }
        0 => Value::Null,
        _ => return Err(rejected("invalid_output")),
    };
    Ok(report)
}

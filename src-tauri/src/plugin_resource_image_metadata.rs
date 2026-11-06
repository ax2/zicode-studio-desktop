//! Explicit image-metadata execution contract; it does not enlarge any legacy profile.
use crate::plugin_worker::resource_output::{Bundle, Profile};
use serde_json::{Map, Value};
pub(crate) const PROFILE: &str = "resource.wasi.image.metadata.v1";
pub(crate) const VERSION: &str = "1.0.0-preview.1";
pub(crate) const MEMORY_MIB: usize = 640;
pub(crate) const FUEL: u64 = 30_000_000_000;
pub(crate) const TIMEOUT_SECS: u64 = 30;
pub(crate) const INSPECT: &str = "devtools.image.metadata.inspect";
pub(crate) const CLEAN: &str = "devtools.image.metadata.clean";
pub(crate) const NOTES: &str = "仅含元数据种类数量和标志，不含路径、GPS坐标或元数据原值。清理会移除ICC并重新编码，请检查颜色、方向和画质。标准块复检不保证不存在未知私有内容。资源尚未保存。";

pub(crate) fn selected(value: Option<&str>) -> bool {
    value == Some(PROFILE)
}

pub(crate) fn validate_declaration(
    schema: u32,
    required: &Map<String, Value>,
    runtime: &Value,
    contributes: &Value,
    resource_read: bool,
) -> Result<(), String> {
    let caps = contributes["capabilities"].as_array();
    let metadata = required.contains_key(PROFILE);
    let output2 = required.contains_key(Profile::METADATA_NAME)
        || runtime["resourceOutputProfile"] == Profile::METADATA_NAME;
    let selected_caps = caps
        .into_iter()
        .flatten()
        .filter(|cap| cap["executionProfile"] == PROFILE)
        .collect::<Vec<_>>();
    if !metadata && !output2 && selected_caps.is_empty() {
        return Ok(());
    }
    let invalid = || {
        "Image metadata requires both exact negotiated profiles, two typed resource capabilities and resource.read".to_string()
    };
    if !metadata
        || !output2
        || schema != 2
        || !resource_read
        || required.get(PROFILE).and_then(Value::as_str) != Some("=1.0.0-preview.1")
        || required.get(Profile::METADATA_NAME).and_then(Value::as_str) != Some("=1.0.0-preview.1")
        || required.get(Profile::METADATA_SAVE).and_then(Value::as_str) != Some("=1.0.0-preview.1")
        || !required.contains_key("output.schema.v1")
        || !required.contains_key("resource.output.types.v1")
        || runtime["wasi"].as_str().is_none()
        || runtime["resourceInputProfile"] != "resource.wasi.input.draft2"
        || runtime["resourceOutputProfile"] != Profile::METADATA_NAME
        || selected_caps.len() != 2
        || caps.is_none_or(|caps| caps.len() != 2)
        || contributes["commands"]
            .as_array()
            .is_some_and(|commands| !commands.is_empty())
    {
        return Err(invalid());
    }
    for id in [INSPECT, CLEAN] {
        let cap = selected_caps
            .iter()
            .find(|cap| cap["id"] == id)
            .ok_or_else(invalid)?;
        // The existing input contract represents exactly one input by omitting multi-input fields.
        if cap.get("resourceInputMax").is_some()
            || cap.get("resourceInputMin").is_some()
            || !cap["outputSchema"].is_object()
            || cap["resourceInputMimeTypes"]
                != serde_json::json!(["image/png", "image/jpeg", "image/webp"])
        {
            return Err(invalid());
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "plugin_resource_image_metadata_tests.rs"]
mod tests;
fn keys(value: &Value, expected: &[&str]) -> Result<(), &'static str> {
    let object = value.as_object().ok_or("invalid_output")?;
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err("invalid_output");
    }
    Ok(())
}
fn hex(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
fn metadata(value: &Value, format: &str, clean: bool) -> Result<(), &'static str> {
    keys(
        value,
        &[
            "format",
            "exif",
            "hasExifGpsDirectory",
            "icc",
            "xmp",
            "text",
            "iptc",
            "other",
            "animation",
            "hasRecognizedMetadata",
        ],
    )?;
    if value["format"] != format
        || value["animation"] != false
        || !value["hasExifGpsDirectory"].is_boolean()
    {
        return Err("invalid_output");
    }
    let mut total = 0u64;
    for key in ["exif", "icc", "xmp", "text", "iptc", "other"] {
        total = total
            .checked_add(
                value[key]
                    .as_u64()
                    .filter(|n| *n <= u32::MAX as u64)
                    .ok_or("invalid_output")?,
            )
            .ok_or("invalid_output")?;
    }
    if value["hasRecognizedMetadata"] != (total > 0)
        || (clean && (total != 0 || value["hasExifGpsDirectory"] != false))
    {
        return Err("invalid_output");
    }
    Ok(())
}

pub(crate) fn validate_outputs(bundle: &Bundle, capability: &str) -> Result<(), &'static str> {
    let value = &bundle.result;
    if bundle.profile != Profile::ImageMetadata2 {
        return Err("invalid_output");
    }
    if value["ok"] == false {
        keys(value, &["ok", "error"])?;
        keys(&value["error"], &["code", "message"])?;
        if !bundle.resources.is_empty() || value["error"]["code"] != "IMAGE_METADATA_FAILED" {
            return Err("invalid_output");
        }
        return Ok(());
    }
    keys(value, &["ok", "operation", "report", "previewIndex"])?;
    let clean = match capability {
        CLEAN => true,
        INSPECT => false,
        _ => return Err("invalid_output"),
    };
    if value["ok"] != true
        || value["operation"] != if clean { "clean" } else { "inspect" }
        || bundle.resources.len() != if clean { 2 } else { 1 }
        || value["previewIndex"] != if clean { 1 } else { 0 }
    {
        return Err("invalid_output");
    }
    let report = &value["report"];
    keys(
        report,
        &[
            "schemaVersion",
            "material",
            "generatedBy",
            "origin",
            "source",
            "cleanedPreview",
            "notes",
        ],
    )?;
    if report["schemaVersion"] != 2
        || report["material"] != "image-metadata-report"
        || report["notes"] != NOTES
    {
        return Err("invalid_output");
    }
    let origin = &report["origin"];
    keys(origin, &["toolId", "version", "utc"])?;
    let provenance = &report["generatedBy"];
    keys(provenance, &["toolId", "toolVersion", "runtimeFingerprint"])?;
    let valid_version = |value: &Value| {
        value.as_str().is_some_and(|s| {
            s.len() <= 32
                && semver::Version::parse(s).is_ok_and(|v| v.pre.is_empty() && v.build.is_empty())
        })
    };
    if origin["toolId"] != "image-metadata"
        || provenance["toolId"] != "image-metadata"
        || !valid_version(&origin["version"])
        || origin["version"] != provenance["toolVersion"]
        || origin["utc"]
            .as_str()
            .is_none_or(|s| s.len() > 32 || chrono::DateTime::parse_from_rfc3339(s).is_err())
    {
        return Err("invalid_output");
    }
    let fingerprint = &provenance["runtimeFingerprint"];
    keys(
        fingerprint,
        &[
            "schema",
            "appVersion",
            "os",
            "architecture",
            "buildProfile",
            "sha256",
        ],
    )?;
    if fingerprint["schema"] != 1
        || !valid_version(&fingerprint["appVersion"])
        || fingerprint["os"] != "wasi"
        || fingerprint["architecture"] != "wasm32"
        || !matches!(
            fingerprint["buildProfile"].as_str(),
            Some("release" | "debug")
        )
        || !hex(&fingerprint["sha256"])
    {
        return Err("invalid_output");
    }
    use sha2::{Digest, Sha256};
    let canonical = format!(
        "ZiDevTools runtime environment v1\0{}\0wasi\0wasm32\0{}",
        fingerprint["appVersion"].as_str().ok_or("invalid_output")?,
        fingerprint["buildProfile"]
            .as_str()
            .ok_or("invalid_output")?
    );
    if fingerprint["sha256"] != format!("{:x}", Sha256::digest(canonical)) {
        return Err("invalid_output");
    }
    let source = &report["source"];
    keys(
        source,
        &["bytes", "displayWidth", "displayHeight", "metadata"],
    )?;
    let width = source["displayWidth"].as_u64().ok_or("invalid_output")?;
    let height = source["displayHeight"].as_u64().ok_or("invalid_output")?;
    if width == 0
        || height == 0
        || width > 12000
        || height > 12000
        || width * height > 16_000_000
        || source["bytes"]
            .as_u64()
            .is_none_or(|n| n == 0 || n > 32 * 1024 * 1024)
    {
        return Err("invalid_output");
    }
    let (format, mime) = match source["metadata"]["format"].as_str() {
        Some("PNG") => ("PNG", "image/png"),
        Some("JPEG") => ("JPEG", "image/jpeg"),
        Some("WebP") => ("WebP", "image/webp"),
        _ => return Err("invalid_output"),
    };
    metadata(&source["metadata"], format, false)?;
    let image_dimensions =
        |blob: &crate::plugin_worker::resource_output::Blob| -> Result<(u32, u32), &'static str> {
            let mut reader = image::ImageReader::new(std::io::Cursor::new(&blob.bytes))
                .with_guessed_format()
                .map_err(|_| "invalid_output")?;
            if reader.format().map(|format| format.to_mime_type()) != Some(blob.mime_type.as_str())
            {
                return Err("invalid_output");
            }
            let mut limits = image::Limits::default();
            limits.max_image_width = Some(12000);
            limits.max_image_height = Some(12000);
            limits.max_alloc = Some(192 * 1024 * 1024);
            reader.limits(limits);
            reader.into_dimensions().map_err(|_| "invalid_output")
        };
    if clean {
        let preview = &report["cleanedPreview"];
        keys(
            preview,
            &["bytes", "metadata", "jpegQuality", "kind", "saved"],
        )?;
        let blob = &bundle.resources[0];
        metadata(&preview["metadata"], format, true)?;
        if blob.mime_type != mime
            || blob.bytes.is_empty()
            || blob.bytes.len() > 128 * 1024 * 1024
            || preview["bytes"] != blob.bytes.len()
            || preview["kind"] != "encoded-preview"
            || !preview["saved"].is_null()
            || image_dimensions(blob) != (Ok((width as u32, height as u32)))
        {
            return Err("invalid_output");
        }
        if if mime == "image/jpeg" {
            preview["jpegQuality"]
                .as_u64()
                .is_none_or(|n| !(35..=95).contains(&n))
        } else {
            !preview["jpegQuality"].is_null()
        } {
            return Err("invalid_output");
        }
    } else if !report["cleanedPreview"].is_null() {
        return Err("invalid_output");
    }
    let thumb = bundle.resources.last().ok_or("invalid_output")?;
    let (w, h) = image_dimensions(thumb)?;
    if thumb.mime_type != "image/png"
        || thumb.bytes.is_empty()
        || thumb.bytes.len() > 2 * 1024 * 1024
        || w == 0
        || h == 0
        || w > 640
        || h > 640
    {
        return Err("invalid_output");
    }
    Ok(())
}

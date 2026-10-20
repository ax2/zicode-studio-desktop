//! Fixed execution budgets for explicitly negotiated resource capabilities.
pub(crate) const IMAGE_RESIZE_PROFILE: &str = "resource.wasi.image.resize.v1";
pub(crate) const IMAGE_RESIZE_PROFILE_VERSION: &str = "1.0.0-preview.1";
pub(crate) const IMAGE_RESIZE_MEMORY_MIB: usize = 256;
pub(crate) const IMAGE_RESIZE_FUEL: u64 = 30_000_000_000;
pub(crate) const IMAGE_RESIZE_TIMEOUT_SECS: u64 = 10;
pub(crate) const IMAGE_RESIZE_RESERVED_MIB_PER_CALL: usize = 512;
pub(crate) const IMAGE_RESIZE_MEMORY_BUDGET_MIB: usize = 1024;
pub(crate) const IMAGE_RESIZE_MAX_CALLS: usize =
    IMAGE_RESIZE_MEMORY_BUDGET_MIB / IMAGE_RESIZE_RESERVED_MIB_PER_CALL;
pub(crate) const IMAGE_RESIZE_PLUGIN_CALLS: usize = 1;
pub(crate) const IMAGE_RESIZE_MAX_RESOURCE_BYTES: usize = 32 * 1024 * 1024;

pub(crate) const IMAGE_MIME_TYPES: [&str; 3] = ["image/png", "image/jpeg", "image/webp"];

/// Host-owned, cross-platform receiver contract. This profile is only enabled for the
/// built-in image inspector; manifest text alone never grants a Host implementation.
pub(crate) const HOST_IMAGE_INPUT_PROFILE: &str = "resource.host.image-input.v1";
pub(crate) const HOST_IMAGE_INPUT_PROFILE_VERSION: &str = "1.0.0-preview.1";
pub(crate) const HOST_IMAGE_INSPECTOR_PLUGIN_ID: &str = "com.zicode.resource-inspector";
pub(crate) const HOST_IMAGE_INSPECTOR_CAPABILITY_ID: &str = "image.inspect";
pub(crate) const HOST_OCR_PLUGIN_ID: &str = "com.zicode.ocr";
pub(crate) const HOST_OCR_CAPABILITY_ID: &str = "ocr.resource-text";
pub(crate) const HOST_OCR_INPUT_PROFILE: &str = "resource.host.ocr-input.v1";
pub(crate) const HOST_TEXT_INSPECTOR_PLUGIN_ID: &str = "com.zicode.text-inspector";
pub(crate) const HOST_TEXT_INSPECTOR_CAPABILITY_ID: &str = "text.inspect";
pub(crate) const HOST_TEXT_INPUT_PROFILE: &str = "resource.host.text-input.v1";
pub(crate) const HOST_TEXT_MAX_BYTES: usize = 32 * 1024 * 1024;
const HOST_TEXT_PREVIEW_CHARS: usize = 4096;
pub(crate) const HOST_IMAGE_MAX_BYTES: usize = 20 * 1024 * 1024;
pub(crate) const HOST_IMAGE_MAX_DIMENSION: u32 = 20_000;

pub(crate) fn inspect_text(
    bytes: &[u8],
    mime_type: &str,
) -> Result<serde_json::Value, &'static str> {
    if mime_type != "text/plain" || bytes.len() > HOST_TEXT_MAX_BYTES {
        return Err("resource_input_invalid");
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "resource_input_invalid")?;
    let mut count = 0usize;
    let mut preview = String::new();
    for character in text.chars() {
        if count < HOST_TEXT_PREVIEW_CHARS {
            preview.push(character);
        }
        count += 1;
    }
    Ok(serde_json::json!({
        "ok": true,
        "mimeType": mime_type,
        "byteLength": bytes.len(),
        "charCount": count,
        "text": preview,
        "truncated": count > HOST_TEXT_PREVIEW_CHARS
    }))
}

pub(crate) fn inspect_image(
    bytes: &[u8],
    mime_type: &str,
) -> Result<serde_json::Value, &'static str> {
    if bytes.is_empty() || bytes.len() > HOST_IMAGE_MAX_BYTES {
        return Err("resource_input_invalid");
    }
    let format = match mime_type {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => return Err("resource_input_invalid"),
    };
    let mut reader = image::ImageReader::with_format(std::io::Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(HOST_IMAGE_MAX_DIMENSION);
    limits.max_image_height = Some(HOST_IMAGE_MAX_DIMENSION);
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "resource_input_invalid")?;
    let (width, height) = (image.width(), image.height());
    if width == 0
        || height == 0
        || width > HOST_IMAGE_MAX_DIMENSION
        || height > HOST_IMAGE_MAX_DIMENSION
    {
        return Err("resource_input_invalid");
    }
    Ok(serde_json::json!({
        "ok": true,
        "mimeType": mime_type,
        "format": match format { image::ImageFormat::Png => "png", image::ImageFormat::Jpeg => "jpeg", image::ImageFormat::WebP => "webp", _ => unreachable!() },
        "width": width,
        "height": height,
        "byteLength": bytes.len()
    }))
}

pub(crate) fn is_image_resize_profile(profile: Option<&str>) -> bool {
    profile == Some(IMAGE_RESIZE_PROFILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_resize_profile_identifier_is_explicit() {
        assert!(is_image_resize_profile(Some(IMAGE_RESIZE_PROFILE)));
        assert!(!is_image_resize_profile(Some("resource.wasi.input.draft2")));
        assert!(!is_image_resize_profile(None));
    }

    #[test]
    fn host_image_inspector_accepts_only_bounded_matching_image_resources() {
        let mut bytes = Vec::new();
        image::DynamicImage::new_rgba8(4, 2)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .unwrap();
        let result = inspect_image(&bytes, "image/png").unwrap();
        assert_eq!(result["width"], 4);
        assert_eq!(result["height"], 2);
        assert_eq!(result["byteLength"], bytes.len());
        assert_eq!(
            inspect_image(&bytes, "image/jpeg"),
            Err("resource_input_invalid")
        );
        assert_eq!(
            inspect_image(&[], "image/png"),
            Err("resource_input_invalid")
        );
        assert_eq!(
            inspect_image(&bytes, "text/plain"),
            Err("resource_input_invalid")
        );
    }

    #[test]
    fn host_text_inspector_bounds_preview_and_rejects_invalid_input() {
        let result = inspect_text("你好, Studio".as_bytes(), "text/plain").unwrap();
        assert_eq!(result["charCount"], 10);
        assert_eq!(result["text"], "你好, Studio");
        assert_eq!(result["truncated"], false);
        let long = "界".repeat(HOST_TEXT_PREVIEW_CHARS + 1);
        let result = inspect_text(long.as_bytes(), "text/plain").unwrap();
        assert_eq!(result["charCount"], HOST_TEXT_PREVIEW_CHARS + 1);
        assert_eq!(
            result["text"].as_str().unwrap().chars().count(),
            HOST_TEXT_PREVIEW_CHARS
        );
        assert_eq!(result["truncated"], true);
        assert_eq!(
            inspect_text(&[0xff], "text/plain"),
            Err("resource_input_invalid")
        );
        assert_eq!(
            inspect_text(b"abc", "image/png"),
            Err("resource_input_invalid")
        );
    }
}

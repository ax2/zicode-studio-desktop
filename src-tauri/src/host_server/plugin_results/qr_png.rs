//! Studio export adapter for the frozen Compute QR response.
use super::Scope;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use std::{io::Cursor, sync::Arc};

const MAX_SIDE: u32 = 1110;
const MAX_PNG_BYTES: usize = 48 * 1024;

pub(super) fn matches(scope: &Scope) -> bool {
    scope.plugin_id == "com.zicode.devtools.compute"
        && scope.capability_id == "devtools.compute.qr.png"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InlinePng<'a> {
    mime_type: &'a str,
    data_url: &'a str,
    width: u32,
    height: u32,
}

pub(super) fn decode(text: &str) -> Option<Arc<[u8]>> {
    let png: InlinePng<'_> = serde_json::from_str(text).ok()?;
    if png.mime_type != "image/png"
        || png.width == 0
        || png.width != png.height
        || png.width > MAX_SIDE
    {
        return None;
    }
    let encoded = png.data_url.strip_prefix("data:image/png;base64,")?;
    if encoded.len() > MAX_PNG_BYTES.div_ceil(3) * 4 {
        return None;
    }
    let bytes = STANDARD.decode(encoded).ok()?;
    let mut reader = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(png.width);
    limits.max_image_height = Some(png.height);
    limits.max_alloc = Some(8 * 1024 * 1024);
    reader.limits(limits);
    let preview = reader.decode().ok()?;
    if preview.width() != png.width || preview.height() != png.height {
        return None;
    }
    Some(bytes.into())
}

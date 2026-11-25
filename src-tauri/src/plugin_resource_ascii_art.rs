//! Output contract for the DevTools image-to-ASCII resource operation.
use crate::plugin_worker::resource_output::Bundle;
use serde_json::Value;

pub(crate) const PROFILE: &str = "resource.wasi.image.ascii.v1";
pub(crate) const PLUGIN_ID: &str = "com.zicode.devtools.ascii-art-image";
pub(crate) const CAPABILITY_ID: &str = "devtools.ascii.image.render";
pub(crate) const MAX_RESOURCE_BYTES: usize = 10 * 1024 * 1024;

pub(crate) fn selected(profile: Option<&str>) -> bool {
    profile == Some(PROFILE)
}

pub(crate) fn validate_output(input: &Value, bundle: &Bundle) -> Result<(), &'static str> {
    const RAMP: &[u8] = b"@%#*+=-:. ";
    let invalid = "invalid_output";
    if bundle.result["ok"].as_bool() == Some(false) && bundle.resources.is_empty() {
        return Ok(());
    }
    let [text] = bundle.resources.as_slice() else {
        return Err(invalid);
    };
    let width = bundle.result["width"].as_u64().ok_or(invalid)?;
    let height = bundle.result["height"].as_u64().ok_or(invalid)?;
    if bundle.result["ok"].as_bool() != Some(true)
        || input["width"].as_u64() != Some(width)
        || !(8..=120).contains(&width)
        || !(1..=120).contains(&height)
        || text.mime_type != "text/plain"
        || bundle.result["byteLength"].as_u64() != Some((width + 1) * height)
        || text.bytes.len() != (width as usize + 1) * height as usize
    {
        return Err(invalid);
    }
    if !text.bytes.chunks_exact(width as usize + 1).all(|row| {
        row.last() == Some(&b'\n') && row[..row.len() - 1].iter().all(|byte| RAMP.contains(byte))
    }) {
        return Err(invalid);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_worker::resource_output::{Blob, Profile};
    use serde_json::json;

    #[test]
    fn ascii_art_output_requires_requested_dimensions_and_plain_ramp_rows() {
        let input = json!({"width": 8});
        let mut bundle = Bundle {
            profile: Profile::Draft1,
            binary: true,
            result: json!({"ok": true, "width": 8, "height": 2, "byteLength": 18}),
            resources: vec![Blob {
                mime_type: "text/plain".into(),
                bytes: b"@%#*+=-:\n........\n".to_vec(),
            }],
        };
        assert!(validate_output(&input, &bundle).is_ok());
        assert!(validate_output(&json!({"width": 9}), &bundle).is_err());
        bundle.resources[0].bytes[8] = b' ';
        assert!(validate_output(&input, &bundle).is_err());
        bundle.resources[0].bytes[8] = b'\n';
        bundle.resources[0].bytes[0] = b'<';
        assert!(validate_output(&input, &bundle).is_err());
        bundle.resources[0].bytes[0] = b'@';
        bundle.resources[0].mime_type = "text/html".into();
        assert!(validate_output(&input, &bundle).is_err());
        bundle.result = json!({"ok": false, "error": {"code": "INVALID_IMAGE"}});
        assert!(validate_output(&input, &bundle).is_err());
        bundle.resources.clear();
        assert!(validate_output(&input, &bundle).is_ok());
    }
}

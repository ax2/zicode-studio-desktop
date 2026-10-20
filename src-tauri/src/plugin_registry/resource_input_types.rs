//! Versioned, exact MIME declarations for capabilities that receive resources.
use super::PluginManifest;
use serde_json::Value;

pub(super) const PROFILE: &str = "resource.input.types.v1";
pub(super) const VERSION: &str = "1.0.0-preview.1";
const FIELD: &str = "resourceInputMimeTypes";
const MAX_TYPES: usize = 32;

pub(super) fn accepts(capability: &Value, mime_type: &str) -> bool {
    capability
        .get(FIELD)
        .and_then(Value::as_array)
        .is_some_and(|types| types.iter().any(|value| value.as_str() == Some(mime_type)))
}

pub(super) fn declared(capability: &Value) -> Option<Vec<String>> {
    capability.get(FIELD)?.as_array().map(|types| {
        types
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    })
}

pub(super) fn valid_mime_type(value: &str) -> bool {
    let Some((kind, subtype)) = value.split_once('/') else {
        return false;
    };
    !kind.is_empty()
        && !subtype.is_empty()
        && !subtype.contains('/')
        && [kind, subtype].iter().all(|part| {
            part.bytes().all(|byte| {
                byte.is_ascii_lowercase()
                    || byte.is_ascii_digit()
                    || matches!(
                        byte,
                        b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                    )
            })
        })
}

pub(super) fn validate(manifest: &PluginManifest) -> Result<(), String> {
    let required = manifest
        .required_profiles
        .get(PROFILE)
        .and_then(Value::as_str);
    let capabilities = manifest
        .contributes
        .get("capabilities")
        .and_then(Value::as_array);
    let mut found = false;
    for capability in capabilities.into_iter().flatten() {
        let declared = capability.get(FIELD);
        let input_profile = capability
            .get("resourceInputProfile")
            .and_then(Value::as_str)
            .or_else(|| {
                manifest
                    .runtime
                    .get("resourceInputProfile")
                    .and_then(Value::as_str)
            });
        if required.is_some()
            && matches!(
                input_profile,
                Some(
                    "resource.wasi.input.draft2"
                        | "resource.host.image-input.v1"
                        | "resource.host.ocr-input.v1"
                        | "resource.host.text-input.v1"
                )
            )
            && declared.is_none()
        {
            return Err(format!("resource receiver capability is missing {FIELD}"));
        }
        let Some(types) = declared else { continue };
        found = true;
        if required.is_none() {
            return Err(format!("{FIELD} requires the {PROFILE} required profile"));
        }
        if !matches!(
            input_profile,
            Some(
                "resource.wasi.input.draft2"
                    | "resource.host.image-input.v1"
                    | "resource.host.ocr-input.v1"
                    | "resource.host.text-input.v1"
            )
        ) {
            return Err(format!(
                "{FIELD} requires a supported resource input profile"
            ));
        }
        let list = types
            .as_array()
            .filter(|list| !list.is_empty() && list.len() <= MAX_TYPES)
            .ok_or_else(|| format!("{FIELD} must contain 1 to {MAX_TYPES} MIME types"))?;
        let mut unique = std::collections::HashSet::new();
        for item in list {
            let mime = item
                .as_str()
                .ok_or_else(|| format!("{FIELD} entries must be strings"))?;
            if !valid_mime_type(mime) || !unique.insert(mime) {
                return Err(format!(
                    "{FIELD} entries must be unique canonical MIME types"
                ));
            }
        }
    }
    if required.is_some() && !found {
        return Err(format!(
            "{PROFILE} requires at least one {FIELD} declaration"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn manifest(types: Value) -> PluginManifest {
        serde_json::from_value(json!({
            "schemaVersion":2,"id":"com.example.receiver","name":"Receiver",
            "description":"Receiver fixture","version":"1.0.0","publisher":"test",
            "requiredProfiles":{"resource.input.types.v1":"=1.0.0-preview.1"},
            "runtime":{"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2"},
            "contributes":{"capabilities":[{"id":"receive","inputSchema":{"type":"object"},"resourceInputMimeTypes":types}]}
        })).unwrap()
    }

    #[test]
    fn accepts_only_exact_canonical_mime_declarations() {
        assert!(validate(&manifest(json!(["image/png", "text/plain"]))).is_ok());
        for types in [
            json!([]),
            json!("image/png"),
            json!(["IMAGE/PNG"]),
            json!(["image/*"]),
            json!(["image/png; charset=utf-8"]),
            json!(["image/png", "image/png"]),
        ] {
            assert!(validate(&manifest(types)).is_err());
        }
    }

    #[test]
    fn exact_filter_never_infers_compatibility() {
        let capability = json!({"resourceInputMimeTypes":["image/png"]});
        assert!(accepts(&capability, "image/png"));
        assert!(!accepts(&capability, "text/plain"));
        assert!(!accepts(&json!({}), "image/png"));
    }
}

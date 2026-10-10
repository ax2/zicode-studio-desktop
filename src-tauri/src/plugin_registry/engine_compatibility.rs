//! Manifest engine ranges are checked before contributions enter the registry.
use semver::{Version, VersionReq};
use serde_json::Value;

const PLUGIN_API_VERSION: &str = "1.0.0";
const MAX_RANGE_BYTES: usize = 256;

pub(super) fn validate(engines: &Value) -> Result<(), String> {
    // Legacy manifests did not require engines. Absence does not declare a profile.
    if engines.is_null() {
        return Ok(());
    }
    let object = engines
        .as_object()
        .ok_or_else(|| "Plugin engines must be an object".to_string())?;
    for (name, value) in object {
        let current = match name.as_str() {
            "zicode" => env!("CARGO_PKG_VERSION"),
            "pluginApi" => PLUGIN_API_VERSION,
            _ => return Err("Unsupported plugin engine requirement".into()),
        };
        let range = value
            .as_str()
            .ok_or_else(|| format!("Invalid {name} engine range"))?;
        if range.trim().is_empty() || range.len() > MAX_RANGE_BYTES {
            return Err(format!("Invalid {name} engine range"));
        }
        let current =
            Version::parse(current).map_err(|_| "Host engine version is invalid".to_string())?;
        if !matches_range(range, &current).map_err(|_| format!("Invalid {name} engine range"))? {
            return Err(format!("Plugin requires an incompatible {name} engine"));
        }
    }
    Ok(())
}

pub(super) fn matches_range(range: &str, current: &Version) -> Result<bool, ()> {
    // Support the documented whitespace intersection plus semver comma syntax.
    // Parse every OR branch, including ones after a match, so malformed declarations fail.
    let mut matched = false;
    for branch in range.split("||") {
        if branch.split(',').any(|part| part.trim().is_empty()) {
            return Err(());
        }
        let normalized = branch
            .split(',')
            .flat_map(str::split_whitespace)
            .collect::<Vec<_>>()
            .join(", ");
        if normalized.is_empty() {
            // VersionReq's empty string is wildcard; an empty branch isn't a declaration.
            return Err(());
        }
        matched |= VersionReq::parse(&normalized)
            .map_err(|_| ())?
            .matches(current);
    }
    Ok(matched)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn accepts_documented_ranges_and_legacy_absence() {
        for engines in [
            Value::Null,
            json!({}),
            json!({"pluginApi":"^1.0.0"}),
            json!({"zicode":">=0.1.0 <1.0.0", "pluginApi":">=1.0.0, <2.0.0"}),
            json!({"pluginApi":"^2.0.0 || ^1.0.0"}),
        ] {
            assert!(validate(&engines).is_ok());
        }
    }

    #[test]
    fn rejects_incompatible_malformed_unknown_and_oversized_declarations() {
        for engines in [
            json!({"pluginApi":"^2.0.0"}),
            json!({"zicode":">=9.0.0"}),
            json!({"pluginApi":""}),
            json!({"pluginApi":7}),
            json!({"pluginApi":"^1.0.0 || invalid"}),
            json!({"pluginApi":"^1.0.0 ||"}),
            json!({"pluginApi":",^1.0.0"}),
            json!({"pluginApi":"x".repeat(257)}),
            json!({"diagnostics":"1.0.0"}),
            json!([]),
        ] {
            assert!(validate(&engines).is_err());
        }
    }

    #[test]
    fn registry_validation_rejects_before_registration_and_accepts_portable_candidates() {
        let mut manifest: super::super::PluginManifest = serde_json::from_value(json!({
            "schemaVersion":1,"id":"com.example.engine","name":"Engine",
            "description":"test","version":"0.1.0","publisher":"example",
            "engines":{"pluginApi":"^2.0.0"}
        }))
        .unwrap();
        assert!(super::super::validate_manifest(&manifest, None).is_err());
        manifest.engines = json!({"pluginApi":"^1.0.0"});
        super::super::validate_manifest(&manifest, None).unwrap();
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures");
        for fixture in ["devtools-text-dev57", "devtools-diagnostics-candidate01"] {
            let package = root.join(fixture);
            super::super::load_manifest(&package).unwrap();
        }
    }
}

//! Explicit profile negotiation. Candidate catalog labels never enable Host APIs.
use super::{engine_compatibility::matches_range, PluginManifest};
use semver::Version;

pub(super) fn validate(manifest: &PluginManifest) -> Result<(), String> {
    match manifest.schema_version {
        1 => {
            if !manifest.required_profiles.is_null() {
                return Err("requiredProfiles requires manifest schemaVersion 2".into());
            }
            return Ok(());
        }
        2 => {}
        _ => {
            return Err(format!(
                "Unsupported plugin schemaVersion {}",
                manifest.schema_version
            ))
        }
    }
    for name in ["zicode", "pluginApi"] {
        if manifest
            .engines
            .get(name)
            .and_then(serde_json::Value::as_str)
            .is_none()
        {
            return Err("Manifest schemaVersion 2 requires both engine ranges".into());
        }
    }
    let requirements = manifest
        .required_profiles
        .as_object()
        .ok_or_else(|| "Manifest schemaVersion 2 requires a requiredProfiles object".to_string())?;
    if requirements.len() > 32 {
        return Err("Too many plugin profile requirements".into());
    }
    for (name, requirement) in requirements {
        if name.is_empty()
            || name.len() > 128
            || !name.bytes().all(|b| {
                b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'_')
            })
        {
            return Err("Invalid plugin profile identifier".into());
        }
        let range = requirement
            .as_str()
            .filter(|s| !s.trim().is_empty() && s.len() <= 256)
            .ok_or_else(|| "Invalid plugin profile range".to_string())?;
        // This is the frozen preview text-compute protocol, not a stable v1 release.
        // Resource draft2 and diagnostics proposal remain unsupported requirements.
        let version = match name.as_str() {
            "compute.wasi.v1" | "output.schema.v1" => {
                Version::parse("1.0.0-rc.1").map_err(|_| "Host profile version is invalid")?
            }
            "tool.directory.v1" | "file.input.hints.v1" => Version::parse("1.0.0-preview.1")
                .map_err(|_| "Host profile version is invalid")?,
            _ => return Err("Required plugin profile is unsupported".into()),
        };
        if !matches_range(range, &version).map_err(|_| "Invalid plugin profile range")? {
            return Err("Required plugin profile version is incompatible".into());
        }
        if name == "compute.wasi.v1"
            && manifest
                .runtime
                .get("wasi")
                .and_then(serde_json::Value::as_str)
                .is_none()
        {
            return Err("compute.wasi.v1 requires a WASI runtime declaration".into());
        }
    }
    if requirements.contains_key("output.schema.v1")
        && !manifest
            .contributes
            .get("capabilities")
            .and_then(serde_json::Value::as_array)
            .is_some_and(|items| {
                items.iter().any(|item| {
                    item.get("outputSchema").is_some() || item.get("maxResultBytes").is_some()
                })
            })
    {
        return Err("output.schema.v1 requires an output contract declaration".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    #[test]
    fn output_profile_requires_a_contract_but_not_a_wasi_runtime() {
        let mut value = manifest(json!({"output.schema.v1":"=1.0.0-rc.1"}));
        value.runtime = json!({});
        assert!(validate(&value).is_err());
        value.contributes = json!({"capabilities":[{"id":"result","inputSchema":{"type":"object"},"outputSchema":{"type":"string"}}]});
        super::super::validate_manifest(&value, None).unwrap();
        value.required_profiles = json!({"output.schema.v1":"^1.0.0"});
        assert!(validate(&value).is_err());
        value.required_profiles = json!({});
        assert!(super::super::validate_manifest(&value, None).is_err());
        value.schema_version = 1;
        value.required_profiles = Value::Null;
        assert!(super::super::validate_manifest(&value, None).is_err());
    }
    fn manifest(profiles: Value) -> PluginManifest {
        serde_json::from_value(json!({"schemaVersion":2,"id":"com.example.profiles",
            "name":"Profiles","description":"fixture","version":"0.1.0","publisher":"example",
            "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
            "runtime":{"wasi":"runtime/tools.wasm"},"requiredProfiles":profiles}))
        .unwrap()
    }
    #[test]
    fn preview_profile_is_explicit_and_not_stable_or_proposal_support() {
        super::super::validate_manifest(&manifest(json!({"compute.wasi.v1":"=1.0.0-rc.1"})), None)
            .unwrap();
        for profiles in [
            json!({"compute.wasi.v1":"^1.0.0"}),
            json!({"diagnostics.compute.wasi.v1.proposal":"*"}),
            json!({"resource.wasi.input.draft2":"*"}),
        ] {
            assert!(super::super::validate_manifest(&manifest(profiles), None).is_err());
        }
    }
    #[test]
    fn required_profiles_cannot_be_silently_added_to_legacy_schema() {
        let mut value = manifest(json!({}));
        value.schema_version = 1;
        assert!(validate(&value).is_err());
        value.required_profiles = Value::Null;
        assert!(validate(&value).is_ok());
        value.schema_version = 3;
        assert!(validate(&value).is_err());
    }
    #[test]
    fn new_schema_rejects_missing_malformed_unbounded_and_non_wasi_requirements() {
        for profiles in [
            Value::Null,
            json!([]),
            json!({"compute.wasi.v1":7}),
            json!({"compute.wasi.v1":""}),
            json!({"compute.wasi.v1":"x".repeat(257)}),
        ] {
            assert!(validate(&manifest(profiles)).is_err());
        }
        let mut value = manifest(json!({}));
        value.engines = json!({"pluginApi":"^1.0.0"});
        assert!(validate(&value).is_err());
        let mut value = manifest(json!({"compute.wasi.v1":"=1.0.0-rc.1"}));
        value.runtime = json!({});
        assert!(validate(&value).is_err());
        let large = (0..33)
            .map(|i| (format!("test.{i}"), json!("*")))
            .collect::<serde_json::Map<_, _>>();
        assert!(validate(&manifest(Value::Object(large))).is_err());
    }
}

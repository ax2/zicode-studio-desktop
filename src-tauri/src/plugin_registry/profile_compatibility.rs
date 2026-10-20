//! Explicit profile negotiation. Candidate catalog labels never enable Host APIs.
use super::{engine_compatibility::matches_range, PluginManifest};
use semver::Version;
use std::collections::BTreeSet;

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
        if matches!(name.as_str(), "tool.open.v1" | "view.operation.directory.v1")
            && range != "=1.0.0-preview.1"
        {
            return Err(format!("{name} requires the exact preview profile version"));
        }
        // These are fixed Host contracts; catalog declarations do not enable them.
        let version = match name.as_str() {
            "compute.wasi.v1" | "output.schema.v1" => {
                Version::parse("1.0.0-rc.1").map_err(|_| "Host profile version is invalid")?
            }
            "tool.directory.v1"
            | "tool.open.v1"
            | "view.operation.directory.v1"
            | "application.directory.v1"
            | "result.json.v1"
            | "file.input.hints.v1"
            | "resource.output.types.v1"
            | "resource.host.input.v1"
            | crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE
            | crate::plugin_registry::resource_input_types::PROFILE
            | "model.catalog.read.v1"
            | "model.generate.v1"
            | "service.http.get.v1" => Version::parse(
                if name == crate::plugin_registry::resource_input_types::PROFILE {
                    crate::plugin_registry::resource_input_types::VERSION
                } else if name == crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE {
                    crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE_VERSION
                } else if name == "resource.host.input.v1" {
                    crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE_VERSION
                } else {
                    "1.0.0-preview.1"
                },
            )
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
    let mut missing = BTreeSet::new();
    if requirements.contains_key("tool.open.v1")
        && (manifest
            .contributes
            .get("views")
            .and_then(serde_json::Value::as_array)
            .is_none_or(|views| views.iter().all(|view| view["location"] != "main"))
            || manifest
                .contributes
                .get("capabilities")
                .and_then(serde_json::Value::as_array)
                .is_none_or(Vec::is_empty))
    {
        return Err("tool.open.v1 requires a main View and declared capabilities".into());
    }
    for activity in manifest
        .contributes
        .get("activities")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        if activity.get("directory").is_some()
            && !requirements.contains_key("application.directory.v1")
        {
            missing.insert("application.directory.v1");
        }
    }
    for capability in manifest
        .contributes
        .get("capabilities")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        for (field, profile) in [
            ("directory", "tool.directory.v1"),
            ("fileInput", "file.input.hints.v1"),
            ("resourceInputMimeTypes", "resource.input.types.v1"),
            ("outputSchema", "output.schema.v1"),
            ("maxResultBytes", "output.schema.v1"),
            ("resultCaptureMimeType", "result.json.v1"),
        ] {
            if capability.get(field).is_some() && !requirements.contains_key(profile) {
                missing.insert(profile);
            }
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "Missing requiredProfiles declarations: {}",
            missing.into_iter().collect::<Vec<_>>().join(", ")
        ));
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
    let json_capabilities = manifest
        .contributes
        .get("capabilities")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|item| item.get("resultCaptureMimeType").is_some())
        .collect::<Vec<_>>();
    if json_capabilities.iter().any(|item| {
        item.get("resultCaptureMimeType")
            .and_then(serde_json::Value::as_str)
            != Some("application/json")
            || item.get("outputSchema").is_none()
    }) {
        return Err("resultCaptureMimeType requires application/json and an outputSchema".into());
    }
    if requirements.contains_key("result.json.v1")
        && (json_capabilities.is_empty()
            || !requirements.contains_key("output.schema.v1")
            || manifest
                .runtime
                .get("wasi")
                .and_then(serde_json::Value::as_str)
                .is_none())
    {
        return Err("result.json.v1 requires a JSON capture capability, output.schema.v1 and a WASI runtime".into());
    }
    if requirements.contains_key("resource.output.types.v1")
        && (!requirements.contains_key("output.schema.v1")
            || manifest
                .runtime
                .get("wasi")
                .and_then(serde_json::Value::as_str)
                .is_none()
            || manifest
                .runtime
                .get("resourceInputProfile")
                .and_then(serde_json::Value::as_str)
                != Some("resource.wasi.input.draft2")
            || manifest
                .runtime
                .get("resourceOutputProfile")
                .and_then(serde_json::Value::as_str)
                != Some(crate::plugin_worker::resource_output::PROFILE))
    {
        return Err("resource.output.types.v1 requires output.schema.v1 and a WASI resource input and output runtime".into());
    }
    if requirements.contains_key("resource.host.input.v1") {
        let host_image_receiver = manifest.id
            == crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID
            && manifest.runtime.get("resourceInputProfile").and_then(serde_json::Value::as_str)
                == Some(crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE)
            && manifest.permissions.required.iter().chain(&manifest.permissions.optional)
                .any(|permission| permission.name == "resource.read")
            && manifest.contributes.get("capabilities").and_then(serde_json::Value::as_array)
                .is_some_and(|capabilities| capabilities.iter().any(|capability|
                    capability.get("id").and_then(serde_json::Value::as_str)
                        == Some(crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID)));
        let host_ocr_receiver = manifest.id == crate::plugin_resource_execution::HOST_OCR_PLUGIN_ID
            && manifest
                .permissions
                .required
                .iter()
                .chain(&manifest.permissions.optional)
                .any(|permission| permission.name == "resource.read")
            && manifest
                .contributes
                .get("capabilities")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|capabilities| {
                    capabilities.iter().any(|capability| {
                        capability.get("id").and_then(serde_json::Value::as_str)
                            == Some(crate::plugin_resource_execution::HOST_OCR_CAPABILITY_ID)
                            && capability
                                .get("resourceInputProfile")
                                .and_then(serde_json::Value::as_str)
                                == Some(crate::plugin_resource_execution::HOST_OCR_INPUT_PROFILE)
                    })
                });
        let host_text_receiver =
            manifest.id == crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID
                && manifest
                    .runtime
                    .get("resourceInputProfile")
                    .and_then(serde_json::Value::as_str)
                    == Some(crate::plugin_resource_execution::HOST_TEXT_INPUT_PROFILE)
                && manifest
                    .permissions
                    .required
                    .iter()
                    .chain(&manifest.permissions.optional)
                    .any(|permission| permission.name == "resource.read")
                && manifest
                    .contributes
                    .get("capabilities")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|capabilities| {
                        capabilities.iter().any(|capability| {
                            capability.get("id").and_then(serde_json::Value::as_str)
                        == Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID)
                        })
                    });
        if !host_image_receiver && !host_ocr_receiver && !host_text_receiver {
            return Err(
                "resource.host.input.v1 is reserved for Studio built-in resource receivers".into(),
            );
        }
    }
    let image_resize_required =
        requirements.contains_key(crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE);
    let image_resize_capabilities = manifest
        .contributes
        .get("capabilities")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter(|capability| {
            capability
                .get("executionProfile")
                .and_then(serde_json::Value::as_str)
                == Some(crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE)
        })
        .collect::<Vec<_>>();
    if image_resize_required {
        let runtime = &manifest.runtime;
        let required_permission = manifest
            .permissions
            .required
            .iter()
            .chain(&manifest.permissions.optional)
            .any(|permission| permission.name == "resource.read");
        let scoped_capability = image_resize_capabilities.len() == 1
            && image_resize_capabilities[0].get("outputSchema").is_some()
            && image_resize_capabilities[0]
                .get("resourceInputMax")
                .is_none();
        if manifest.schema_version != 2
            || !requirements.contains_key("output.schema.v1")
            || !requirements.contains_key("resource.output.types.v1")
            || runtime
                .get("wasi")
                .and_then(serde_json::Value::as_str)
                .is_none()
            || runtime
                .get("resourceInputProfile")
                .and_then(serde_json::Value::as_str)
                != Some("resource.wasi.input.draft2")
            || runtime
                .get("resourceOutputProfile")
                .and_then(serde_json::Value::as_str)
                != Some(crate::plugin_worker::resource_output::PROFILE)
            || !required_permission
            || !scoped_capability
        {
            return Err("resource.wasi.image.resize.v1 requires the image resize capability, resource input/output runtimes, output profiles, and resource.read permission".into());
        }
    }
    for capability in manifest
        .contributes
        .get("capabilities")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(profile) = capability.get("executionProfile") {
            if profile.as_str() != Some(crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE)
                || !image_resize_required
            {
                return Err("Capability executionProfile is unsupported or missing its requiredProfiles declaration".into());
            }
        }
    }
    if requirements.contains_key("model.catalog.read.v1")
        && !manifest
            .permissions
            .required
            .iter()
            .chain(&manifest.permissions.optional)
            .any(|permission| permission.name == "model.catalog.read")
    {
        return Err(
            "model.catalog.read.v1 requires a model.catalog.read permission declaration".into(),
        );
    }
    if requirements.contains_key("model.generate.v1")
        && (!requirements.contains_key("model.catalog.read.v1")
            || !manifest
                .permissions
                .required
                .iter()
                .chain(&manifest.permissions.optional)
                .any(|permission| permission.name == "model.generate"))
    {
        return Err("model.generate.v1 requires model.catalog.read.v1 and a model.generate permission declaration".into());
    }
    if requirements.contains_key("service.http.get.v1")
        && !manifest
            .permissions
            .required
            .iter()
            .chain(&manifest.permissions.optional)
            .any(|permission| permission.name == "service.http.read")
    {
        return Err(
            "service.http.get.v1 requires a service.http.read permission declaration".into(),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    #[test]
    fn tool_open_requires_a_main_view_and_declared_capability() {
        let mut value = manifest(json!({"tool.open.v1":"=1.0.0-preview.1"}));
        assert_eq!(
            validate(&value).unwrap_err(),
            "tool.open.v1 requires a main View and declared capabilities"
        );
        value.contributes = json!({
            "activities":[{"id":"tools","title":"Tools"}],
            "views":[{"id":"tools.main","activity":"tools","location":"main","entry":"views/main.html"}],
            "capabilities":[{"id":"format.json","inputSchema":{"type":"object"}}]
        });
        assert!(validate(&value).is_ok());
        value.required_profiles = json!({"tool.open.v1":"=1.0.0-preview.2"});
        assert!(validate(&value).is_err());
        value.required_profiles = json!({"tool.open.v1":"*"});
        assert!(validate(&value).is_err());
    }
    #[test]
    fn reports_all_missing_capability_profiles_before_install() {
        let mut value = manifest(json!({"resource.input.types.v1":"=1.0.0-preview.1"}));
        value.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
        value.contributes = json!({"capabilities":[{
            "id":"devtools.transforms.url.encode","inputSchema":{"type":"object"},
            "resourceInputMimeTypes":["text/plain"],
            "directory":{"categoryId":"text"},
            "outputSchema":{"type":"object"},"maxResultBytes":32768
        }]});
        assert_eq!(
            super::super::validate_manifest(&value, None).unwrap_err(),
            "Missing requiredProfiles declarations: output.schema.v1, tool.directory.v1"
        );
        value.required_profiles = json!({
            "resource.input.types.v1":"=1.0.0-preview.1",
            "output.schema.v1":"=1.0.0-rc.1",
            "tool.directory.v1":"=1.0.0-preview.1"
        });
        super::super::validate_manifest(&value, None).unwrap();
    }
    #[test]
    fn frozen_url_text_candidate_reports_both_missing_profiles() {
        let bytes = include_bytes!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/devtools-url-text-resource-candidate02/plugin.json"
        ));
        let candidate: PluginManifest = serde_json::from_slice(bytes).unwrap();
        assert_eq!(
            super::super::validate_manifest(&candidate, None).unwrap_err(),
            "Missing requiredProfiles declarations: output.schema.v1, tool.directory.v1"
        );
    }
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
    #[test]
    fn json_result_capture_requires_explicit_profile_and_output_contract() {
        let mut value = manifest(json!({
            "output.schema.v1":"=1.0.0-rc.1",
            "result.json.v1":"=1.0.0-preview.1"
        }));
        value.contributes = json!({"capabilities":[{"id":"structured","inputSchema":{"type":"object"},
            "outputSchema":{"type":"object"},"resultCaptureMimeType":"application/json"}]});
        super::super::validate_manifest(&value, None).unwrap();
        value.required_profiles = json!({"output.schema.v1":"=1.0.0-rc.1"});
        assert!(super::super::validate_manifest(&value, None).is_err());
        value.required_profiles["result.json.v1"] = json!("=1.0.0-preview.1");
        value.contributes["capabilities"][0]["resultCaptureMimeType"] = json!("text/plain");
        assert!(super::super::validate_manifest(&value, None).is_err());
        value.contributes["capabilities"][0]["resultCaptureMimeType"] = json!("application/json");
        value.contributes["capabilities"][0]
            .as_object_mut()
            .unwrap()
            .remove("outputSchema");
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
    fn output_types_profile_requires_the_exact_resource_runtime() {
        let mut value = manifest(json!({
            "resource.output.types.v1":"=1.0.0-preview.1",
            "output.schema.v1":"=1.0.0-rc.1"
        }));
        value.contributes = json!({"capabilities":[{"id":"result","inputSchema":{"type":"object"},"outputSchema":{"type":"object"}}]});
        value.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
        value.runtime["resourceOutputProfile"] =
            json!(crate::plugin_worker::resource_output::PROFILE);
        super::super::validate_manifest(&value, None).unwrap();
        for (field, replacement) in [
            ("wasi", Value::Null),
            ("resourceInputProfile", Value::Null),
            ("resourceOutputProfile", Value::Null),
            (
                "resourceOutputProfile",
                json!("resource.wasi.output.draft2"),
            ),
        ] {
            let mut invalid = value.clone();
            if replacement.is_null() {
                invalid.runtime.as_object_mut().unwrap().remove(field);
            } else {
                invalid.runtime[field] = replacement;
            }
            assert!(super::super::validate_manifest(&invalid, None).is_err());
        }
        value.required_profiles = json!({"resource.output.types.v1":"=1.0.0-preview.2"});
        assert!(super::super::validate_manifest(&value, None).is_err());
        value.required_profiles = json!({"resource.output.types.v1":"=1.0.0-preview.1"});
        assert!(super::super::validate_manifest(&value, None).is_err());
    }
    #[test]
    fn image_resize_execution_profile_is_capability_scoped_and_fully_negotiated() {
        let mut value = manifest(json!({
            "resource.wasi.image.resize.v1": "=1.0.0-preview.1",
            "output.schema.v1": "=1.0.0-rc.1",
            "resource.output.types.v1": "=1.0.0-preview.1"
        }));
        value.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
        value.runtime["resourceOutputProfile"] =
            json!(crate::plugin_worker::resource_output::PROFILE);
        value.permissions.required = serde_json::from_value(json!([
            {"name":"resource.read","reason":"Read one confirmed image"}
        ]))
        .unwrap();
        value.contributes = json!({"capabilities":[{
            "id":"devtools.image.resize","inputSchema":{"type":"object"},
            "outputSchema":{"type":"object"},
            "executionProfile":"resource.wasi.image.resize.v1"
        }]});
        super::super::validate_manifest(&value, None).unwrap();

        let mut another_provider = value.clone();
        another_provider.id = "com.example.images".into();
        another_provider.contributes["capabilities"][0]["id"] = json!("images.resize");
        super::super::validate_manifest(&another_provider, None).unwrap();
        let mut invalid = value.clone();
        invalid.contributes["capabilities"][0]
            .as_object_mut()
            .unwrap()
            .remove("outputSchema");
        assert!(super::super::validate_manifest(&invalid, None).is_err());
        let mut invalid = value.clone();
        invalid.contributes["capabilities"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id":"images.resize.other","inputSchema":{"type":"object"},
                "outputSchema":{"type":"object"},
                "executionProfile":"resource.wasi.image.resize.v1"
            }));
        assert!(super::super::validate_manifest(&invalid, None).is_err());
        let mut invalid = value.clone();
        invalid
            .required_profiles
            .as_object_mut()
            .unwrap()
            .remove(crate::plugin_resource_execution::IMAGE_RESIZE_PROFILE);
        assert!(super::super::validate_manifest(&invalid, None).is_err());
        let mut invalid = value;
        invalid.contributes["capabilities"][0]["resourceInputMax"] = json!(2);
        assert!(super::super::validate_manifest(&invalid, None).is_err());
    }
    #[test]
    fn model_catalog_profile_requires_an_explicit_permission() {
        let mut value = manifest(json!({"model.catalog.read.v1":"=1.0.0-preview.1"}));
        assert!(validate(&value).is_err());
        value.permissions.optional = serde_json::from_value(json!([
            {"name":"model.catalog.read","reason":"List selected scene models"}
        ]))
        .unwrap();
        assert!(validate(&value).is_ok());
        value.required_profiles = json!({"model.catalog.read.v1":"^1.0.0"});
        assert!(validate(&value).is_err());
    }
    #[test]
    fn service_http_get_profile_requires_an_explicit_permission_and_exact_version() {
        let mut value = manifest(json!({"service.http.get.v1":"=1.0.0-preview.1"}));
        assert!(validate(&value).is_err());
        value.permissions.optional = serde_json::from_value(json!([
            {"name":"service.http.read","reason":"Read an explicitly confirmed service endpoint"}
        ]))
        .unwrap();
        assert!(validate(&value).is_ok());
        value.required_profiles = json!({"service.http.get.v1":"=1.0.0-preview.2"});
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

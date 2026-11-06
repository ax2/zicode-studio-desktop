use super::*;
use crate::plugin_worker::resource_output::{Blob, Profile};
#[test]
fn markdown_draft_revision_is_exact_and_legacy_file_adapters_remain_valid() {
    assert!(validate_manifest(&declaration()).is_ok());
    let mut modern = declaration();
    modern.required_profiles[PROFILE] = json!("=1.0.0-preview.2");
    assert!(validate_manifest(&modern).is_err());
    modern.contributes["capabilities"][0]["inputSchema"] = json!({"type":"object","properties":{"sourceMode":{"type":"string","enum":["file","draft"],"default":"file"}},"required":[],"additionalProperties":false});
    assert!(validate_manifest(&modern).is_ok());
    let mut wrong_version = modern.clone();
    wrong_version.required_profiles[PROFILE] = json!("=1.0.0-preview.1");
    assert!(validate_manifest(&wrong_version).is_err());
    for value in [json!("*"), json!("^1.0.0"), json!("=1.0.0-preview.3")] {
        modern.required_profiles[PROFILE] = value;
        assert!(validate_manifest(&modern).is_err());
    }
}
#[test]
fn only_the_exact_markdown_profile_receives_a_host_owned_single_text_role() {
    let detail = crate::plugin_resource_regex::manual_capability(
        &json!({"id":CAPABILITY,"executionProfile":PROFILE}),
    );
    assert_eq!(detail["resourceInputMin"], 1);
    assert_eq!(detail["resourceInputMax"], 1);
    assert_eq!(detail["resourceInputLabels"], json!(["Markdown text"]));
    assert!(detail.get("resourceInputMimeTypes").is_none());
    let ordinary = crate::plugin_resource_regex::manual_capability(
        &json!({"id":"ordinary","executionProfile":"resource.wasi.markdown.v2","resourceInputMin":1,"resourceInputLabels":["Markdown text"]}),
    );
    assert!(ordinary.get("resourceInputMin").is_none());
    assert!(ordinary.get("resourceInputLabels").is_none());
    let mut manifest = declaration();
    manifest.contributes["capabilities"][0]["resourceInputLabels"] = json!(["Markdown text"]);
    assert!(validate_manifest(&manifest).is_err());
}
fn declaration() -> PluginManifest {
    serde_json::from_value(json!({"schemaVersion":2,"id":"com.zicode.devtools.markdown","name":"Markdown","description":"Fixture","version":"0.1.0","publisher":"zicode",
        "requiredProfiles":{"resource.wasi.markdown.v1":"=1.0.0-preview.1","output.schema.v1":"=1.0.0-rc.1","resource.output.types.v1":"=1.0.0-preview.1","tool.directory.v1":"=1.0.0-preview.1"},
        "runtime":{"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2","resourceOutputProfile":"resource.wasi.output.draft1"},
        "permissions":{"required":[{"name":"resource.read","reason":"Fixture"}]},
        "contributes":{"commands":[],"capabilities":[{"id":CAPABILITY,"executionProfile":PROFILE,"maxResultBytes":2048,
        "inputSchema":{"type":"object","properties":{},"required":[],"additionalProperties":false},"outputSchema":{"type":"object"}}]}})).unwrap()
}
#[test]
fn markdown_declaration_requires_exact_resource_only_operation_and_snapshot_contract() {
    assert!(validate_manifest(&declaration()).is_ok());
    let mut manifest = declaration();
    manifest
        .required_profiles
        .as_object_mut()
        .unwrap()
        .remove(PROFILE);
    assert!(validate_manifest(&manifest).is_err());
    let mut manifest = declaration();
    manifest.required_profiles[PROFILE] = json!("*");
    assert!(validate_manifest(&manifest).is_err());
    let mut manifest = declaration();
    manifest.permissions.required.clear();
    assert!(validate_manifest(&manifest).is_err());
    let mut manifest = declaration();
    manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft1");
    assert!(validate_manifest(&manifest).is_err());
    let mut manifest = declaration();
    manifest.contributes["capabilities"][0]["resourceInputMax"] = json!(1);
    assert!(validate_manifest(&manifest).is_err());
    let mut manifest = declaration();
    manifest.contributes["capabilities"][0]["id"] = json!("another.tool");
    assert!(validate_manifest(&manifest).is_err());
    let mut manifest = declaration();
    manifest.contributes["capabilities"][0]["resourceInputMimeTypes"] =
        json!(["application/octet-stream"]);
    assert!(validate_manifest(&manifest).is_err());
}
#[test]
fn markdown_resource_boundaries_do_not_change_ordinary_input_limits() {
    assert!(validate_resources(&[("text/plain", 0)]).is_ok());
    assert!(validate_resources(&[("text/markdown", INPUT_MAX)]).is_ok());
    assert!(validate_resources(&[("text/plain", INPUT_MAX + 1)]).is_err());
    // The native file reader decides by UTF-8 content, not filename or transport MIME.
    assert!(validate_resources(&[("image/png", 1)]).is_ok());
    assert!(validate_resources(&[("application/octet-stream", INPUT_MAX)]).is_ok());
    assert!(validate_resources(&[]).is_err());
    assert!(validate_resources(&[("text/plain", 1), ("text/plain", 1)]).is_err());
}
fn success() -> Bundle {
    let bytes=b"<!doctype html>\n<html><head><meta content=\"default-src 'none'\"></head><body>fixture</body></html>".to_vec();
    Bundle {
        profile: Profile::Draft1,
        binary: true,
        result: json!({"ok":true,"inputBytes":10,"utf8Bytes":10,"htmlBytes":bytes.len(),"eventCount":3,"mimeType":"text/html","sourceUnchanged":true,"sourceToolVersion":"1.0.1"}),
        resources: vec![Blob {
            mime_type: "text/html".into(),
            bytes,
        }],
    }
}
#[test]
fn markdown_summary_must_agree_with_complete_html_type_and_length() {
    assert!(validate_outputs(&success()).unwrap().is_none());
    for (key, value) in [
        ("inputBytes", json!(INPUT_MAX + 1)),
        ("utf8Bytes", json!(20)),
        ("eventCount", json!(200001)),
        ("htmlBytes", json!(1)),
        ("mimeType", json!("text/plain")),
        ("sourceUnchanged", json!(false)),
        ("sourceToolVersion", json!("invalid")),
        ("privatePath", json!("private")),
    ] {
        let mut bundle = success();
        bundle.result[key] = value;
        assert!(validate_outputs(&bundle).is_err(), "{key}");
    }
    let mut bundle = success();
    bundle.resources[0].mime_type = "text/plain".into();
    assert!(validate_outputs(&bundle).is_err());
    let mut bundle = success();
    bundle.resources.clear();
    assert!(validate_outputs(&bundle).is_err());
}
#[test]
fn markdown_business_errors_discard_raw_diagnostics_and_reject_partial_outputs() {
    let mut bundle = success();
    bundle.result =
        json!({"ok":false,"error":{"code":"MARKDOWN_FAILED","message":"private file details"}});
    bundle.resources.clear();
    let normalized = validate_outputs(&bundle).unwrap().unwrap();
    assert!(!normalized.to_string().contains("private"));
    bundle.resources = success().resources;
    assert!(validate_outputs(&bundle).is_err());
}

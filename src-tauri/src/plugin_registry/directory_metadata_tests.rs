use super::*;
use serde_json::json;

fn manifest() -> PluginManifest {
    serde_json::from_value(json!({"schemaVersion":2,"id":"com.example.directory",
        "name":"Directory","description":"fixture","version":"0.1.0","publisher":"example",
        "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
        "runtime":{"worker":"runtime/worker.js"},
        "requiredProfiles":{"tool.directory.v1":"=1.0.0-preview.1"},
        "contributes":{"capabilities":[{"id":"echo","inputSchema":{"type":"object"},
            "directory":{"categoryId":"text","aliases":["ＢＡＳＥ６４","编码"],"description":"Local computation"}}]}})).unwrap()
}

#[test]
fn metadata_requires_explicit_preview_and_preserves_legacy_without_metadata() {
    let mut manifest = manifest();
    super::super::validate_manifest(&manifest, None).unwrap();
    manifest.required_profiles = json!({"tool.directory.v1":"^1.0.0"});
    assert!(super::super::validate_manifest(&manifest, None).is_err());
    manifest.required_profiles = json!({});
    assert!(super::super::validate_manifest(&manifest, None).is_err());
    manifest.schema_version = 1;
    manifest.required_profiles = Value::Null;
    assert!(super::super::validate_manifest(&manifest, None).is_err());
    manifest.contributes["capabilities"][0]
        .as_object_mut()
        .unwrap()
        .remove("directory");
    super::super::validate_manifest(&manifest, None).unwrap();
}

#[test]
fn metadata_rejects_unknown_invalid_and_unbounded_fields() {
    for directory in [
        json!(null),
        json!({}),
        json!({"categoryId":"private-business"}),
        json!({"categoryId":"text","icon":"anything"}),
        json!({"categoryId":"text","description":"x".repeat(513)}),
        json!({"categoryId":"text","description":"line\ncontrol"}),
        json!({"categoryId":"text","aliases":"name"}),
        json!({"categoryId":"text","aliases":[" "]}),
        json!({"categoryId":"text","aliases":["x".repeat(129)]}),
        json!({"categoryId":"text","aliases":["é".repeat(65)]}),
        json!({"categoryId":"text","aliases":["Ａ","a"]}),
        json!({"categoryId":"text","aliases":(0..17).map(|i| i.to_string()).collect::<Vec<_>>()}),
    ] {
        let mut manifest = manifest();
        manifest.contributes["capabilities"][0]["directory"] = directory;
        assert!(super::super::validate_manifest(&manifest, None).is_err());
    }
    assert_eq!(normalize("ＢＡＳＥ６４　É e\u{301} ①"), "base64 é é 1");
}

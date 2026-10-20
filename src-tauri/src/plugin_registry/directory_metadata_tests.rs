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

#[test]
fn application_metadata_requires_its_own_profile_and_uses_bounded_taxonomy() {
    let mut manifest = manifest();
    manifest.required_profiles = json!({"application.directory.v1":"=1.0.0-preview.1"});
    manifest.contributes = json!({"activities":[{"id":"example.application","title":"Example",
        "directory":{"categoryId":"code","aliases":["开发工具"],"description":"Project tools"}}],
        "views":[{"id":"example.main","activity":"example.application","location":"main"}]});
    super::super::validate_manifest(&manifest, None).unwrap();
    manifest.required_profiles = json!({});
    assert_eq!(
        super::super::validate_manifest(&manifest, None).unwrap_err(),
        "Missing requiredProfiles declarations: application.directory.v1"
    );
    manifest.required_profiles = json!({"application.directory.v1":"=1.0.0-preview.2"});
    assert!(super::super::validate_manifest(&manifest, None).is_err());
    manifest.required_profiles = json!({"application.directory.v1":"=1.0.0-preview.1"});
    for invalid in [
        json!({"categoryId":"arbitrary"}),
        json!({"categoryId":"code","aliases":["Ａ","a"]}),
        json!({"categoryId":"code","description":"bad\ntext"}),
        json!({"categoryId":"code","icon":"extra"}),
    ] {
        manifest.contributes["activities"][0]["directory"] = invalid;
        assert!(super::super::validate_manifest(&manifest, None).is_err());
    }
    manifest.contributes["activities"][0]["directory"] = json!({"categoryId":"code"});
    manifest.contributes["activities"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "id":"example.secondary","title":"Secondary","directory":{"categoryId":"data"}
        }));
    assert!(super::super::validate_manifest(&manifest, None).is_err());
}

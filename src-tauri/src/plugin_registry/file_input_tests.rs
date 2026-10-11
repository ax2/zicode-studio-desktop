use super::*;
use serde_json::json;

fn manifest(hint: Value) -> PluginManifest {
    serde_json::from_value(json!({"schemaVersion":2,"id":"com.example.file-hints",
        "name":"File hints","description":"fixture","version":"0.1.0","publisher":"example",
        "engines":{"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"},
        "runtime":{"wasi":"runtime/tools.wasm"},
        "requiredProfiles":{"file.input.hints.v1":"=1.0.0-preview.1"},
        "contributes":{"capabilities":[{"id":"read","inputSchema":{"type":"object"},"fileInput":hint}]}})).unwrap()
}

#[test]
fn hints_require_explicit_compatible_profile_and_preserve_legacy() {
    let mut value = manifest(json!({"extensions":[".txt",".tar.gz"]}));
    super::super::validate_manifest(&value, None).unwrap();
    for requirements in [
        json!({}),
        json!({"file.input.hints.v1":"^1.0.0"}),
        json!({"file.input.hints.v1":"=2.0.0"}),
    ] {
        value.required_profiles = requirements;
        assert!(validate_manifest(&value).is_err());
    }
    value.schema_version = 1;
    value.required_profiles = Value::Null;
    assert!(validate_manifest(&value).is_err());
    value.contributes["capabilities"][0]
        .as_object_mut()
        .unwrap()
        .remove("fileInput");
    super::super::validate_manifest(&value, None).unwrap();
}

#[test]
fn hints_are_strict_bounded_and_have_three_matching_states() {
    for hint in [
        Value::Null,
        json!({}),
        json!({"mime":["image/png"]}),
        json!({"anyFile":false}),
        json!({"anyFile":true,"extensions":[".txt"]}),
        json!({"extensions":[]}),
        json!({"extensions":[".txt",".txt"]}),
        json!({"extensions":[".TXT"]}),
        json!({"extensions":[".*"]}),
        json!({"extensions":["txt"]}),
        json!({"extensions":[".tar..gz"]}),
        json!({"extensions":[".a/b"]}),
        json!({"extensions":[".a\\b"]}),
        json!({"extensions":[".a:b"]}),
        json!({"extensions":[format!(".{}", "a".repeat(32))]}),
        json!({"extensions":(0..33).map(|i| format!(".e{i}")).collect::<Vec<_>>()}),
    ] {
        assert!(validate_manifest(&manifest(hint)).is_err());
    }
    validate_manifest(&manifest(json!({"anyFile":true}))).unwrap();
    let cap = json!({"fileInput":{"extensions":[".tar.gz",".txt"]}});
    assert_eq!(matches(&cap, "中文 & ARCHIVE.TAR.GZ"), Some(true));
    assert_eq!(matches(&cap, "file.TXT"), Some(true));
    assert_eq!(matches(&cap, "file.txt.exe"), Some(false));
    assert_eq!(matches(&cap, "file.png"), Some(false));
    assert_eq!(matches(&json!({}), "file.png"), None);
    assert_eq!(
        matches(&json!({"fileInput":{"anyFile":true}}), "no-extension"),
        Some(true)
    );
}

#[test]
fn discovery_names_are_bounded_basenames_not_paths() {
    assert!(valid_name("中文 & FILE.TXT"));
    for name in [
        "",
        ".",
        "..",
        "../file.txt",
        "C:\\file.txt",
        "a/b",
        "a:stream",
        "a\n.txt",
        "a\0.txt",
    ] {
        assert!(!valid_name(name));
    }
    assert!(!valid_name(&"x".repeat(1025)));
}

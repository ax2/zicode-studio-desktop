use super::*;
fn declaration() -> PluginManifest {
    serde_json::from_value(json!({"schemaVersion":2,"id":"com.zicode.devtools.files","name":"Files","description":"Fixture","version":"0.1.0","publisher":"zicode",
        "requiredProfiles":{PROFILE:"=1.0.0-preview.1","output.schema.v1":"=1.0.0-rc.1","resource.input.types.v1":"=1.0.0-preview.1","tool.directory.v1":"=1.0.0-preview.1"},
        "runtime":{"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft2","resourceOutputProfile":"resource.wasi.output.draft1"},
        "permissions":{"required":[{"name":"resource.read","reason":"Fixture"}]},
        "contributes":{"commands":[],"capabilities":[{"id":CAPABILITY,"executionProfile":PROFILE,"resourceInputMin":1,"resourceInputMax":4,"maxResultBytes":8192,
        "inputSchema":{"type":"object","properties":{"expected":{"type":"string","maxLength":128,"title":"预期 SHA-256 或 SHA-512（可留空）"}},"additionalProperties":false},"outputSchema":{"type":"object"}}]}})).unwrap()
}
#[test]
fn declaration_requires_exact_scope_and_authority() {
    assert!(validate_manifest(&declaration()).is_ok());
    for value in [json!("*"), json!("=1.0.0-preview.2")] {
        let mut m = declaration();
        m.required_profiles[PROFILE] = value;
        assert!(validate_manifest(&m).is_err());
    }
    let mut m = declaration();
    m.permissions.required.clear();
    assert!(validate_manifest(&m).is_err());
    let mut m = declaration();
    m.contributes["capabilities"][0]["resourceInputMax"] = json!(5);
    assert!(validate_manifest(&m).is_err());
    let mut m = declaration();
    m.contributes["capabilities"][0]["id"] = json!("other");
    assert!(validate_manifest(&m).is_err());
    let mut m = declaration();
    m.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft1");
    assert!(validate_manifest(&m).is_err());
    let mut m = declaration();
    m.contributes["commands"] = json!([{"id":"run"}]);
    assert!(validate_manifest(&m).is_err());
}
#[test]
fn resource_count_and_total_are_bounded_without_rejecting_empty_files() {
    assert!(validate_resources(&[0]).is_ok());
    assert!(validate_resources(&[MAX_BYTES / 4; 4]).is_ok());
    assert!(validate_resources(&[]).is_err());
    assert!(validate_resources(&[0; 5]).is_err());
    assert!(validate_resources(&[MAX_BYTES, 1]).is_err());
    assert!(validate_resources(&[usize::MAX, 1]).is_err());
}
#[test]
fn result_is_bound_to_snapshot_and_cannot_return_extra_resources() {
    let hash = "a".repeat(64);
    let other = format!("{:x}", Sha512::digest(b"abc"));
    let base = json!({"ok":true,"schemaVersion":2,"material":"file-integrity-report-list","files":[{"index":0,"bytes":3,"sha256":hash,"sha512":other,"matches":null}]});
    assert!(validate_result(&base, &[(&hash, b"abc")], "", 0).is_ok());
    assert!(validate_result(&base, &[(&hash, b"abcd")], "", 0).is_err());
    assert!(validate_result(&base, &[(&hash, b"abc")], "", 1).is_err());
    assert!(validate_result(&base, &[(&"c".repeat(64), b"abc")], "", 0).is_err());
    let mut forged = base.clone();
    forged["files"][0]["sha512"] = json!("b".repeat(128));
    assert!(validate_result(&forged, &[(&hash, b"abc")], "", 0).is_err());
    let mut wrong = base.clone();
    wrong["files"][0]["matches"] = json!(true);
    assert!(validate_result(&wrong, &[(&hash, b"abc")], "", 0).is_err());
    let mut wrong = base.clone();
    wrong["files"][0]["path"] = json!("private");
    assert!(validate_result(&wrong, &[(&hash, b"abc")], "", 0).is_err());
    let mut wrong = base.clone();
    wrong["files"][0].as_object_mut().unwrap().remove("matches");
    wrong["files"][0]["path"] = json!("private");
    assert!(validate_result(&wrong, &[(&hash, b"abc")], "", 0).is_err());
    let failure =
        json!({"ok":false,"error":{"code":"RESOURCE_READ_FAILED","message":"private path"}});
    let normalized = validate_result(&failure, &[(&hash, b"abc")], "", 0)
        .unwrap()
        .unwrap();
    assert!(!normalized.to_string().contains("private"));
}

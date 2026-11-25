use super::*;
use crate::plugin_worker::resource_output::Blob;

const BASE: &[u8] = br#"{"version":1,"bindings":[{"command":"open:files","sequence":""},{"command":"open:json","sequence":"A F"}]}"#;
const INCOMING: &[u8] = br#"{"version":1,"bindings":[{"command":"open:json","sequence":" b e "},{"command":"search","sequence":"k"}]}"#;
const NORMALIZED: &[u8] = br#"{"version":1,"bindings":[{"command":"open:files","sequence":""},{"command":"open:json","sequence":"B E"},{"command":"search","sequence":"K"}]}"#;

fn manifest() -> Value {
    json!({"schemaVersion":2,"id":PLUGIN,"name":"Shortcut profile","description":"Review two confirmed portable files.","version":"0.1.0","publisher":"zicode","license":"MIT",
        "engines":{"zicode":">=0.7.2 <1.0.0","pluginApi":"^1.0.0"},
        "requiredProfiles":{(PROFILE):VERSION,"resource.input.types.v1":"=1.0.0-preview.1","resource.output.types.v1":"=1.0.0-preview.1",
            "tool.directory.v1":"=1.0.0-preview.1","output.schema.v1":"=1.0.0-rc.1"},
        "runtime":{"wasi":"runtime/tools.wasm","resourceInputProfile":INPUT,"resourceOutputProfile":crate::plugin_worker::resource_output::PROFILE},
        "activationEvents":[format!("onCapability:{CAPABILITY}")],"contributes":{"activities":[],"commands":[],"views":[],"piTools":[],"capabilities":[{
            "id":CAPABILITY,"title":"Review shortcuts","executionProfile":PROFILE,"resourceInputMin":2,"resourceInputMax":2,
            "resourceInputMimeTypes":TYPES,"maxResultBytes":8192,"directory":{"categoryId":"files","description":"A portable review."},
            "inputSchema":{"type":"object","additionalProperties":false,"properties":{}},"outputSchema":{"type":"object"}}]},
        "permissions":{"required":[{"name":"resource.read","reason":"Read exactly two confirmed snapshots."}],"optional":[]}})
}

fn validate_declaration(value: &Value) -> Result<(), String> {
    let manifest = serde_json::from_value(value.clone()).map_err(|error| error.to_string())?;
    crate::plugin_registry::validate_manifest(&manifest, None)
}

fn bundle(bytes: &[u8]) -> Bundle {
    Bundle {
        profile: Profile::ShortcutProfile1,
        binary: true,
        result: json!({"ok":true,"data":{"mode":"merge","baseCount":2,"incomingCount":2,"resultCount":3,
            "changedCount":2,"conflictPairs":0,"outputBytes":bytes.len()},"error":null}),
        resources: vec![Blob {
            mime_type: JSON.into(),
            bytes: bytes.to_vec(),
        }],
    }
}

#[test]
fn shortcut_profile_declaration_is_limited_to_its_identity_permissions_and_json() {
    let valid = manifest();
    validate_declaration(&valid).unwrap();
    for (path, value) in [
        ("/id", json!("com.example.lookalike")),
        (
            "/contributes/capabilities/0/id",
            json!("devtools.shortcuts.other"),
        ),
        ("/contributes/capabilities/0/resourceInputMax", json!(3)),
        ("/contributes/capabilities/0/resourceInputMin", json!(1)),
        (
            "/contributes/capabilities/0/resourceInputMimeTypes",
            json!(["text/csv", "text/plain"]),
        ),
        (
            "/runtime/resourceOutputProfile",
            json!("resource.wasi.output.draft2"),
        ),
        ("/permissions/required", json!([])),
        (
            "/permissions/optional",
            json!([{"name":"model.generate","reason":"unrelated"}]),
        ),
    ] {
        let mut invalid = valid.clone();
        *invalid.pointer_mut(path).unwrap() = value;
        assert!(validate_declaration(&invalid).is_err(), "{path}");
    }
    assert!(!Profile::Draft1.permits_mime(JSON));
    let json = Profile::negotiate(
        Some(crate::plugin_worker::resource_output::PROFILE),
        Some(PROFILE),
    )
    .unwrap()
    .unwrap();
    assert_eq!(json, Profile::ShortcutProfile1);
    assert!(json.permits_mime(JSON));
    assert!(!json.permits_mime("text/plain"));
    assert_eq!(json.max_records(), 1);
    assert_eq!(json.max_file(), MAX_OUTPUT);
    assert_eq!(json.save_name(), "resource.save.draft1");
}

#[test]
fn shortcut_profile_rejects_wrong_invocation_shape() {
    let values = [("application/octet-stream", MAX_FILE), ("text/plain", 2)];
    assert!(validate_inputs(PLUGIN, Some(CAPABILITY), values).is_ok());
    assert!(validate_inputs(PLUGIN, Some("other"), values).is_err());
    assert!(validate_inputs("other", Some(CAPABILITY), values).is_err());
    assert!(validate_inputs(PLUGIN, Some(CAPABILITY), [values[0]]).is_err());
    assert!(validate_inputs(
        PLUGIN,
        Some(CAPABILITY),
        [values[0], ("text/plain", MAX_FILE + 1)]
    )
    .is_err());
    assert!(validate_inputs(PLUGIN, Some(CAPABILITY), [values[0], ("text/csv", 2)]).is_err());
    assert!(validate_parameters(&json!({"mode":"replace","incomingPosition":1})).is_ok());
    for request in [
        json!({"mode":"apply"}),
        json!({"incomingPosition":3}),
        json!({"path":"synthetic"}),
    ] {
        assert!(validate_parameters(&request).is_err());
    }
}

#[test]
fn shortcut_profile_rechecks_actual_source_order_and_canonical_output() {
    let result = bundle(NORMALIZED);
    assert!(validate_output(&result, &[BASE, INCOMING], &json!({})).is_ok());
    assert!(validate_output(&result, &[INCOMING, BASE], &json!({"incomingPosition":1})).is_ok());
    assert!(validate_output(&result, &[INCOMING, BASE], &json!({})).is_err());
    assert!(validate_output(&result, &[BASE, INCOMING], &json!({"mode":"replace"})).is_err());
    assert!(validate_output(&result, &[BASE, b"{}"], &json!({})).is_err());
    assert!(validate_output(&result, &[BASE], &json!({})).is_err());
    for bad in [
        br#"{"version":1,"bindings":[{"command":"search","sequence":"K"}]}"#.as_slice(),
        br#"{"version":1,"bindings":[],"endpoint":"synthetic"}"#,
        br#"{"version":1,"bindings":[{"command":"run-script","sequence":"X"}]}"#,
        br#"{"version":1,"bindings":[{"command":"open:files","sequence":""},{"command":"open:json","sequence":"b e"},{"command":"search","sequence":"K"}]}"#,
    ] {
        assert!(validate_output(&bundle(bad),&[BASE,INCOMING],&json!({})).is_err());
    }
    assert!(validate_output(
        &bundle(&vec![b' '; MAX_OUTPUT + 1]),
        &[BASE, INCOMING],
        &json!({})
    )
    .is_err());
    let mut wrong = bundle(NORMALIZED);
    wrong.resources[0].mime_type = "text/plain".into();
    assert!(validate_output(&wrong, &[BASE, INCOMING], &json!({})).is_err());
}

#[test]
fn shortcut_profile_conflicts_and_guest_errors_do_not_admit_payloads() {
    let conflict = br#"{"version":1,"bindings":[{"command":"open:reserved","sequence":"K O"}]}"#;
    let mut report = Bundle {
        profile: Profile::ShortcutProfile1,
        binary: true,
        result: json!({"ok":true,"data":{"mode":"merge","baseCount":2,"incomingCount":1,"resultCount":3,"changedCount":1,
            "conflictPairs":1,"outputBytes":0},"error":null}),
        resources: vec![],
    };
    assert!(validate_output(&report, &[BASE, conflict], &json!({})).is_ok());
    report.resources = bundle(NORMALIZED).resources;
    assert!(validate_output(&report, &[BASE, conflict], &json!({})).is_err());
    report.result = json!({"ok":false,"data":null,"error":{"code":"INVALID_BASE"}});
    assert!(validate_output(&report, &[BASE, conflict], &json!({})).is_err());
    report.resources.clear();
    assert!(validate_output(&report, &[BASE, conflict], &json!({})).is_ok());
}

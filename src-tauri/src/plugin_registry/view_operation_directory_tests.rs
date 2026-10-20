use super::*;
use crate::plugin_registry::{validate_manifest, PluginManifest, PluginRegistry};
use serde_json::{json, Value};

fn sample() -> Value {
    json!({
        "schemaVersion": 2,
        "id": "com.example.view-directory",
        "name": "View directory",
        "description": "A provider-neutral View operation fixture",
        "version": "0.1.0",
        "publisher": "example",
        "engines": {"zicode": ">=0.4.2 <1.0.0", "pluginApi": "^1.0.0"},
        "requiredProfiles": {"view.operation.directory.v1": "=1.0.0-preview.1"},
        "activationEvents": ["onView:example.main"],
        "runtime": {},
        "contributes": {
            "activities": [{"id":"example.application", "title":"Example"}],
            "views": [{"id":"example.main", "activity":"example.application",
                "location":"main", "title":"Main", "entry":"views/main.html"}],
            "viewOperations": [{"id":"example.health", "title":"Health", "viewId":"example.main",
                "sourceToolId":"example-source", "directory":{"categoryId":"system",
                    "aliases":["服务健康"], "description":"Show service health"}}],
            "capabilities": [], "commands": [], "piTools": []
        },
        "permissions": {"required":[], "optional":[]}
    })
}

fn check(value: Value) -> Result<(), String> {
    let manifest: PluginManifest = serde_json::from_value(value).unwrap();
    validate_manifest(&manifest, None)
}

#[test]
fn accepts_bounded_view_operation_without_creating_a_capability() {
    check(sample()).unwrap();
}

#[test]
fn requires_exact_profile_and_explicit_operations() {
    let mut missing = sample();
    missing["requiredProfiles"] = json!({});
    assert!(check(missing)
        .unwrap_err()
        .contains("viewOperations requires"));
    let mut mismatch = sample();
    mismatch["requiredProfiles"][PROFILE] = json!("=1.0.0-preview.2");
    assert!(check(mismatch)
        .unwrap_err()
        .contains("exact preview profile"));
    let mut empty = sample();
    empty["contributes"]["viewOperations"] = json!([]);
    assert!(check(empty).unwrap_err().contains("1 to 128"));
}

#[test]
fn rejects_unknown_view_execution_fields_and_colliding_ids() {
    let mut unknown_view = sample();
    unknown_view["contributes"]["viewOperations"][0]["viewId"] = json!("other.main");
    assert!(check(unknown_view)
        .unwrap_err()
        .contains("declared main View"));
    let mut execution = sample();
    execution["contributes"]["viewOperations"][0]["inputSchema"] = json!({"type":"object"});
    assert!(check(execution)
        .unwrap_err()
        .contains("Unsupported View operation field"));
    let mut duplicate = sample();
    let repeated = duplicate["contributes"]["viewOperations"][0].clone();
    duplicate["contributes"]["viewOperations"]
        .as_array_mut()
        .unwrap()
        .push(repeated);
    assert!(check(duplicate).unwrap_err().contains("Duplicate"));
}

#[test]
fn validates_directory_aliases_and_source_identity() {
    let mut aliases = sample();
    aliases["contributes"]["viewOperations"][0]["directory"]["aliases"] = json!(["ＡＢＣ", "abc"]);
    assert!(check(aliases).unwrap_err().contains("directory aliases"));
    let mut source = sample();
    source["contributes"]["viewOperations"][0]["sourceToolId"] = json!("../outside");
    assert!(check(source).unwrap_err().contains("sourceToolId"));
}

#[test]
fn isolated_registry_lists_view_operations_without_callable_capabilities() {
    let project = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let root = project
        .join(".cache/task-scratch")
        .join(format!("view-operation-registry-{}", uuid::Uuid::new_v4()));
    let source = root.join("source");
    std::fs::create_dir_all(source.join("views")).unwrap();
    std::fs::write(
        root.join("owner.json"),
        r#"{"purpose":"versioned View operation Host admission","lifetime":"remove on pass; retain on failure"}"#,
    )
    .unwrap();
    std::fs::write(source.join("plugin.json"), sample().to_string()).unwrap();
    std::fs::write(
        source.join("views/main.html"),
        "<!doctype html><title>Example</title>",
    )
    .unwrap();
    let mut registry = PluginRegistry::open(root.join("registry")).unwrap();
    assert_eq!(
        registry.install_developer(&source).unwrap(),
        "com.example.view-directory"
    );
    let listing = registry
        .list_summary("programming")
        .into_iter()
        .find(|item| item["id"] == "com.example.view-directory")
        .unwrap();
    assert_eq!(listing["enabled"], false);
    assert_eq!(listing["viewOperationDirectoryProfile"], true);
    assert_eq!(listing["contributes"]["capabilities"], json!([]));
    assert_eq!(
        listing["contributes"]["viewOperations"][0]["id"],
        "example.health"
    );
    drop(registry);
    std::fs::remove_dir_all(root).unwrap();
}

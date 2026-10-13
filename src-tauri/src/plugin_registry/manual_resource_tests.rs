use super::*;
use crate::metadata_store::tool_access::{RecentEntry, ToolAccess};

#[test]
fn multi_resource_count_requires_an_explicit_wasi_capability() {
    let registry = tests::registry();
    let mut manifest = registry.plugins.get("com.zicode.catalog-fixture").unwrap().manifest.clone();
    manifest.runtime["wasi"] = json!("runtime/tools.wasm");
    manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    manifest.contributes["capabilities"][0]["resourceInputMax"] = json!(4);
    assert!(validate_manifest(&manifest, None).is_ok());
    for value in [json!(0), json!(1), json!(5), json!("4")] {
        manifest.contributes["capabilities"][0]["resourceInputMax"] = value;
        assert!(validate_manifest(&manifest, None).is_err());
    }
    manifest.contributes["capabilities"][0]["resourceInputMax"] = json!(4);
    manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft1");
    assert!(validate_manifest(&manifest, None).is_err());
}

#[test]
fn file_hints_hide_declared_mismatches_but_keep_legacy_unknown() {
    let mut registry = tests::registry();
    let id = "com.zicode.catalog-fixture";
    let plugin = registry.plugins.get_mut(id).unwrap();
    plugin.manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    plugin.manifest.permissions.optional = serde_json::from_value(json!([{"name":"resource.read","reason":"read chosen file"}])).unwrap();
    let caps = plugin.manifest.contributes["capabilities"].as_array_mut().unwrap();
    caps.truncate(3);
    caps[0]["fileInput"] = json!({"extensions":[".txt"]});
    caps[1]["fileInput"] = json!({"extensions":[".png"]});
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.read".into(), true);
    let mut query = CatalogQuery { scene_id: "programming".into(), resource_only: true, file_name: Some("中文.TXT".into()), ..Default::default() };
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 2);
    assert_eq!(page["items"][0]["fileInputMatch"], "declared");
    assert_eq!(page["items"][1]["fileInputMatch"], "unknown");
    assert!(!page.to_string().contains("inputSchema"));
    query.file_name = None;
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 3);
    query.file_name = Some("../file.txt".into());
    assert!(registry.manual_catalog(&query).is_err());
    query.file_name = Some("file.txt".into());
    query.resource_only = false;
    assert!(registry.manual_catalog(&query).is_err());
}

#[test]
fn explorer_file_match_precedes_legacy_unknown_before_paging() {
    let mut registry = tests::registry();
    let id = "com.zicode.catalog-fixture";
    let plugin = registry.plugins.get_mut(id).unwrap();
    plugin.manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    plugin.manifest.permissions.optional = serde_json::from_value(json!([
        {"name":"resource.read","reason":"read chosen file"}
    ])).unwrap();
    plugin.manifest.contributes["capabilities"][204]["fileInput"] = json!({"extensions":[".zip"]});
    plugin.manifest.contributes["capabilities"][203]["fileInput"] = json!({"extensions":[".png"]});
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.read".into(), true);
    let mut query = CatalogQuery { scene_id:"programming".into(), resource_only:true,
        file_name:Some("Archive.ZIP".into()), ..Default::default() };
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 204);
    assert_eq!(page["items"][0]["capabilityId"], "text.204");
    assert_eq!(page["items"][0]["fileInputMatch"], "declared");
    assert_eq!(page["items"][1]["capabilityId"], "text.000");
    query.offset = 40;
    query.revision = Some(page["revision"].as_str().unwrap().into());
    assert_eq!(registry.manual_catalog(&query).unwrap()["items"][0]["capabilityId"], "text.039");
    query.offset = 0;
    query.revision = None;
    query.file_name = None;
    assert_eq!(registry.manual_catalog(&query).unwrap()["items"][0]["capabilityId"], "text.000");

    query.file_name = Some("Archive.ZIP".into());
    let access = ToolAccess { favorites: vec![tool_access_id(id,"text.000"), tool_access_id(id,"text.204")],
        recent: ["text.000", "text.204"].map(|cap| RecentEntry { id:tool_access_id(id,cap), used_at:1 }).to_vec(),
        ..Default::default() };
    query.view = CatalogView::Favorites;
    assert_eq!(registry.manual_catalog_with_access(&query,Some(&access)).unwrap()["items"][0]["capabilityId"], "text.204");
    query.view = CatalogView::Recent;
    assert_eq!(registry.manual_catalog_with_access(&query,Some(&access)).unwrap()["items"][0]["capabilityId"], "text.000");
}

#[test]
fn resource_targets_are_metadata_only_permission_scoped_and_paged() {
    let mut registry = tests::registry();
    let id = "com.zicode.catalog-fixture";
    let query = CatalogQuery { scene_id: "programming".into(), resource_only: true, ..Default::default() };
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    let plugin = registry.plugins.get_mut(id).unwrap();
    plugin.manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    plugin.manifest.contributes["capabilities"][0]["resourceInputMax"] = json!(4);
    plugin.manifest.permissions.optional = serde_json::from_value(json!([{"name":"resource.read","reason":"read chosen output"}])).unwrap();
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.read".into(), true);
    let page = registry.manual_catalog(&query).unwrap();
    let detail_query = DetailQuery { scene_id: "programming".into(), plugin_id: id.into(), capability_id: "text.000".into(), revision: page["revision"].as_str().unwrap().into() };
    let detail = registry.manual_tool_detail(&detail_query).unwrap();
    assert_eq!(detail["resourceInputProfile"], "resource.wasi.input.draft2");
    assert_eq!(detail["capability"]["resourceInputMax"], 4);
    assert!(detail["capability"].get("inputSchema").is_some());
    assert!(!detail.to_string().contains("tools.wasm"));
    assert_eq!(page["total"], 205);
    assert_eq!(page["items"].as_array().unwrap().len(), 40);
    assert!(!page.to_string().contains("inputSchema"));
    assert!(!page.to_string().contains("tools.wasm"));
    let next = CatalogQuery { offset: 40, revision: Some(page["revision"].as_str().unwrap().into()), ..query };
    assert_eq!(registry.manual_catalog(&next).unwrap()["items"][0]["capabilityId"], "text.040");
    registry.scene_plugin_state_mut("programming", id).enabled = Some(false);
    let first = CatalogQuery { offset: 0, revision: None, ..next };
    assert_eq!(registry.manual_catalog(&first).unwrap()["total"], 0);
    registry.scene_plugin_state_mut("programming", id).enabled = Some(true);
    registry.plugins.get_mut(id).unwrap().manifest.runtime = json!({"entry":"runtime/tools.js","resourceInputProfile":"resource.wasi.input.draft2"});
    assert_eq!(registry.manual_catalog(&first).unwrap()["total"], 0);
    registry.plugins.get_mut(id).unwrap().manifest.runtime = json!({"wasi":"runtime/tools.wasm","resourceInputProfile":"resource.wasi.input.draft1"});
    assert_eq!(registry.manual_catalog(&first).unwrap()["total"], 0);
    let normal = CatalogQuery { resource_only: false, ..first };
    assert_eq!(registry.manual_catalog(&normal).unwrap()["total"], 205);
}

#[test]
fn directory_targets_require_the_extra_grant_and_reject_mixed_filters() {
    let mut registry = tests::registry();
    let id = "com.zicode.catalog-fixture";
    let plugin = registry.plugins.get_mut(id).unwrap();
    plugin.manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    plugin.manifest.permissions.optional = serde_json::from_value(json!([
        {"name":"resource.read","reason":"read chosen resource"},
        {"name":"resource.directory.read","reason":"read chosen directory names"}
    ])).unwrap();
    let query = CatalogQuery { scene_id: "programming".into(), directory_only: true, ..Default::default() };
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.read".into(), true);
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.directory.read".into(), true);
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 205);
    assert_eq!(page["items"].as_array().unwrap().len(), 40);
    assert!(!page.to_string().contains("inputSchema"));
    let mixed = CatalogQuery { resource_only: true, ..query };
    assert!(registry.manual_catalog(&mixed).is_err());
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.directory.read".into(), false);
    let revoked = CatalogQuery { resource_only: false, ..mixed };
    assert_eq!(registry.manual_catalog(&revoked).unwrap()["total"], 0);
}

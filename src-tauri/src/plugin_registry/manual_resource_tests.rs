use super::*;

#[test]
fn resource_targets_are_metadata_only_permission_scoped_and_paged() {
    let mut registry = tests::registry();
    let id = "com.zicode.catalog-fixture";
    let query = CatalogQuery { scene_id: "programming".into(), resource_only: true, ..Default::default() };
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    let plugin = registry.plugins.get_mut(id).unwrap();
    plugin.manifest.runtime["resourceInputProfile"] = json!("resource.wasi.input.draft2");
    plugin.manifest.permissions.optional = serde_json::from_value(json!([{"name":"resource.read","reason":"read chosen output"}])).unwrap();
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    registry.scene_plugin_state_mut("programming", id).permissions.insert("resource.read".into(), true);
    let page = registry.manual_catalog(&query).unwrap();
    let detail_query = DetailQuery { scene_id: "programming".into(), plugin_id: id.into(), capability_id: "text.000".into(), revision: page["revision"].as_str().unwrap().into() };
    let detail = registry.manual_tool_detail(&detail_query).unwrap();
    assert_eq!(detail["resourceInputProfile"], "resource.wasi.input.draft2");
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

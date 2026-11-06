#[test]
fn manual_detail_derives_ordered_text_roles_only_for_the_negotiated_regex_profile() {
    let mut registry = tests::registry();
    let id = "com.zicode.catalog-fixture";
    let caps = registry.plugins.get_mut(id).unwrap().manifest.contributes["capabilities"]
        .as_array_mut()
        .unwrap();
    caps[0]["executionProfile"] = json!(crate::plugin_resource_regex::PROFILE);
    for cap in &mut caps[..2] {
        cap["resourceInputMin"] = json!(1);
        cap["resourceInputLabels"] = json!(["untrusted label"]);
    }
    let page = registry
        .manual_catalog(&CatalogQuery {
            scene_id: "programming".into(),
            ..Default::default()
        })
        .unwrap();
    let mut query = DetailQuery {
        scene_id: "programming".into(),
        plugin_id: id.into(),
        capability_id: "text.000".into(),
        revision: page["revision"].as_str().unwrap().into(),
        resource_mime_type: None,
    };
    let detail = registry.manual_tool_detail(&query).unwrap();
    assert_eq!(detail["capability"]["resourceInputMin"], 2);
    assert_eq!(
        detail["capability"]["resourceInputLabels"],
        json!(["Input text", "Replacement template"])
    );
    query.capability_id = "text.001".into();
    let ordinary = registry.manual_tool_detail(&query).unwrap();
    assert!(ordinary["capability"].get("resourceInputMin").is_none());
    assert!(ordinary["capability"].get("resourceInputLabels").is_none());
}


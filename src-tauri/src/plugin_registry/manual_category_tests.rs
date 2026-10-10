use super::*;
use crate::metadata_store::tool_access::{RecentEntry, ToolAccess};

#[test]
fn cross_plugin_categories_search_and_personalized_facets_precede_paging() {
    let mut registry = tests::registry();
    let plugin = registry.plugins.values_mut().next().unwrap();
    plugin.manifest.schema_version = 2;
    plugin.manifest.engines = json!({"zicode":">=0.1.0 <1.0.0","pluginApi":"^1.0.0"});
    plugin.manifest.required_profiles = json!({"tool.directory.v1":"=1.0.0-preview.1"});
    for (i, cap) in plugin.manifest.contributes["capabilities"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .enumerate()
    {
        cap["directory"] = json!({"categoryId":if i % 2 == 0 {"text"} else {"data"},
            "aliases":["ＢＡＳＥ６４",format!("别名{i}")], "description":"纯本地 文本转换"});
    }
    super::super::validate_manifest(&plugin.manifest, None).unwrap();
    let mut other = plugin.clone();
    other.manifest.id = "com.zicode.other".into();
    registry.plugins.insert(other.manifest.id.clone(), other);
    let mut query = CatalogQuery {
        scene_id: "programming".into(),
        category_id: Some("text".into()),
        ..Default::default()
    };
    let first = registry.manual_catalog(&query).unwrap();
    assert_eq!(first["total"], 206);
    assert_eq!(
        first["categories"],
        json!([{"id":"data","count":204},{"id":"text","count":206}])
    );
    assert_eq!(first["items"].as_array().unwrap().len(), 40);
    assert!(!first.to_string().contains("inputSchema"));
    query.query = "base64 纯本地 别名204".into();
    let searched = registry.manual_catalog(&query).unwrap();
    assert_eq!(searched["total"], 2);
    assert_eq!(searched["categories"], first["categories"]);
    query.plugin_id = Some("com.zicode.other".into());
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 1);
    query.query = "".into();
    query.plugin_id = None;
    let access = ToolAccess {
        revision: 4,
        favorites: vec![first["items"][0]["accessId"].as_str().unwrap().into()],
        recent: vec![RecentEntry {
            id: first["items"][1]["accessId"].as_str().unwrap().into(),
            used_at: 1,
        }],
        ..Default::default()
    };
    query.view = CatalogView::Favorites;
    let favorites = registry
        .manual_catalog_with_access(&query, Some(&access))
        .unwrap();
    assert_eq!(favorites["total"], 1);
    assert_eq!(favorites["categories"], json!([{"id":"text","count":1}]));
    query.category_id = Some("removed-category".into());
    assert_eq!(
        registry
            .manual_catalog_with_access(&query, Some(&access))
            .unwrap()["total"],
        0
    );
    query.category_id = Some("x".repeat(65));
    assert_eq!(
        registry
            .manual_catalog_with_access(&query, Some(&access))
            .unwrap_err(),
        "invalid_parameters"
    );
    query.category_id = None;
    query.view = CatalogView::Recent;
    assert_eq!(
        registry
            .manual_catalog_with_access(&query, Some(&access))
            .unwrap()["items"][0]["accessId"],
        access.recent[0].id
    );
}

#[test]
fn legacy_tools_stay_uncategorized_and_metadata_change_invalidates_revision() {
    let mut registry = tests::registry();
    let mut query = CatalogQuery {
        scene_id: "programming".into(),
        category_id: Some("uncategorized".into()),
        ..Default::default()
    };
    let first = registry.manual_catalog(&query).unwrap();
    assert_eq!(first["total"], 205);
    assert_eq!(
        first["categories"],
        json!([{"id":"uncategorized","count":205}])
    );
    registry
        .plugins
        .values_mut()
        .next()
        .unwrap()
        .manifest
        .description = "metadata changed".into();
    query.revision = Some(first["revision"].as_str().unwrap().into());
    query.offset = 40;
    assert_eq!(
        registry.manual_catalog(&query).unwrap_err(),
        "catalog_changed"
    );
}

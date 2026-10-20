use super::*;
use crate::metadata_store::tool_access::{RecentEntry, ToolAccess};

fn access_id(index: usize) -> String {
    let id = serde_json::to_string(&("com.zicode.catalog-fixture", format!("text.{index:03}"))).unwrap();
    format!("manual.tool:{:x}", Sha256::digest(id.as_bytes()))
}

#[test]
fn view_operations_share_search_facets_and_history_without_becoming_executable_tools() {
    let mut registry = registry();
    let mut view_plugin = registry.plugins.values().next().unwrap().clone();
    view_plugin.manifest.id = "com.zicode.view-fixture".into();
    view_plugin.manifest.schema_version = 2;
    view_plugin.manifest.engines = json!({"zicode":">=0.4.2 <1.0.0","pluginApi":"^1.0.0"});
    view_plugin.manifest.required_profiles = json!({"view.operation.directory.v1":"=1.0.0-preview.1"});
    view_plugin.manifest.contributes = json!({
        "activities":[{"id":"example.application","title":"Example"}],
        "views":[{"id":"example.main","activity":"example.application",
            "location":"main","title":"Main","entry":"views/main.html"}],
        "viewOperations":[{"id":"example.health","title":"Health","viewId":"example.main",
            "directory":{"categoryId":"system","aliases":["服务健康"],"description":"Show health panel"}}],
        "capabilities":[],"commands":[],"piTools":[]
    });
    super::super::validate_manifest(&view_plugin.manifest, None).unwrap();
    registry.plugins.insert(view_plugin.manifest.id.clone(), view_plugin);
    let mut query = CatalogQuery { scene_id:"programming".into(), query:"服务健康".into(),
        include_view_operations:true,
        category_id:Some("system".into()), ..Default::default() };
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 1);
    let operation = &page["items"][0];
    assert_eq!(operation["kind"], "view-operation");
    assert_eq!(operation["operationId"], "example.health");
    assert_eq!(operation["viewId"], "example.main");
    assert!(operation.get("capabilityId").is_none());
    assert_eq!(operation["accessId"], view_operation_access_id("com.zicode.view-fixture", "example.health"));
    assert_eq!(page["categories"].as_array().unwrap().iter().find(|value| value["id"] == "system").unwrap()["count"], 1);
    assert_eq!(page["sources"].as_array().unwrap().iter().find(|value| value["pluginId"] == "com.zicode.view-fixture").unwrap()["count"], 1);
    let access = ToolAccess { favorites:vec![operation["accessId"].as_str().unwrap().into()],
        recent:vec![RecentEntry { id:operation["accessId"].as_str().unwrap().into(), used_at:1 }],
        ..Default::default() };
    query.query.clear(); query.view = CatalogView::Favorites;
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap()["total"], 1);
    query.view = CatalogView::Recent;
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap()["total"], 1);
    query.view = CatalogView::All; query.resource_only = true; query.category_id = None;
    query.plugin_id = Some("com.zicode.view-fixture".into());
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    query.resource_only = false; query.directory_only = true;
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    query.directory_only = false;
    query.include_view_operations = false;
    assert_eq!(registry.manual_catalog(&query).unwrap()["total"], 0);
    assert_eq!(registry.manual_tool_detail(&DetailQuery { scene_id:"programming".into(),
        plugin_id:"com.zicode.view-fixture".into(), capability_id:"example.health".into(),
        revision:page["revision"].as_str().unwrap().into(), resource_mime_type:None }).unwrap_err(), "tool_unavailable");
}

#[test]
fn manual_sources_cover_full_scoped_lists_before_search_filter_and_paging() {
    let mut registry = registry();
    let mut other = registry.plugins.values().next().unwrap().clone();
    other.manifest.id = "com.zicode.other-source".into();
    other.manifest.name = "Other source".into();
    other.enabled_by_default = false;
    registry.plugins.insert(other.manifest.id.clone(), other);
    let mut query = CatalogQuery { scene_id: "programming".into(),
        plugin_id: Some("com.zicode.other-source".into()), ..Default::default() };
    let first = registry.manual_catalog(&query).unwrap();
    assert_eq!(first["total"], 205);
    assert_eq!(first["items"].as_array().unwrap().len(), 40);
    assert!(first["items"].as_array().unwrap().iter().all(|item| item["pluginId"] == "com.zicode.other-source"));
    assert_eq!(first["sources"].as_array().unwrap().len(), 2);
    assert_eq!(first["sources"][1]["count"], 205);
    assert_eq!(first["sources"][1]["enabled"], false);
    query.query = "204".into();
    let searched = registry.manual_catalog(&query).unwrap();
    assert_eq!(searched["total"], 1);
    assert_eq!(searched["sources"], first["sources"]);
    query.query = "".into(); query.plugin_id = Some("uninstalled-source".into());
    let empty = registry.manual_catalog(&query).unwrap();
    assert_eq!(empty["total"], 0);
    assert_eq!(empty["sources"], first["sources"]);
    query.view = CatalogView::Favorites;
    let access = ToolAccess { favorites: vec![access_id(204)], ..Default::default() };
    let favorites = registry.manual_catalog_with_access(&query, Some(&access)).unwrap();
    assert_eq!(favorites["sources"].as_array().unwrap().len(), 1);
    assert_eq!(favorites["sources"][0]["count"], 1);
    assert_eq!(favorites["sources"][0]["pluginId"], "com.zicode.catalog-fixture");
    query.plugin_id = Some("x".repeat(257));
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap_err(), "invalid_parameters");
}

#[test]
fn scoped_lists_filter_before_paging_and_recent_order_is_preserved() {
    let registry = registry();
    let mut access = ToolAccess { revision: 7, favorites: (100..155).map(access_id).collect(),
        recent: [204, 2, 150].map(|index| RecentEntry { id: access_id(index), used_at: index as u64 }).to_vec(),
        ..Default::default() };
    access.favorites.push("removed-or-application-id".into());
    let mut query = CatalogQuery { scene_id: "programming".into(), view: CatalogView::Favorites, ..Default::default() };
    let first = registry.manual_catalog_with_access(&query, Some(&access)).unwrap();
    assert_eq!(first["total"], 55);
    assert_eq!(first["items"].as_array().unwrap().len(), 40);
    assert_eq!(first["items"][0]["capabilityId"], "text.100");
    assert!(!first.to_string().contains("inputSchema"));
    query.offset = 40;
    query.revision = Some(first["revision"].as_str().unwrap().into());
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap_err(), "catalog_changed");
    query.access_revision = Some(7);
    let second = registry.manual_catalog_with_access(&query, Some(&access)).unwrap();
    assert_eq!(second["items"].as_array().unwrap().len(), 15);
    assert_eq!(second["items"][0]["capabilityId"], "text.140");
    access.revision = 8;
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap_err(), "catalog_changed");
    query.offset = 0; query.access_revision = None; query.view = CatalogView::Recent;
    let recent = registry.manual_catalog_with_access(&query, Some(&access)).unwrap();
    assert_eq!(recent["items"].as_array().unwrap().iter().map(|item|item["capabilityId"].as_str().unwrap()).collect::<Vec<_>>(), vec!["text.204", "text.002", "text.150"]);
    query.query = "204".into();
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap()["total"], 1);
    query.query = "".into(); query.view = CatalogView::Favorites;
    access.favorites.clear();
    assert_eq!(registry.manual_catalog_with_access(&query, Some(&access)).unwrap()["total"], 0);
    assert_eq!(registry.manual_catalog(&query).unwrap_err(), "invalid_parameters");
}

pub(super) fn registry() -> PluginRegistry {
    let manifest = serde_json::from_value(json!({
        "schemaVersion":1,"id":"com.zicode.catalog-fixture","name":"目录 Fixture",
        "description":"Text conversion","version":"0.1.0","publisher":"zicode",
        "runtime":{"wasi":"runtime/tools.wasm"},
        "permissions":{"optional":[{"name":"pi.tools.register","reason":"AI only"}]},
        "contributes":{"capabilities":(0..205).map(|i| json!({
            "id":format!("text.{i:03}"),"title":format!("转换 {i:03}"),
            "inputSchema":{"type":"object","properties":{"text":{"type":"string"}},"required":["text"]}
        })).collect::<Vec<_>>()}
    })).unwrap();
    PluginRegistry {
        root: PathBuf::from("unused-read-only-fixture"),
        plugins: BTreeMap::from([(
            "com.zicode.catalog-fixture".into(),
            InstalledPlugin {
                execution_revision: uuid::Uuid::new_v4(),
                content_digest: None,
                publisher_identity: None,
                retained_versions: Vec::new(),
                manifest,
                origin: PluginOrigin::Developer,
                core: false,
                enabled_by_default: true,
                package_root: None,
            },
        )]),
        diagnostics: Vec::new(),
        state: RegistryState::default(),
        result_epoch: std::sync::atomic::AtomicU64::new(1),
    }
}

#[test]
fn metadata_pages_are_bounded_stable_and_independent_of_pi_permission() {
    let registry = registry();
    let mut manifests: Vec<_> = registry
        .plugins
        .values()
        .map(|plugin| &plugin.manifest)
        .collect();
    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    let previous_bytes = serde_json::to_vec(&(
        "programming",
        registry.result_epoch(),
        &registry.state,
        manifests,
    ))
    .unwrap();
    assert_eq!(
        registry.manual_revision("programming"),
        format!("{:x}", Sha256::digest(previous_bytes))
    );
    let mut query = CatalogQuery {
        scene_id: "programming".into(),
        ..Default::default()
    };
    assert!(registry.pi_tools("programming").is_empty());
    let first = registry.manual_catalog(&query).unwrap();
    assert_eq!(first["total"], 205);
    assert_eq!(first["items"].as_array().unwrap().len(), 40);
    assert!(!first.to_string().contains("inputSchema"));
    assert!(!first.to_string().contains("tools.wasm"));
    let revision = first["revision"].as_str().unwrap().to_owned();
    query.revision = Some(revision.clone());
    let mut ids = Vec::new();
    loop {
        let page = registry.manual_catalog(&query).unwrap();
        ids.extend(
            page["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|i| i["toolId"].as_str().unwrap().to_owned()),
        );
        if let Some(offset) = page["nextOffset"].as_u64() {
            query.offset = offset as usize;
        } else {
            break;
        }
    }
    assert_eq!(ids.len(), 205);
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), 205);
    let detail = registry
        .manual_tool_detail(&DetailQuery {
            scene_id: "programming".into(),
            plugin_id: "com.zicode.catalog-fixture".into(),
            capability_id: "text.204".into(),
            revision,
            resource_mime_type: None,
        })
        .unwrap();
    assert_eq!(
        detail["capability"]["inputSchema"]["properties"]["text"]["type"],
        "string"
    );
    assert_eq!(detail["permissions"][0]["granted"], false);
    assert_eq!(detail["enabled"], true);
}

#[test]
fn search_and_stale_detail_have_explicit_boundaries() {
    let mut registry = registry();
    let query = CatalogQuery {
        scene_id: "programming".into(),
        query: "目录 204".into(),
        ..Default::default()
    };
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 1);
    let mut detail = DetailQuery {
        scene_id: "programming".into(),
        plugin_id: "com.zicode.catalog-fixture".into(),
        capability_id: "text.204".into(),
        revision: page["revision"].as_str().unwrap().to_owned(),
        resource_mime_type: None,
    };
    registry
        .scene_plugin_state_mut("programming", &detail.plugin_id)
        .enabled = Some(false);
    registry
        .result_epoch
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    assert_eq!(
        registry.manual_tool_detail(&detail).unwrap_err(),
        "catalog_changed"
    );
    let new_page = registry.manual_catalog(&query).unwrap();
    assert_eq!(new_page["items"][0]["status"], "plugin_disabled");
    detail.revision = new_page["revision"].as_str().unwrap().to_owned();
    assert_eq!(
        registry.manual_tool_detail(&detail).unwrap()["enabled"],
        false
    );
    detail.scene_id = "writing".into();
    assert_eq!(
        registry.manual_tool_detail(&detail).unwrap_err(),
        "catalog_changed"
    );
    assert_eq!(
        registry
            .manual_catalog(&CatalogQuery {
                offset: 40,
                revision: None,
                ..query
            })
            .unwrap_err(),
        "catalog_changed"
    );
    assert_eq!(
        registry
            .manual_catalog(&CatalogQuery {
                scene_id: "../bad".into(),
                ..Default::default()
            })
            .unwrap_err(),
        "invalid_parameters"
    );
}

#[test]
fn built_in_translation_is_searchable_by_its_displayed_chinese_name() {
    let mut registry = registry();
    let value = super::super::builtin_manifests()
        .into_iter()
        .map(|(value, _, _)| value)
        .find(|value| value["id"] == "com.zicode.translate")
        .unwrap();
    let manifest: PluginManifest = serde_json::from_value(value).unwrap();
    super::super::validate_manifest(&manifest, None).unwrap();
    registry.plugins.insert(manifest.id.clone(), InstalledPlugin {
        execution_revision: uuid::Uuid::new_v4(),
        content_digest: None,
        publisher_identity: None,
        retained_versions: Vec::new(),
        manifest,
        origin: PluginOrigin::BuiltIn,
        core: false,
        enabled_by_default: true,
        package_root: None,
    });
    for query in ["翻译", "翻译文本", "Translate"] {
        let page = registry.manual_catalog(&CatalogQuery {
            scene_id: "programming".into(),
            query: query.into(),
            ..Default::default()
        }).unwrap();
        assert!(page["items"].as_array().unwrap().iter().any(|item| {
            item["pluginId"] == "com.zicode.translate"
                && item["capabilityId"] == "translate.text"
        }), "search query: {query}");
    }
}

#[test]
fn built_in_notes_have_searchable_chinese_names_and_a_shared_category() {
    let mut registry = registry();
    let value = super::super::builtin_manifests()
        .into_iter()
        .map(|(value, _, _)| value)
        .find(|value| value["id"] == "com.zicode.notes")
        .unwrap();
    let manifest: PluginManifest = serde_json::from_value(value).unwrap();
    super::super::validate_manifest(&manifest, None).unwrap();
    registry.plugins.insert(manifest.id.clone(), InstalledPlugin {
        execution_revision: uuid::Uuid::new_v4(),
        content_digest: None,
        publisher_identity: None,
        retained_versions: Vec::new(),
        manifest,
        origin: PluginOrigin::BuiltIn,
        core: false,
        enabled_by_default: true,
        package_root: None,
    });
    for (query, capability) in [
        ("搜索笔记", "notes.search"),
        ("读取笔记", "notes.get"),
        ("创建笔记", "notes.create"),
        ("提取网页正文", "notes.extractWeb"),
    ] {
        let page = registry.manual_catalog(&CatalogQuery {
            scene_id: "programming".into(),
            query: query.into(),
            category_id: Some("knowledge".into()),
            ..Default::default()
        }).unwrap();
        assert_eq!(page["total"], 1, "search query: {query}");
        assert_eq!(page["items"][0]["capabilityId"], capability);
        assert_eq!(page["items"][0]["categoryId"], "knowledge");
    }
}

#[test]
fn every_builtin_tool_has_a_category_and_a_chinese_search_alias() {
    let mut registry = registry();
    registry.plugins.clear();
    for (value, core, enabled_by_default) in super::super::builtin_manifests() {
        let manifest: PluginManifest = serde_json::from_value(value).unwrap();
        super::super::validate_manifest(&manifest, None).unwrap();
        registry.plugins.insert(manifest.id.clone(), InstalledPlugin {
            execution_revision: uuid::Uuid::new_v4(),
            content_digest: None,
            publisher_identity: None,
            retained_versions: Vec::new(),
            manifest,
            origin: PluginOrigin::BuiltIn,
            core,
            enabled_by_default,
            package_root: None,
        });
    }
    let query = CatalogQuery { scene_id: "programming".into(), ..Default::default() };
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 16);
    assert!(page["categories"].as_array().unwrap().iter().all(|entry| {
        entry["id"] != "uncategorized"
    }));
    for (search, capability) in [
        ("加入剪贴板收件箱", "clipboard.add"),
        ("查看剪贴板收件箱", "clipboard.list"),
        ("导入文档", "documents.import"),
        ("习惯列表", "habits.list"),
        ("习惯打卡", "habits.toggle"),
        ("排版证件照", "idphoto.layout"),
        ("处理图片", "imagetools.process"),
        ("拼接图片", "imagetools.concat"),
        ("新建笔记", "notes.create"),
        ("提取网页正文", "notes.extractWeb"),
        ("读取笔记", "notes.get"),
        ("搜索笔记", "notes.search"),
        ("图片文字识别", "ocr.text"),
        ("翻译文本", "translate.text"),
        ("添加网页监控", "watch.add"),
        ("检查网页监控", "watch.check"),
    ] {
        let result = registry.manual_catalog(&CatalogQuery {
            scene_id: "programming".into(),
            query: search.into(),
            ..Default::default()
        }).unwrap();
        assert_eq!(result["total"], 1, "search query: {search}");
        assert_eq!(result["items"][0]["capabilityId"], capability);
    }
}

#[test]
fn host_resource_receiver_is_only_offered_for_explicit_resource_sharing() {
    let mut registry = registry();
    registry.plugins.clear();
    for (value, core, enabled_by_default) in super::super::builtin_manifests() {
        let manifest: PluginManifest = serde_json::from_value(value).unwrap();
        super::super::validate_manifest(&manifest, None).unwrap();
        registry.plugins.insert(manifest.id.clone(), InstalledPlugin {
            execution_revision: uuid::Uuid::new_v4(), content_digest: None, publisher_identity: None, retained_versions: Vec::new(), manifest,
            origin: PluginOrigin::BuiltIn, core, enabled_by_default, package_root: None,
        });
    }
    let query = CatalogQuery { scene_id: "programming".into(), resource_only: true,
        resource_mime_type: Some("image/png".into()), ..Default::default() };
    let page = registry.manual_catalog(&query).unwrap();
    assert_eq!(page["total"], 1);
    assert_eq!(page["items"][0]["pluginId"], crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID);
    assert_eq!(page["items"][0]["capabilityId"], crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID);
    assert_eq!(page["items"][0]["runtime"], "builtin");
    let detail = registry.manual_tool_detail(&DetailQuery {
        scene_id: "programming".into(),
        plugin_id: crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_PLUGIN_ID.into(),
        capability_id: crate::plugin_resource_execution::HOST_IMAGE_INSPECTOR_CAPABILITY_ID.into(),
        revision: page["revision"].as_str().unwrap().into(),
        resource_mime_type: Some("image/png".into()),
    }).unwrap();
    assert_eq!(detail["resourceInputProfile"], crate::plugin_resource_execution::HOST_IMAGE_INPUT_PROFILE);
    let normal = registry.manual_catalog(&CatalogQuery { scene_id: "programming".into(), ..Default::default() }).unwrap();
    assert!(!normal.to_string().contains("com.zicode.resource-inspector"));
    assert!(!normal.to_string().contains("com.zicode.text-inspector"));
    let text = registry.manual_catalog(&CatalogQuery { scene_id: "programming".into(),
        resource_only: true, resource_mime_type: Some("text/plain".into()), ..Default::default() }).unwrap();
    assert_eq!(text["total"], 1);
    assert_eq!(text["items"][0]["pluginId"], crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID);
    let excluded = registry.manual_catalog(&CatalogQuery { scene_id: "programming".into(),
        resource_only: true, resource_mime_type: Some("text/plain".into()),
        exclude_plugin_id: Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID.into()),
        exclude_capability_id: Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID.into()),
        ..Default::default() }).unwrap();
    assert_eq!(excluded["total"], 0);
    assert_eq!(excluded["items"], json!([]));
    assert_eq!(excluded["sources"], json!([]));
    assert_eq!(excluded["categories"], json!([]));
    assert!(registry.manual_catalog(&CatalogQuery { scene_id: "programming".into(),
        resource_only: true, resource_mime_type: Some("text/plain".into()),
        exclude_plugin_id: Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID.into()),
        ..Default::default() }).is_err());
    assert!(registry.manual_catalog(&CatalogQuery { scene_id: "programming".into(),
        exclude_plugin_id: Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_PLUGIN_ID.into()),
        exclude_capability_id: Some(crate::plugin_resource_execution::HOST_TEXT_INSPECTOR_CAPABILITY_ID.into()),
        ..Default::default() }).is_err());
    let directory = CatalogQuery { resource_only: false, directory_only: true,
        resource_mime_type: None, ..query };
    assert_eq!(registry.manual_catalog(&directory).unwrap()["total"], 0);
}

//! Lightweight plugin listing for the WebView. Detailed capability schemas stay on
//! the explicit tool-detail route instead of being copied into every directory refresh.
use super::PluginListing;
use serde_json::{json, Value};

pub(super) fn summary(plugin: &PluginListing<'_>) -> Value {
    let manifest = plugin.manifest;
    let contributes = &manifest.contributes;
    let capabilities: Vec<Value> = contributes
        .get("capabilities")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|capability| {
            json!({
                "id": capability.get("id"),
                "title": capability.get("title"),
                "description": capability.get("description"),
            })
        })
        .collect();
    let view_operations: Vec<Value> = contributes
        .get("viewOperations")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|operation| {
            json!({
                "id": operation.get("id"),
                "title": operation.get("title"),
                "viewId": operation.get("viewId"),
                "directory": operation.get("directory"),
                "sourceToolId": operation.get("sourceToolId"),
            })
        })
        .collect();
    json!({
        "schemaVersion": manifest.schema_version,
        "id": manifest.id,
        "name": manifest.name,
        "displayName": manifest.display_name,
        "description": manifest.description,
        "version": manifest.version,
        "publisher": manifest.publisher,
        "toolOpenProfile": manifest.required_profiles.get("tool.open.v1").is_some(),
        "viewOperationDirectoryProfile": manifest.required_profiles.get("view.operation.directory.v1").is_some(),
        "permissions": manifest.permissions,
        "contributes": {
            "activities": contributes.get("activities"),
            "views": contributes.get("views"),
            "commands": contributes.get("commands"),
            "capabilities": capabilities,
            "viewOperations": view_operations,
        },
        "origin": plugin.origin,
        "enabled": plugin.enabled,
        "core": plugin.core,
        "permissionGrants": plugin.permission_grants,
        "publisherKeyId": plugin.publisher_key_id,
        "retainedVersions": plugin.retained_versions,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_registry::{ManifestPermissions, PluginManifest, PluginOrigin};
    use std::collections::BTreeMap;

    #[test]
    fn directory_summary_keeps_ui_metadata_but_omits_execution_contracts() {
        let manifest = PluginManifest {
            schema_version: 2,
            id: "example.package".into(),
            name: "Example".into(),
            display_name: Some("示例".into()),
            description: "A fixture".into(),
            version: "0.1.0".into(),
            publisher: "example".into(),
            engines: json!({"pluginApi":"^1.0.0"}),
            required_profiles: json!({"application.directory.v1":"=1.0.0-preview.1", "tool.open.v1":"=1.0.0-preview.1", "view.operation.directory.v1":"=1.0.0-preview.1"}),
            activation_events: vec!["onView:main".into()],
            runtime: json!({"wasi":"runtime/tool.wasm"}),
            contributes: json!({
                "activities":[{"id":"activity","title":"Example","directory":{"categoryId":"data"}}],
                "views":[{"id":"main","location":"main","entry":"views/main.html"}],
                "commands":[{"id":"open","title":"Open"}],
                "capabilities":[{"id":"run","title":"Run","description":"Compute",
                    "inputSchema":{"type":"object","properties":{"secret":{"type":"string"}}},
                    "outputSchema":{"type":"object"}}],
                "viewOperations":[{"id":"show.report","title":"Report","viewId":"main",
                    "directory":{"categoryId":"system","aliases":["Report"]}}],
                "piTools":[{"name":"example.run"}]
            }),
            permissions: ManifestPermissions::default(),
        };
        let plugin = PluginListing {
            manifest: &manifest,
            origin: PluginOrigin::Developer,
            enabled: true,
            core: false,
            permission_grants: BTreeMap::new(),
            publisher_key_id: None,
            retained_versions: Vec::new(),
        };
        let output = summary(&plugin);
        assert_eq!(
            output["contributes"]["activities"][0]["directory"]["categoryId"],
            "data"
        );
        assert_eq!(
            output["contributes"]["views"][0]["entry"],
            "views/main.html"
        );
        assert_eq!(output["contributes"]["capabilities"][0]["id"], "run");
        assert_eq!(output["toolOpenProfile"], true);
        assert_eq!(output["viewOperationDirectoryProfile"], true);
        assert_eq!(
            output["contributes"]["viewOperations"][0]["id"],
            "show.report"
        );
        assert_eq!(output["contributes"]["viewOperations"][0]["viewId"], "main");
        assert_eq!(
            output["contributes"]["capabilities"][0]["description"],
            "Compute"
        );
        assert!(output["contributes"]["capabilities"][0]
            .get("inputSchema")
            .is_none());
        assert!(output["contributes"].get("piTools").is_none());
        assert!(output.get("runtime").is_none());
        assert!(output.get("requiredProfiles").is_none());
    }
}

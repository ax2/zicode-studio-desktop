use super::*;
use crate::metadata_store::MetadataStore;
use std::fs;

#[tokio::test]
async fn application_directory_profile_survives_install_listing_and_view_lifecycle() {
    let scratch = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch");
    let root = scratch.join(format!(
        "application-directory-host-{}",
        uuid::Uuid::new_v4()
    ));
    let public = root.join("public");
    let source = root.join("source");
    fs::create_dir_all(&public).unwrap();
    fs::create_dir_all(source.join("views")).unwrap();
    fs::write(public.join("index.html"), "Studio directory fixture").unwrap();
    fs::write(
        root.join("owner.json"),
        r#"{"purpose":"Studio application directory Host acceptance","removeOnSuccess":true}"#,
    )
    .unwrap();
    fs::write(
        source.join("views/main.html"),
        "<!doctype html><title>Directory fixture</title>",
    )
    .unwrap();
    let plugin_id = "com.example.application-directory";
    fs::write(
        source.join("plugin.json"),
        serde_json::to_vec(&json!({
            "schemaVersion": 2,
            "id": plugin_id,
            "name": "Directory fixture",
            "description": "Studio-owned view acceptance",
            "version": "0.1.0",
            "publisher": "studio-test",
            "engines": {"zicode": ">=0.1.0 <1.0.0", "pluginApi": "^1.0.0"},
            "requiredProfiles": {"application.directory.v1": "=1.0.0-preview.1"},
            "activationEvents": ["onView:directory.main"],
            "contributes": {
                "activities": [{"id": "directory.application", "title": "Directory fixture",
                    "directory": {"categoryId": "system", "aliases": ["服务健康"],
                        "description": "Inspect a service"}}],
                "views": [{"id": "directory.main", "activity": "directory.application",
                    "location": "main", "title": "Main", "entry": "views/main.html"}],
                "capabilities": [], "commands": [], "piTools": []
            },
            "permissions": {"required": [], "optional": []}
        }))
        .unwrap(),
    )
    .unwrap();
    let metadata = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let auth = Arc::new(Mutex::new(RemoteAuth::new(Arc::new(Mutex::new(metadata)))));
    let host = HostServer::start(public, NativePiManager::new(16), auth)
        .await
        .unwrap();
    let client = reqwest::Client::builder().no_proxy().build().unwrap();
    let list_url = format!(
        "{}/v2/plugins?sceneId=programming&summary=true",
        host.origin()
    );
    let view_url = format!(
        "{}/v2/plugin-views/source?sceneId=programming&pluginId={plugin_id}&viewId=directory.main",
        host.origin()
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        assert_eq!(registry.install_developer(&source).unwrap(), plugin_id);
    }
    let listed: Value = client
        .get(&list_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let plugin = listed["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|plugin| plugin["id"] == plugin_id)
        .unwrap();
    assert_eq!(plugin["enabled"], false);
    assert_eq!(
        plugin["contributes"]["activities"][0]["directory"]["categoryId"],
        "system"
    );
    assert_eq!(
        plugin["contributes"]["activities"][0]["directory"]["aliases"][0],
        "服务健康"
    );
    assert_eq!(
        plugin["contributes"]["activities"][0]["directory"]["description"],
        "Inspect a service"
    );
    assert_eq!(plugin["contributes"]["capabilities"], json!([]));
    assert_eq!(
        client
            .get(&view_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, true)
            .unwrap();
    }
    let listed: Value = client
        .get(&list_url)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let plugin = listed["plugins"]
        .as_array()
        .unwrap()
        .iter()
        .find(|plugin| plugin["id"] == plugin_id)
        .unwrap();
    assert_eq!(plugin["enabled"], true);
    let view: Value = client
        .get(&view_url)
        .header("x-zicode-desktop-token", host.desktop_token())
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(view["view"]["viewId"], "directory.main");
    assert!(view["view"]["html"]
        .as_str()
        .unwrap()
        .contains("Directory fixture"));
    {
        let mut registry = host.state.plugins.lock().unwrap();
        registry
            .set_enabled("programming", plugin_id, false)
            .unwrap();
    }
    assert_eq!(
        client
            .get(&view_url)
            .header("x-zicode-desktop-token", host.desktop_token())
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    host.stop_and_wait().await.unwrap();
    assert!(root
        .canonicalize()
        .unwrap()
        .starts_with(scratch.canonicalize().unwrap()));
    fs::remove_dir_all(root).unwrap();
}

//! Article publishing configuration: WeChat Official Account and the blog
//! server (Astro static site) credentials. The config is global (not
//! workspace- or scene-scoped) and lives under the system root so a single
//! publishing destination is shared across all scenes.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArticlePublishingConfig {
    #[serde(default = "default_version")]
    version: u32,
    #[serde(default)]
    pub wechat: WechatConfig,
    #[serde(default)]
    pub blog: BlogServerConfig,
}

fn default_version() -> u32 {
    CONFIG_VERSION
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WechatConfig {
    pub app_id: String,
    pub app_secret: String,
    #[serde(default = "default_site_url")]
    pub site_url: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub thumb_image_path: Option<String>,
    #[serde(default)]
    pub open_comment: bool,
    #[serde(default)]
    pub fans_can_comment: bool,
}

fn default_site_url() -> String {
    "https://zicode.com".to_string()
}

impl Default for WechatConfig {
    fn default() -> Self {
        Self {
            app_id: String::new(),
            app_secret: String::new(),
            site_url: default_site_url(),
            author: String::new(),
            thumb_image_path: None,
            open_comment: false,
            fans_can_comment: false,
        }
    }
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BlogServerConfig {
    pub host: String,
    pub username: String,
    pub password: String,
    /// Remote directory that hosts the built static site (astro_publish_path).
    pub remote_dir: String,
    /// Local directory containing the Astro source to copy for initial sync.
    #[serde(default)]
    pub source_dir: Option<String>,
    /// Trust-on-first-use SSH host key fingerprint (SHA-256 hex). Empty until
    /// the first successful connection.
    #[serde(default)]
    pub host_key_fingerprint: Option<String>,
}

pub fn config_path(system_root: &Path) -> PathBuf {
    system_root.join("articles").join("config.json")
}

pub fn load(system_root: &Path) -> Result<ArticlePublishingConfig, String> {
    let path = config_path(system_root);
    if !path.is_file() {
        return Ok(ArticlePublishingConfig::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read article config {}: {error}", path.display()))?;
    serde_json::from_str(&raw)
        .map_err(|error| format!("Cannot parse article config {}: {error}", path.display()))
}

pub fn save(system_root: &Path, config: &ArticlePublishingConfig) -> Result<(), String> {
    let path = config_path(system_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create article config dir: {error}"))?;
    }
    let payload = serde_json::to_string_pretty(config)
        .map_err(|error| format!("Cannot serialize article config: {error}"))?;
    let mut file = fs::File::create(&path)
        .map_err(|error| format!("Cannot write article config {}: {error}", path.display()))?;
    file.write_all(payload.as_bytes())
        .map_err(|error| format!("Cannot write article config {}: {error}", path.display()))?;
    Ok(())
}

/// Redact secrets before returning the config to the frontend. The real
/// secrets stay on disk only; the UI shows placeholders once they are set.
pub fn redacted(config: &ArticlePublishingConfig) -> serde_json::Value {
    serde_json::json!({
        "wechat": {
            "appId": config.wechat.app_id,
            "appSecretSet": !config.wechat.app_secret.is_empty(),
            "siteUrl": config.wechat.site_url,
            "author": config.wechat.author,
            "thumbImagePath": config.wechat.thumb_image_path,
            "openComment": config.wechat.open_comment,
            "fansCanComment": config.wechat.fans_can_comment,
        },
        "blog": {
            "host": config.blog.host,
            "username": config.blog.username,
            "passwordSet": !config.blog.password.is_empty(),
            "remoteDir": config.blog.remote_dir,
            "sourceDir": config.blog.source_dir,
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("articles-config-{}", uuid::Uuid::new_v4().simple()))
    }

    #[test]
    fn round_trips_config_and_redacts_secrets() {
        let root = tmp_root();
        let config = ArticlePublishingConfig {
            version: CONFIG_VERSION,
            wechat: WechatConfig {
                app_id: "wx-app".to_string(),
                app_secret: "secret-value".to_string(),
                site_url: "https://zicode.com".to_string(),
                author: "Alex".to_string(),
                thumb_image_path: None,
                open_comment: false,
                fans_can_comment: false,
            },
            blog: BlogServerConfig {
                host: "www.zicode.com".to_string(),
                username: "root".to_string(),
                password: "password-value".to_string(),
                remote_dir: "/work/zicode-astro".to_string(),
                source_dir: None,
                host_key_fingerprint: Some("abc123".to_string()),
            },
        };
        save(&root, &config).unwrap();
        let loaded = load(&root).unwrap();
        assert_eq!(loaded, config);

        let redacted = redacted(&loaded);
        assert_eq!(redacted["wechat"]["appSecretSet"], true);
        assert_eq!(redacted["blog"]["passwordSet"], true);
        assert!(redacted["wechat"].get("appSecret").is_none());
        assert!(redacted["blog"].get("password").is_none());
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn defaults_when_no_config_exists() {
        let root = tmp_root();
        let loaded = load(&root).unwrap();
        assert_eq!(loaded.wechat.site_url, "https://zicode.com");
        std::fs::remove_dir_all(&root).ok();
    }
}

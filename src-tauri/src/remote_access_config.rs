use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessConfig {
    version: u32,
    pub enabled: bool,
    /// Optional public HTTPS origin exposed through a tunnel (for example
    /// `https://www.zicode.com:39010`). When set, the desktop adds the host
    /// to the TLS certificate, advertises the URL to the phone, and starts a
    /// strictly authenticated public gateway listener for frp to forward.
    #[serde(default)]
    pub public_url: Option<String>,
    /// Optional public HTTP address of the certificate setup page (for
    /// example `http://www.zicode.com:39011`). New phones download the CA
    /// there when they are not on the same LAN.
    #[serde(default)]
    pub public_enrollment_url: Option<String>,
}

impl Default for RemoteAccessConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            enabled: false,
            public_url: None,
            public_enrollment_url: None,
        }
    }
}

pub fn load() -> Result<RemoteAccessConfig, String> {
    load_at(&config_path()?)
}

pub fn set_enabled(enabled: bool) -> Result<RemoteAccessConfig, String> {
    let mut config = load()?;
    config.enabled = enabled;
    save_at(&config_path()?, &config)?;
    Ok(config)
}

/// Persist the optional public tunnel addresses. `None` (or an empty string)
/// clears the value. Invalid URLs are rejected so the settings UI cannot save
/// an origin the TLS certificate cannot cover.
pub fn update_public(
    public_url: Option<String>,
    public_enrollment_url: Option<String>,
) -> Result<RemoteAccessConfig, String> {
    let public_url = normalize_url(public_url)?;
    let public_enrollment_url = normalize_url(public_enrollment_url)?;
    let mut config = load()?;
    config.public_url = public_url;
    config.public_enrollment_url = public_enrollment_url;
    save_at(&config_path()?, &config)?;
    Ok(config)
}

fn normalize_url(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value else { return Ok(None) };
    let value = value.trim().to_string();
    if value.is_empty() {
        return Ok(None);
    }
    if !value.starts_with("https://") && !value.starts_with("http://") {
        return Err("Public addresses must start with http:// or https://".to_string());
    }
    if value.contains(' ') || value.contains('#') {
        return Err("Public addresses must not contain spaces or fragments".to_string());
    }
    Ok(Some(value))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(crate::app_paths::data_root()?
        .join("remote-access")
        .join("config.json"))
}

fn load_at(path: &Path) -> Result<RemoteAccessConfig, String> {
    if !path.is_file() {
        return Ok(RemoteAccessConfig::default());
    }
    let bytes =
        fs::read(path).map_err(|error| format!("Cannot read remote access settings: {error}"))?;
    let config: RemoteAccessConfig = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Invalid remote access settings: {error}"))?;
    if config.version != CONFIG_VERSION {
        return Err(format!(
            "Unsupported remote access settings version {}",
            config.version
        ));
    }
    Ok(config)
}

fn save_at(path: &Path, config: &RemoteAccessConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = parent.join(format!(
        ".remote-access-{}.tmp",
        uuid::Uuid::new_v4().simple()
    ));
    let bytes = serde_json::to_vec_pretty(config)
        .map_err(|error| format!("Cannot encode remote access settings: {error}"))?;
    let write_result = (|| {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("Cannot create temporary remote access settings: {error}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Cannot write remote access settings: {error}"))?;
        let backup = path.with_extension(format!("json.bak-{}", std::process::id()));
        let had_existing = path.is_file();
        if had_existing {
            fs::rename(path, &backup)
                .map_err(|error| format!("Cannot prepare remote access settings: {error}"))?;
        }
        if let Err(error) = fs::rename(&temporary, path) {
            if had_existing {
                let _ = fs::rename(&backup, path);
            }
            return Err(format!("Cannot replace remote access settings: {error}"));
        }
        if had_existing {
            let _ = fs::remove_file(backup);
        }
        Ok(())
    })();
    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    write_result
}

#[cfg(test)]
mod tests {
    use super::{load_at, normalize_url, save_at, RemoteAccessConfig};
    use std::fs;

    #[test]
    fn defaults_to_disabled_and_persists_an_explicit_choice() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");
        assert!(!load_at(&path).unwrap().enabled);

        let enabled = RemoteAccessConfig {
            enabled: true,
            ..RemoteAccessConfig::default()
        };
        save_at(&path, &enabled).unwrap();
        assert_eq!(load_at(&path).unwrap(), enabled);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unknown_versions_instead_of_enabling_access() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-version-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("config.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, r#"{"version":99,"enabled":true}"#).unwrap();
        assert!(load_at(&path)
            .unwrap_err()
            .contains("Unsupported remote access settings version"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn persists_optional_public_tunnel_addresses() {
        let root = std::env::temp_dir().join(format!(
            "zicode-remote-config-public-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let path = root.join("remote-access/config.json");

        let with_public = RemoteAccessConfig {
            version: 1,
            enabled: true,
            public_url: Some("https://www.zicode.com:39010".into()),
            public_enrollment_url: Some("http://www.zicode.com:39011".into()),
        };
        save_at(&path, &with_public).unwrap();

        let loaded = load_at(&path).unwrap();
        assert_eq!(loaded, with_public);
        assert_eq!(
            loaded.public_url.as_deref(),
            Some("https://www.zicode.com:39010")
        );
        assert_eq!(
            loaded.public_enrollment_url.as_deref(),
            Some("http://www.zicode.com:39011")
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn normalizes_optional_public_urls() {
        assert_eq!(normalize_url(None).unwrap(), None);
        assert_eq!(normalize_url(Some("   ".into())).unwrap(), None);
        assert_eq!(
            normalize_url(Some(" https://www.zicode.com:39010 ".into())).unwrap(),
            Some("https://www.zicode.com:39010".into())
        );
        assert!(normalize_url(Some("www.zicode.com".into())).is_err());
        assert!(normalize_url(Some("https://a b.com".into())).is_err());
        assert!(normalize_url(Some("https://x.com/#frag".into())).is_err());
    }
}

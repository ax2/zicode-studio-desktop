use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const CONFIG_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteAccessConfig {
    version: u32,
    pub enabled: bool,
}

impl Default for RemoteAccessConfig {
    fn default() -> Self {
        Self {
            version: CONFIG_VERSION,
            enabled: false,
        }
    }
}

pub fn load() -> Result<RemoteAccessConfig, String> {
    load_at(&config_path()?)
}

pub fn set_enabled(enabled: bool) -> Result<RemoteAccessConfig, String> {
    let config = RemoteAccessConfig {
        enabled,
        ..RemoteAccessConfig::default()
    };
    save_at(&config_path()?, &config)?;
    Ok(config)
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
    use super::{load_at, save_at, RemoteAccessConfig};
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
}

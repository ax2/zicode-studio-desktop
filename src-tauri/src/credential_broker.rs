use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

const SERVICE_NAME: &str = "ZiCode Studio Desktop";
const INDEX_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CredentialIndex {
    version: u32,
    entries: Vec<CredentialIndexEntry>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CredentialIndexEntry {
    scene_id: String,
    provider: String,
    account: String,
}

impl Default for CredentialIndex {
    fn default() -> Self {
        Self {
            version: INDEX_VERSION,
            entries: Vec::new(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub scene_id: String,
    pub provider: String,
    pub configured: bool,
    pub storage: &'static str,
    /// Leading characters of the stored secret (when configured) so editors
    /// can show which key is set without exposing it.
    pub prefix: Option<String>,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct CredentialMigrationReport {
    pub migrated: usize,
    pub removed_orphans: usize,
}

pub fn store_scene_credential(scene_id: &str, provider: &str, secret: &str) -> Result<(), String> {
    let root = crate::app_paths::data_root()?;
    store_scene_credential_at(&root, scene_id, provider, secret)
}

pub fn delete_scene_credential(scene_id: &str, provider: &str) -> Result<(), String> {
    let root = crate::app_paths::data_root()?;
    validate_identifier("scene", scene_id)?;
    validate_identifier("provider", provider)?;
    let mut index = read_index(&root)?;
    let account = credential_account(scene_id, provider);
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, &account) {
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(error) => return Err(format!("Cannot remove the system credential: {error}")),
        }
    }
    index
        .entries
        .retain(|entry| !(entry.scene_id == scene_id && entry.provider == provider));
    write_index(&root, &index)
}

pub fn scene_credential_status(scene_id: &str, provider: &str) -> Result<CredentialStatus, String> {
    validate_identifier("scene", scene_id)?;
    validate_identifier("provider", provider)?;
    let account = credential_account(scene_id, provider);
    let password = keyring::Entry::new(SERVICE_NAME, &account)
        .and_then(|entry| entry.get_password())
        .ok();
    let configured = password
        .as_deref()
        .map(|value| !value.is_empty())
        .unwrap_or(false);
    let prefix = configured.then(|| {
        password
            .as_deref()
            .map(|value| value.chars().take(4).collect::<String>())
    });
    Ok(CredentialStatus {
        scene_id: scene_id.to_string(),
        provider: provider.to_string(),
        configured,
        storage: "system",
        prefix: prefix.flatten(),
    })
}

/// Moves every registered scene's legacy plaintext credential document into
/// the OS vault during application startup. This closes the gap where a scene
/// that has not been opened since the upgrade would otherwise retain its old
/// auth.json indefinitely.
pub fn migrate_registered_scene_credentials<'a>(
    root: &Path,
    scene_ids: impl IntoIterator<Item = &'a str>,
) -> Result<CredentialMigrationReport, String> {
    let mut report = CredentialMigrationReport::default();
    let mut registered_scene_keys = std::collections::HashSet::new();
    for scene_id in scene_ids {
        validate_identifier("scene", scene_id)?;
        let digest = Sha256::digest(scene_id.as_bytes());
        let scene_key = digest[..16]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        registered_scene_keys.insert(scene_key.clone());
        let auth_path = root
            .join("scenes")
            .join(scene_key)
            .join("agent")
            .join("auth.json");
        if !auth_path.is_file() {
            continue;
        }
        migrate_legacy_auth(root, scene_id, &auth_path)?;
        remove_file_if_present(&auth_path)?;
        report.migrated += 1;
    }

    let scenes_root = root.join("scenes");
    if scenes_root.is_dir() {
        for entry in fs::read_dir(&scenes_root)
            .map_err(|error| format!("Cannot scan {}: {error}", scenes_root.display()))?
        {
            let entry = entry.map_err(|error| {
                format!(
                    "Cannot inspect scene storage in {}: {error}",
                    scenes_root.display()
                )
            })?;
            if !entry
                .file_type()
                .map_err(|error| format!("Cannot inspect {}: {error}", entry.path().display()))?
                .is_dir()
            {
                continue;
            }
            let scene_key = entry.file_name().to_string_lossy().into_owned();
            if registered_scene_keys.contains(&scene_key) {
                continue;
            }
            let orphan_auth = entry.path().join("agent").join("auth.json");
            if orphan_auth.is_file() {
                remove_file_if_present(&orphan_auth)?;
                report.removed_orphans += 1;
            }
        }
    }
    Ok(report)
}

/// Migrates Pi's legacy scene-local auth file into the OS credential store and
/// materializes only the compatibility document needed while Pi starts.
pub fn prepare_scene_credentials(
    root: &Path,
    scene_id: &str,
    agent_dir: &Path,
) -> Result<(), String> {
    let auth_path = agent_dir.join("auth.json");
    if auth_path.is_file() {
        migrate_legacy_auth(root, scene_id, &auth_path)?;
    }

    let index = read_index(root)?;
    let mut auth = Map::new();
    for item in index
        .entries
        .iter()
        .filter(|item| item.scene_id == scene_id)
    {
        let password = match keyring::Entry::new(SERVICE_NAME, &item.account)
            .and_then(|entry| entry.get_password())
        {
            Ok(password) => password,
            Err(keyring::Error::NoEntry) => continue,
            Err(error) => {
                return Err(format!(
                    "Cannot read the system credential for provider {}: {error}",
                    item.provider
                ))
            }
        };
        auth.insert(
            item.provider.clone(),
            serde_json::json!({ "type": "api_key", "key": password }),
        );
    }
    if auth.is_empty() {
        remove_file_if_present(&auth_path)?;
    } else {
        write_json_atomic(&auth_path, &Value::Object(auth))?;
    }
    Ok(())
}

fn store_scene_credential_at(
    root: &Path,
    scene_id: &str,
    provider: &str,
    secret: &str,
) -> Result<(), String> {
    validate_identifier("scene", scene_id)?;
    validate_identifier("provider", provider)?;
    if secret.trim().is_empty() || secret.len() > 16_384 {
        return Err("Credential must contain between 1 and 16384 characters".to_string());
    }
    let account = credential_account(scene_id, provider);
    keyring::Entry::new(SERVICE_NAME, &account)
        .and_then(|entry| entry.set_password(secret))
        .map_err(|error| format!("Cannot store the credential in the system vault: {error}"))?;
    let mut index = read_index(root)?;
    index
        .entries
        .retain(|entry| !(entry.scene_id == scene_id && entry.provider == provider));
    index.entries.push(CredentialIndexEntry {
        scene_id: scene_id.to_string(),
        provider: provider.to_string(),
        account,
    });
    index.entries.sort_by(|left, right| {
        (&left.scene_id, &left.provider).cmp(&(&right.scene_id, &right.provider))
    });
    write_index(root, &index)
}

fn migrate_legacy_auth(root: &Path, scene_id: &str, auth_path: &Path) -> Result<(), String> {
    let text = fs::read_to_string(auth_path)
        .map_err(|error| format!("Cannot read {}: {error}", auth_path.display()))?;
    let value: Value = serde_json::from_str(&text).map_err(|error| {
        format!(
            "Invalid credential document {}: {error}",
            auth_path.display()
        )
    })?;
    let Some(providers) = value.as_object() else {
        return Err(format!(
            "Credential document must be an object: {}",
            auth_path.display()
        ));
    };
    for (provider, credential) in providers {
        let secret = credential
            .as_str()
            .or_else(|| credential.get("key").and_then(Value::as_str));
        if let Some(secret) = secret.filter(|value| !value.trim().is_empty()) {
            store_scene_credential_at(root, scene_id, provider, secret)?;
        }
    }
    Ok(())
}

fn credential_account(scene_id: &str, provider: &str) -> String {
    let digest = Sha256::digest(format!("{scene_id}\0{provider}").as_bytes());
    format!(
        "scene-provider-{}",
        digest[..20]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn validate_identifier(label: &str, value: &str) -> Result<(), String> {
    let valid = !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'));
    if valid {
        Ok(())
    } else {
        Err(format!("Invalid {label} identifier"))
    }
}

fn index_path(root: &Path) -> PathBuf {
    root.join("credentials").join("index.json")
}

fn read_index(root: &Path) -> Result<CredentialIndex, String> {
    let path = index_path(root);
    if !path.is_file() {
        return Ok(CredentialIndex::default());
    }
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
    let index: CredentialIndex = serde_json::from_str(&text)
        .map_err(|error| format!("Invalid credential index {}: {error}", path.display()))?;
    if index.version != INDEX_VERSION {
        return Err(format!(
            "Unsupported credential index version {}",
            index.version
        ));
    }
    Ok(index)
}

fn write_index(root: &Path, index: &CredentialIndex) -> Result<(), String> {
    let value = serde_json::to_value(index)
        .map_err(|error| format!("Cannot encode credential index: {error}"))?;
    write_json_atomic(&index_path(root), &value)
}

fn write_json_atomic(path: &Path, value: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("Path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = path.with_extension(format!("json.tmp-{}", std::process::id()));
    let contents = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Cannot encode {}: {error}", path.display()))?;
    fs::write(&temporary, format!("{contents}\n"))
        .map_err(|error| format!("Cannot write {}: {error}", temporary.display()))?;
    let backup = path.with_extension(format!("json.bak-{}", std::process::id()));
    let had_existing = path.is_file();
    if had_existing {
        fs::rename(path, &backup).map_err(|error| {
            format!("Cannot prepare replacement for {}: {error}", path.display())
        })?;
    }
    if let Err(error) = fs::rename(&temporary, path) {
        if had_existing {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("Cannot replace {}: {error}", path.display()));
    }
    if had_existing {
        let _ = fs::remove_file(backup);
    }
    Ok(())
}

fn remove_file_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot remove {}: {error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_accounts_are_opaque_and_stable() {
        let first = credential_account("finance", "qveris");
        assert_eq!(first, credential_account("finance", "qveris"));
        assert_ne!(first, credential_account("programming", "qveris"));
        assert!(!first.contains("finance"));
        assert!(!first.contains("qveris"));
    }

    #[test]
    fn index_contains_references_but_never_secrets() {
        let root =
            std::env::temp_dir().join(format!("zicode-credential-index-{}", uuid::Uuid::new_v4()));
        let index = CredentialIndex {
            version: INDEX_VERSION,
            entries: vec![CredentialIndexEntry {
                scene_id: "finance".to_string(),
                provider: "qveris".to_string(),
                account: credential_account("finance", "qveris"),
            }],
        };
        write_index(&root, &index).unwrap();
        let contents = fs::read_to_string(index_path(&root)).unwrap();
        assert!(contents.contains("qveris"));
        assert!(!contents.contains("sk-test-secret"));
        assert_eq!(read_index(&root).unwrap(), index);
        write_index(&root, &index).unwrap();
        assert_eq!(read_index(&root).unwrap(), index);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_path_like_identifiers() {
        assert!(validate_identifier("scene", "../finance").is_err());
        assert!(validate_identifier("provider", "qveris/other").is_err());
        assert!(validate_identifier("provider", "openai").is_ok());
    }

    #[test]
    fn registered_scene_migration_ignores_scenes_without_legacy_files() {
        let root = std::env::temp_dir().join(format!(
            "zicode-credential-startup-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();

        assert_eq!(
            migrate_registered_scene_credentials(&root, ["programming", "finance"]).unwrap(),
            CredentialMigrationReport::default()
        );
        assert!(migrate_registered_scene_credentials(&root, ["../unsafe"]).is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn startup_migration_removes_unregistered_plaintext_credentials() {
        let root =
            std::env::temp_dir().join(format!("zicode-credential-orphan-{}", uuid::Uuid::new_v4()));
        let orphan = root.join("scenes").join("not-a-scene-key").join("agent");
        fs::create_dir_all(&orphan).unwrap();
        fs::write(
            orphan.join("auth.json"),
            br#"{"provider":{"key":"secret"}}"#,
        )
        .unwrap();

        let report = migrate_registered_scene_credentials(&root, ["programming"]).unwrap();

        assert_eq!(report.migrated, 0);
        assert_eq!(report.removed_orphans, 1);
        assert!(!orphan.join("auth.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
}

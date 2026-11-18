//! Workspace-scoped cloud configuration and internal credential resolution. No network operations.
mod command;
mod resolver;
pub(crate) use resolver::{lock_current_config, resolve_for_sync};
mod secrets;
mod storage;
#[cfg(test)]
mod tests;

use crate::notes_sync::SyncKey;
pub(crate) use command::notes_sync_settings;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;
use uuid::Uuid;

type Result<T> = std::result::Result<T, &'static str>;
use secrets::Secrets;
use storage::Storage;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Connection {
    endpoint: String,
    username: String,
    vault_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Save {
    expected_revision: Option<String>,
    connection: Connection,
    password: Option<String>,
    recovery_code: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    schema: u32,
    workspace: String,
    revision: String,
    connection: Connection,
    password_ref: Option<String>,
    key_ref: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Status {
    revision: Option<String>,
    connection: Connection,
    password_configured: bool,
    key_configured: bool,
    credential_storage: &'static str,
    state: &'static str,
    sync_available: bool,
}

fn valid_id(value: &str) -> bool {
    Uuid::parse_str(value).is_ok_and(|id| id.to_string() == value)
}

fn workspace_key(workspace: &str) -> Result<String> {
    if workspace.is_empty() || workspace.len() > 256 || workspace.chars().any(char::is_control) {
        return Err("notes_sync_workspace_unavailable");
    }
    Ok(format!("{:x}", Sha256::digest(workspace.as_bytes())))
}

// Personal paths remain stable; named profiles own separate metadata as well as secrets.
fn configuration_key(workspace: &str, test_name: Option<&str>) -> Result<String> {
    let personal = workspace_key(workspace)?;
    let Some(name) = test_name else {
        return Ok(personal);
    };
    if name.is_empty() || name.len() > 128 || name.chars().any(char::is_control) {
        return Err("notes_sync_settings_invalid");
    }
    Ok(format!(
        "named-{:x}",
        Sha256::digest(format!("notes-sync-config-v1\0{name}\0{workspace}").as_bytes())
    ))
}

fn validate_connection(connection: &Connection) -> Result<()> {
    let url =
        reqwest::Url::parse(&connection.endpoint).map_err(|_| "notes_sync_invalid_endpoint")?;
    if connection.endpoint.len() > 2048
        || url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("notes_sync_invalid_endpoint");
    }
    if connection.username.trim().is_empty() || connection.username.len() > 1024 {
        return Err("notes_sync_invalid_username");
    }
    if !valid_id(&connection.vault_id) {
        return Err("notes_sync_invalid_vault_id");
    }
    Ok(())
}

fn validate_config(config: &Config, workspace: &str) -> Result<()> {
    if config.schema != 1
        || config.workspace != workspace
        || !valid_id(&config.revision)
        || config
            .password_ref
            .as_deref()
            .is_some_and(|id| !valid_id(id))
        || config.key_ref.as_deref().is_some_and(|id| !valid_id(id))
    {
        return Err("notes_sync_settings_invalid");
    }
    validate_connection(&config.connection).map_err(|_| "notes_sync_settings_invalid")
}

fn account(
    root: &Path,
    test_name: Option<&str>,
    workspace: &str,
    reference: &str,
    kind: &str,
) -> String {
    let root = root.to_string_lossy().into_owned();
    #[cfg(windows)]
    let root = root.to_lowercase();
    let digest = Sha256::digest(
        format!(
            "notes-sync-v1\0{root}\0{}\0{workspace}\0{reference}\0{kind}",
            test_name.unwrap_or("")
        )
        .as_bytes(),
    );
    format!("notes-sync-{:x}", digest)
}

fn read(store: &Storage, workspace: &str) -> Result<Option<Config>> {
    let Some(bytes) = store.read_current()? else {
        return Ok(None);
    };
    let config: Config =
        serde_json::from_slice(&bytes).map_err(|_| "notes_sync_settings_invalid")?;
    validate_config(&config, workspace)?;
    Ok(Some(config))
}

fn status(
    root: &Path,
    test_name: Option<&str>,
    workspace: &str,
    enabled: bool,
    secrets: &impl Secrets,
) -> Result<Status> {
    let key = configuration_key(workspace, test_name)?;
    let config = Storage::open(root, &key, false)?
        .as_ref()
        .map(|store| read(store, workspace))
        .transpose()?
        .flatten();
    let mut result = Status {
        revision: config.as_ref().map(|config| config.revision.clone()),
        connection: config
            .as_ref()
            .map(|config| config.connection.clone())
            .unwrap_or(Connection {
                endpoint: String::new(),
                username: String::new(),
                vault_id: Uuid::new_v4().to_string(),
            }),
        password_configured: false,
        key_configured: false,
        credential_storage: if enabled { "system" } else { "disabled" },
        state: if enabled {
            "unconfigured"
        } else {
            "credentialStorageDisabled"
        },
        sync_available: enabled,
    };
    if !enabled {
        return Ok(result);
    }
    let Some(config) = config else {
        return Ok(result);
    };
    let credential_status: Result<()> = (|| {
        if let Some(reference) = config.password_ref.as_ref() {
            result.password_configured = secrets
                .get(&account(root, test_name, workspace, reference, "password"))?
                .is_some_and(|value| !value.is_empty() && value.len() <= 4096);
        }
        if let Some(reference) = config.key_ref.as_ref() {
            result.key_configured = secrets
                .get(&account(root, test_name, workspace, reference, "key"))?
                .is_some_and(|value| SyncKey::from_recovery(&value).is_ok());
        }
        Ok(())
    })();
    result.state = match credential_status {
        Err(_) => "credentialsUnavailable",
        Ok(()) if result.password_configured && result.key_configured => "configured",
        Ok(()) => "credentialsMissing",
    };
    Ok(result)
}

fn save(
    root: &Path,
    test_name: Option<&str>,
    workspace: &str,
    enabled: bool,
    secrets: &impl Secrets,
    request: Save,
) -> Result<Status> {
    if !enabled {
        return Err("notes_sync_credentials_disabled");
    }
    workspace_key(workspace)?;
    validate_connection(&request.connection)?;
    let password = request
        .password
        .map(zeroize::Zeroizing::new)
        .filter(|value| !value.is_empty());
    let recovery = request
        .recovery_code
        .map(zeroize::Zeroizing::new)
        .filter(|value| !value.is_empty());
    if password.as_ref().is_some_and(|value| value.len() > 4096) {
        return Err("notes_sync_invalid_password");
    }
    if let Some(recovery) = recovery.as_ref() {
        if recovery.len() != 48 {
            return Err("notes_sync_invalid_key");
        }
        SyncKey::from_recovery(recovery).map_err(|_| "notes_sync_invalid_key")?;
    }
    let store = Storage::open(root, &configuration_key(workspace, test_name)?, true)?
        .ok_or("notes_sync_settings_unavailable")?;
    let _lock = store.lock()?;
    let before = read(&store, workspace)?;
    if request.expected_revision.as_deref() != before.as_ref().map(|value| value.revision.as_str())
    {
        return Err("notes_sync_settings_changed");
    }
    let same = before
        .as_ref()
        .filter(|value| value.connection == request.connection);
    let revision = Uuid::new_v4().to_string();
    let mut next = Config {
        schema: 1,
        workspace: workspace.to_owned(),
        revision: revision.clone(),
        connection: request.connection,
        password_ref: same.and_then(|value| value.password_ref.clone()),
        key_ref: same.and_then(|value| value.key_ref.clone()),
    };
    let mut staged = Vec::new();
    let result = (|| {
        for (kind, value) in [("password", password.as_ref()), ("key", recovery.as_ref())] {
            if let Some(value) = value {
                let target = account(root, test_name, workspace, &revision, kind);
                staged.push(target.clone());
                secrets.set(&target, value)?;
                if kind == "password" {
                    next.password_ref = Some(revision.clone());
                } else {
                    next.key_ref = Some(revision.clone());
                }
            }
        }
        store.publish(&next, before.as_ref())
    })();
    if let Err(error) = result {
        // Only newly generated accounts are candidates; old references stay valid.
        for target in staged {
            let _ = secrets.delete(&target);
        }
        return Err(error);
    }
    drop(_lock);
    status(root, test_name, workspace, enabled, secrets)
}

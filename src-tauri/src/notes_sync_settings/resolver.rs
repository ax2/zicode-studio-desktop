//! Resolve only the saved destination and its dedicated secret accounts.
//! Nothing from the WebView selects a path, credential reference or test domain.
use super::{
    account, configuration_key, read,
    secrets::{Secrets, SystemSecrets},
    storage::Storage,
    Result,
};
use crate::notes_sync::{repository::SyncRepository, SyncKey};
use std::{fs::File, path::Path};

fn current_store(root: &Path, test_name: Option<&str>, workspace: &str) -> Result<Storage> {
    Storage::open(root, &configuration_key(workspace, test_name)?, false)?
        .ok_or("notes_sync_settings_changed")
}

/// Hold the same lock as configuration Save across a local apply. No network
/// request runs while holding this lease. Revision is read after acquiring it.
pub(crate) fn lock_current_config(
    root: &Path,
    test_name: Option<&str>,
    workspace: &str,
    expected_revision: &str,
) -> Result<File> {
    let store = current_store(root, test_name, workspace)?;
    let lease = store.lock()?;
    if read(&store, workspace)?
        .as_ref()
        .map(|config| config.revision.as_str())
        != Some(expected_revision)
    {
        return Err("notes_sync_settings_changed");
    }
    Ok(lease)
}

pub(crate) fn resolve_for_sync(
    root: &Path,
    test_name: Option<&str>,
    workspace: &str,
    enabled: bool,
    expected_revision: &str,
) -> Result<SyncRepository> {
    resolve(
        root,
        test_name,
        workspace,
        enabled,
        expected_revision,
        &SystemSecrets,
    )
}

pub(super) fn resolve(
    root: &Path,
    test_name: Option<&str>,
    workspace: &str,
    enabled: bool,
    expected_revision: &str,
    secrets: &impl Secrets,
) -> Result<SyncRepository> {
    if !enabled {
        return Err("notes_sync_credentials_disabled");
    }
    let store = current_store(root, test_name, workspace)?;
    let _lease = store.lock()?;
    let config = read(&store, workspace)?.ok_or("notes_sync_settings_changed")?;
    if config.revision != expected_revision {
        return Err("notes_sync_settings_changed");
    }
    let secret = |reference: Option<&str>, kind: &str| -> Result<zeroize::Zeroizing<String>> {
        let reference = reference.ok_or("notes_sync_credentials_missing")?;
        secrets
            .get(&account(root, test_name, workspace, reference, kind))?
            .ok_or("notes_sync_credentials_missing")
    };
    let password = secret(config.password_ref.as_deref(), "password")?;
    let recovery = secret(config.key_ref.as_deref(), "key")?;
    let key = SyncKey::from_recovery(&recovery).map_err(|_| "notes_sync_invalid_key")?;
    SyncRepository::configured(
        &config.connection.endpoint,
        config.connection.username,
        password.to_string(),
        &config.connection.vault_id,
        key,
    )
    .map_err(|_| "notes_sync_settings_invalid")
}

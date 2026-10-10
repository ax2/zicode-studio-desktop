//! Workspace data snapshots.
//!
//! Every workspace keeps its app data under `<workspace>/.zicode/<app>`.
//! This module copies those directories into
//! `~/.zicode/backups/<workspaceId>/<timestamp>/` so accidental deletion or
//! corruption has a recovery path. Snapshots run on demand (settings) and
//! automatically on startup (at most once per day per workspace); retention
//! keeps the newest backups per workspace.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_BACKUPS_PER_WORKSPACE: usize = 7;
const BACKUP_INTERVAL_SECS: u64 = 24 * 60 * 60;
const CURRENT_BACKUP_FORMAT: u8 = 2;
const BACKUP_APPS: &[&str] = &[
    "sessions",
    "notes",
    "artifacts",
    "tasks",
    "automation",
    "finance",
    "idphoto",
    "imagetools",
    "clipboard",
    "habits",
    "watch",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackup {
    #[serde(default = "legacy_backup_format")]
    pub format_version: u8,
    pub id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub apps: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_sha256: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub damaged: bool,
}

fn legacy_backup_format() -> u8 {
    1
}

fn is_false(value: &bool) -> bool {
    !value
}

fn has_valid_backup_structure(backup: &WorkspaceBackup) -> bool {
    if chrono::DateTime::parse_from_rfc3339(&backup.created_at).is_err()
        || backup.apps.is_empty()
        || backup.apps.len() > BACKUP_APPS.len()
    {
        return false;
    }
    backup.apps.iter().enumerate().all(|(index, app)| {
        BACKUP_APPS.contains(&app.as_str()) && !backup.apps[..index].contains(app)
    })
}

fn backup_entries_match(directory: &Path, backup: &WorkspaceBackup) -> bool {
    BACKUP_APPS.iter().all(|app| {
        let declared = backup.apps.iter().any(|entry| entry.as_str() == *app);
        match fs::symlink_metadata(directory.join(*app)) {
            Ok(metadata) => declared && is_plain_directory_metadata(&metadata),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => !declared,
            Err(_) => false,
        }
    })
}

fn has_restorable_metadata(backup: &WorkspaceBackup) -> bool {
    !backup.damaged
        && has_valid_backup_structure(backup)
        && matches!(backup.format_version, 1 | CURRENT_BACKUP_FORMAT)
        && (backup.format_version != CURRENT_BACKUP_FORMAT || backup.content_sha256.is_some())
        && backup.content_sha256.as_ref().is_none_or(|checksum| {
            checksum.len() == 64 && checksum.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub backup_id: String,
    pub pre_restore_backup_id: String,
    pub apps: Vec<String>,
    pub size_bytes: u64,
}

struct RestoreSwap<'a> {
    app: &'a str,
    had_previous: bool,
    installed: bool,
}

/// System-level backups live under `~/.zicode/backups`, separate from any
/// workspace so they survive workspace data loss.
pub fn backups_root() -> Result<PathBuf, String> {
    Ok(crate::app_paths::system_root()?.join("backups"))
}

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
    if workspace_id.is_empty()
        || workspace_id.len() > 128
        || !workspace_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("invalid workspace id".to_string());
    }
    Ok(())
}

fn validate_backup_id(backup_id: &str) -> Result<(), String> {
    if backup_id.is_empty()
        || backup_id.len() > 128
        || !backup_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("invalid backup id".to_string());
    }
    Ok(())
}

fn workspace_backups_dir(workspace_id: &str) -> Result<PathBuf, String> {
    validate_workspace_id(workspace_id)?;
    let directory = backups_root()?.join(workspace_id);
    match fs::symlink_metadata(&directory) {
        Ok(metadata) if !is_plain_directory_metadata(&metadata) => {
            Err("Workspace backup directory is not a regular directory".to_string())
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(format!(
            "Cannot inspect workspace backup directory: {error}"
        )),
        _ => Ok(directory),
    }
}

fn is_plain_directory(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| is_plain_directory_metadata(&metadata))
}

fn is_plain_directory_metadata(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_dir() && !is_reparse_point(metadata)
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn backup_id() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("{now}-{}", uuid::Uuid::new_v4().simple())
}

/// Copy a directory tree, returning the total bytes written.
fn copy_tree(source: &Path, target: &Path) -> Result<u64, String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("Cannot create {}: {error}", target.display()))?;
    let mut total = 0u64;
    for entry in fs::read_dir(source)
        .map_err(|error| format!("Cannot read {}: {error}", source.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read {}: {error}", source.display()))?;
        let from = entry.path();
        let metadata = fs::symlink_metadata(&from)
            .map_err(|error| format!("Cannot inspect {}: {error}", from.display()))?;
        let to = target.join(entry.file_name());
        if is_plain_directory_metadata(&metadata) {
            total += copy_tree(&from, &to)?;
        } else if metadata.file_type().is_file() && !is_reparse_point(&metadata) {
            total += fs::copy(&from, &to)
                .map_err(|error| format!("Cannot copy {}: {error}", from.display()))?;
        } else {
            return Err(format!(
                "Cannot back up unsupported entry: {}",
                from.display()
            ));
        }
    }
    Ok(total)
}

fn backup_entry_name(name: &std::ffi::OsStr) -> Vec<u8> {
    if let Some(text) = name.to_str() {
        let mut bytes = vec![0];
        bytes.extend_from_slice(text.as_bytes());
        return bytes;
    }
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        let mut bytes = vec![1];
        bytes.extend_from_slice(name.as_bytes());
        bytes
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        let mut bytes = vec![2];
        for code in name.encode_wide() {
            bytes.extend_from_slice(&code.to_le_bytes());
        }
        bytes
    }
}

fn hash_entry_name(hash: &mut Sha256, name: &[u8]) {
    hash.update((name.len() as u64).to_le_bytes());
    hash.update(name);
}

fn hash_tree(path: &Path, name: &[u8], hash: &mut Sha256) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
    if is_plain_directory_metadata(&metadata) {
        hash.update(b"D");
        hash_entry_name(hash, name);
        let mut entries = fs::read_dir(path)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?
            .map(|entry| {
                let entry =
                    entry.map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
                Ok::<_, String>((backup_entry_name(&entry.file_name()), entry))
            })
            .collect::<Result<Vec<_>, _>>()?;
        entries.sort_by(|left, right| left.0.cmp(&right.0));
        for (child_name, entry) in entries {
            hash_tree(&entry.path(), &child_name, hash)?;
        }
        hash.update(b"E");
    } else if metadata.file_type().is_file() && !is_reparse_point(&metadata) {
        hash.update(b"F");
        hash_entry_name(hash, name);
        hash.update(metadata.len().to_le_bytes());
        let mut file = fs::File::open(path)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        let mut buffer = [0u8; 64 * 1024];
        let mut read_bytes = 0u64;
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
            if count == 0 {
                break;
            }
            read_bytes += count as u64;
            hash.update(&buffer[..count]);
        }
        if read_bytes != metadata.len() {
            return Err(format!("File changed while hashing: {}", path.display()));
        }
    } else {
        return Err(format!("Cannot hash unsupported entry: {}", path.display()));
    }
    Ok(())
}

fn checksum_apps(root: &Path, apps: &[String]) -> Result<String, String> {
    let mut hash = Sha256::new();
    hash.update(b"zicode-workspace-backup-v1\0");
    let mut names = apps.to_vec();
    names.sort();
    for name in names {
        hash_tree(
            &root.join(&name),
            &backup_entry_name(name.as_ref()),
            &mut hash,
        )?;
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn rollback_restore(
    data_root: &Path,
    staging: &Path,
    swaps: &[RestoreSwap<'_>],
) -> Result<(), String> {
    for swap in swaps.iter().rev() {
        let target = data_root.join(swap.app);
        if swap.installed {
            fs::rename(&target, staging.join("next").join(swap.app))
                .map_err(|error| format!("Cannot move restored {} aside: {error}", swap.app))?;
        }
        if swap.had_previous {
            fs::rename(staging.join("previous").join(swap.app), &target)
                .map_err(|error| format!("Cannot reinstate previous {}: {error}", swap.app))?;
        }
    }
    Ok(())
}

fn atomic_json_write(path: &Path, value: &WorkspaceBackup) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Cannot serialize backup metadata: {error}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| "Backup metadata has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temporary, &bytes)
        .map_err(|error| format!("Cannot write backup metadata: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Cannot finalize backup metadata: {error}"))
}

fn prune_old_backups(workspace_id: &str, protected_ids: &[&str]) -> Result<(), String> {
    let directory = workspace_backups_dir(workspace_id)?;
    if !directory.is_dir() {
        return Ok(());
    }
    let backups: Vec<_> = list_workspace_backups(workspace_id)?
        .into_iter()
        .filter(|backup| {
            has_restorable_metadata(backup)
                && backup.workspace_id == workspace_id
                && validate_backup_id(&backup.id).is_ok()
        })
        .collect();
    let mut remove = backups.len().saturating_sub(MAX_BACKUPS_PER_WORKSPACE);
    for backup in backups.into_iter().rev() {
        if remove == 0 {
            break;
        }
        if protected_ids.contains(&backup.id.as_str()) {
            continue;
        }
        if fs::remove_dir_all(directory.join(&backup.id)).is_ok() {
            remove -= 1;
        }
    }
    Ok(())
}

/// Create a fresh snapshot of the workspace's `.zicode` app data and prune
/// the oldest backups past the retention limit.
pub fn create_workspace_backup(
    workspace_id: &str,
    workspace_root: &Path,
) -> Result<WorkspaceBackup, String> {
    create_workspace_backup_inner(workspace_id, workspace_root, true)
}

fn create_workspace_backup_inner(
    workspace_id: &str,
    workspace_root: &Path,
    prune: bool,
) -> Result<WorkspaceBackup, String> {
    validate_workspace_id(workspace_id)?;
    let data_root = workspace_root.join(".zicode");
    if !is_plain_directory(&data_root) {
        return Err(format!(
            "Workspace data directory does not exist: {}",
            data_root.display()
        ));
    }
    let directory = workspace_backups_dir(workspace_id)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Cannot create {}: {error}", directory.display()))?;
    let id = backup_id();
    let target = directory.join(&id);
    let staging = directory.join(format!(".partial-{id}"));
    fs::create_dir(&staging)
        .map_err(|error| format!("Cannot create {}: {error}", staging.display()))?;
    let result = (|| {
        let mut apps = Vec::new();
        let mut size_bytes = 0u64;
        for app in BACKUP_APPS {
            let source = data_root.join(app);
            let metadata = match fs::symlink_metadata(&source) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(format!("Cannot inspect {}: {error}", source.display())),
            };
            if !is_plain_directory_metadata(&metadata) {
                return Err(format!(
                    "Cannot back up unsupported entry: {}",
                    source.display()
                ));
            }
            size_bytes += copy_tree(&source, &staging.join(app))?;
            apps.push((*app).to_string());
        }
        if apps.is_empty() {
            return Err("This workspace has no app data to back up yet".to_string());
        }
        let content_sha256 = checksum_apps(&staging, &apps)?;
        let info = WorkspaceBackup {
            format_version: CURRENT_BACKUP_FORMAT,
            id,
            workspace_id: workspace_id.to_string(),
            workspace_root: workspace_root.to_string_lossy().into_owned(),
            created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            size_bytes,
            apps,
            content_sha256: Some(content_sha256),
            damaged: false,
        };
        atomic_json_write(&staging.join("backup.json"), &info)?;
        fs::rename(&staging, &target)
            .map_err(|error| format!("Cannot finalize backup: {error}"))?;
        Ok(info)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    let info = result?;
    if prune {
        if let Err(error) = prune_old_backups(workspace_id, &[]) {
            log::warn!("Cannot prune workspace backups after creation: {error}");
        }
    }
    Ok(info)
}

/// List backups for a workspace, newest first.
pub fn list_workspace_backups(workspace_id: &str) -> Result<Vec<WorkspaceBackup>, String> {
    let directory = workspace_backups_dir(workspace_id)?;
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in
        fs::read_dir(&directory).map_err(|error| format!("Cannot read backups: {error}"))?
    {
        let entry = entry.map_err(|error| format!("Cannot read backups: {error}"))?;
        if !is_plain_directory(&entry.path()) {
            continue;
        }
        let file_name = entry.file_name();
        if let Some(id) = file_name
            .to_str()
            .filter(|id| validate_backup_id(id).is_ok())
        {
            let backup = fs::read(entry.path().join("backup.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<WorkspaceBackup>(&bytes).ok())
                .filter(|backup| {
                    backup.workspace_id == workspace_id
                        && backup.id == id
                        && has_valid_backup_structure(backup)
                        && backup_entries_match(&entry.path(), backup)
                })
                .map(|mut backup| {
                    backup.damaged = false;
                    backup
                })
                .unwrap_or_else(|| WorkspaceBackup {
                    format_version: 0,
                    id: id.to_owned(),
                    workspace_id: workspace_id.to_owned(),
                    workspace_root: String::new(),
                    created_at: entry
                        .metadata()
                        .and_then(|metadata| metadata.modified())
                        .map(chrono::DateTime::<chrono::Utc>::from)
                        .map(|time| time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
                        .unwrap_or_else(|_| "1970-01-01T00:00:00.000Z".to_owned()),
                    size_bytes: 0,
                    apps: Vec::new(),
                    content_sha256: None,
                    damaged: true,
                });
            backups.push(backup);
        }
    }
    backups.sort_by(|left, right| {
        let left_time = chrono::DateTime::parse_from_rfc3339(&left.created_at)
            .map(|date| date.timestamp_millis())
            .unwrap_or(i64::MIN);
        let right_time = chrono::DateTime::parse_from_rfc3339(&right.created_at)
            .map(|date| date.timestamp_millis())
            .unwrap_or(i64::MIN);
        right_time
            .cmp(&left_time)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(backups)
}

/// Permanently remove one backup snapshot.
pub fn delete_workspace_backup(workspace_id: &str, backup_id: &str) -> Result<(), String> {
    validate_workspace_id(workspace_id)?;
    validate_backup_id(backup_id)?;
    let directory = workspace_backups_dir(workspace_id)?.join(backup_id);
    if !is_plain_directory(&directory) {
        return Err("Backup does not exist".to_string());
    }
    fs::remove_dir_all(&directory).map_err(|error| format!("Cannot delete backup: {error}"))
}

/// Replace the workspace's app data with a snapshot's contents. The current
/// state is snapshotted first so the operation is reversible.
pub fn restore_workspace_backup(
    workspace_id: &str,
    workspace_root: &Path,
    backup_id: &str,
) -> Result<RestoreReport, String> {
    validate_workspace_id(workspace_id)?;
    validate_backup_id(backup_id)?;
    let backup_dir = workspace_backups_dir(workspace_id)?.join(backup_id);
    if !is_plain_directory(&backup_dir) {
        return Err("Backup does not exist".to_string());
    }
    let metadata_bytes = fs::read(backup_dir.join("backup.json"))
        .map_err(|_| "Backup metadata is missing".to_string())?;
    let metadata: WorkspaceBackup = serde_json::from_slice(&metadata_bytes)
        .map_err(|_| "Backup metadata is invalid".to_string())?;
    if metadata.workspace_id != workspace_id {
        return Err("Backup does not belong to this workspace".to_string());
    }
    if metadata.id != backup_id {
        return Err("Backup metadata does not match its directory".to_string());
    }
    if !has_valid_backup_structure(&metadata) {
        return Err("Backup metadata is invalid".to_string());
    }
    if !matches!(metadata.format_version, 1 | CURRENT_BACKUP_FORMAT) {
        return Err("Backup format is unsupported".to_string());
    }
    if metadata.format_version == CURRENT_BACKUP_FORMAT && metadata.content_sha256.is_none() {
        return Err("Backup content checksum is missing".to_string());
    }
    if metadata.content_sha256.as_ref().is_some_and(|checksum| {
        checksum.len() != 64 || !checksum.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Err("Backup content checksum is invalid".to_string());
    }
    let mut restorable = Vec::new();
    for app in BACKUP_APPS {
        let source = backup_dir.join(app);
        match fs::symlink_metadata(&source) {
            Ok(metadata) if is_plain_directory_metadata(&metadata) => restorable.push(*app),
            Ok(_) => {
                return Err(format!(
                    "Backup contains unsupported entry: {}",
                    source.display()
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Cannot inspect {}: {error}", source.display())),
        }
    }
    if restorable.is_empty() {
        return Err("Backup contains no restorable app data".to_string());
    }
    if metadata.apps.len() != restorable.len()
        || restorable
            .iter()
            .any(|app| !metadata.apps.iter().any(|declared| declared == app))
    {
        return Err("Backup app directories do not match metadata".to_string());
    }
    let data_root = workspace_root.join(".zicode");
    if !is_plain_directory(&data_root) {
        return Err(format!(
            "Workspace data directory does not exist: {}",
            data_root.display()
        ));
    }
    let staging = data_root.join(format!(".restore-{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir(&staging)
        .map_err(|error| format!("Cannot prepare workspace restore: {error}"))?;
    let staged: Result<u64, String> = (|| {
        let mut size_bytes = 0u64;
        for app in &restorable {
            size_bytes += copy_tree(&backup_dir.join(app), &staging.join("next").join(app))?;
        }
        Ok(size_bytes)
    })();
    if staged.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    let size_bytes = staged?;
    if size_bytes != metadata.size_bytes {
        let _ = fs::remove_dir_all(&staging);
        return Err("Backup data size does not match metadata".to_string());
    }
    if let Some(expected) = &metadata.content_sha256 {
        let actual = checksum_apps(&staging.join("next"), &metadata.apps).inspect_err(|_| {
            let _ = fs::remove_dir_all(&staging);
        })?;
        if &actual != expected {
            let _ = fs::remove_dir_all(&staging);
            return Err("Backup content checksum does not match metadata".to_string());
        }
    }
    // Keep the selected snapshot until restoration completes. A rollback
    // snapshot at the retention limit must not prune the selected source.
    let pre_restore = match create_workspace_backup_inner(workspace_id, workspace_root, false) {
        Ok(backup) => backup,
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if let Err(error) = fs::create_dir(staging.join("previous")) {
        let _ = fs::remove_dir_all(&staging);
        return Err(format!("Cannot prepare previous workspace data: {error}"));
    }
    let mut apps = Vec::new();
    let mut swaps = Vec::new();
    let mut swap_error = None;
    for app in restorable {
        let target = data_root.join(app);
        let had_previous = match fs::symlink_metadata(&target) {
            Ok(metadata) if is_plain_directory_metadata(&metadata) => true,
            Ok(_) => {
                swap_error = Some(format!(
                    "Cannot replace unsupported entry: {}",
                    target.display()
                ));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(error) => {
                swap_error = Some(format!("Cannot inspect {}: {error}", target.display()));
                break;
            }
        };
        if had_previous {
            if let Err(error) = fs::rename(&target, staging.join("previous").join(app)) {
                swap_error = Some(format!("Cannot replace {}: {error}", target.display()));
                break;
            }
        }
        swaps.push(RestoreSwap {
            app,
            had_previous,
            installed: false,
        });
        if let Err(error) = fs::rename(staging.join("next").join(app), &target) {
            swap_error = Some(format!("Cannot replace {}: {error}", target.display()));
            break;
        }
        if let Some(last) = swaps.last_mut() {
            last.installed = true;
        }
        apps.push(app.to_string());
    }
    if let Some(error) = swap_error {
        match rollback_restore(&data_root, &staging, &swaps) {
            Ok(()) => {
                let _ = fs::remove_dir_all(&staging);
                return Err(format!("Restore rolled back after failure: {error}"));
            }
            Err(rollback_error) => {
                return Err(format!(
                    "Rollback incomplete after restore failure: {rollback_error}; previous data remains in {}",
                    staging.display()
                ));
            }
        }
    }
    if let Err(error) = fs::remove_dir_all(&staging) {
        log::warn!("Cannot remove completed workspace restore staging: {error}");
    }
    if let Err(error) = prune_old_backups(workspace_id, &[backup_id, &pre_restore.id]) {
        log::warn!("Cannot prune workspace backups after restore: {error}");
    }
    Ok(RestoreReport {
        backup_id: backup_id.to_string(),
        pre_restore_backup_id: pre_restore.id,
        apps,
        size_bytes,
    })
}

/// Create a backup on startup when the workspace has none, or its newest
/// snapshot is older than one day. Returns the created backup, if any.
pub fn backup_if_due(
    workspace_id: &str,
    workspace_root: &Path,
    now_secs: u64,
) -> Result<Option<WorkspaceBackup>, String> {
    if let Some(latest) = list_workspace_backups(workspace_id)?
        .into_iter()
        .find(has_restorable_metadata)
    {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&latest.created_at) {
            if (now_secs as i64) < parsed.timestamp() + BACKUP_INTERVAL_SECS as i64 {
                return Ok(None);
            }
        }
    }
    create_workspace_backup(workspace_id, workspace_root).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "zicode-backup-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn unique_workspace_id(prefix: &str) -> String {
        format!(
            "{prefix}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        )
    }

    fn cleanup(workspace_id: &str) {
        if let Ok(root) = backups_root() {
            let _ = fs::remove_dir_all(root.join(workspace_id));
        }
    }

    #[test]
    fn snapshots_workspace_app_data_and_lists_newest_first() {
        let root = test_root();
        let workspace = root.join("ws-a");
        let workspace_id = unique_workspace_id("ws-a");
        let data = workspace.join(".zicode");
        fs::create_dir_all(data.join("notes").join("vaults")).unwrap();
        fs::write(data.join("notes").join("vaults").join("note.md"), "# Hello").unwrap();
        fs::create_dir_all(data.join("sessions")).unwrap();
        fs::write(data.join("sessions").join("session.jsonl"), "[]").unwrap();

        let first = create_workspace_backup(&workspace_id, &workspace).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let second = create_workspace_backup(&workspace_id, &workspace).unwrap();

        let backups = list_workspace_backups(&workspace_id).unwrap();
        assert_eq!(backups.len(), 2);
        assert_eq!(backups[0].id, second.id);
        assert_eq!(backups[1].id, first.id);
        assert!(second.size_bytes > 0);
        assert!(second.apps.contains(&"notes".to_string()));
        assert!(second.apps.contains(&"sessions".to_string()));
        let snapshot_notes = backups_root()
            .unwrap()
            .join(&workspace_id)
            .join(&second.id)
            .join("notes")
            .join("vaults")
            .join("note.md");
        assert!(snapshot_notes.is_file());

        delete_workspace_backup(&workspace_id, &first.id).unwrap();
        assert_eq!(list_workspace_backups(&workspace_id).unwrap().len(), 1);
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn startup_backup_respects_the_daily_interval() {
        let root = test_root();
        let workspace = root.join("ws-b");
        let workspace_id = unique_workspace_id("ws-b");
        fs::create_dir_all(workspace.join(".zicode").join("notes")).unwrap();
        fs::write(workspace.join(".zicode").join("notes").join("a.md"), "x").unwrap();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // Fresh workspace: a backup is due.
        let created = backup_if_due(&workspace_id, &workspace, now).unwrap();
        assert!(created.is_some());
        // Same day: no second backup.
        let again = backup_if_due(&workspace_id, &workspace, now + 3600).unwrap();
        assert!(again.is_none());
        // One day later: due again.
        let due = backup_if_due(&workspace_id, &workspace, now + 86_400 + 60).unwrap();
        assert!(due.is_some());
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn retains_only_the_newest_backups() {
        let root = test_root();
        let workspace = root.join("ws-c");
        let workspace_id = unique_workspace_id("ws-c");
        fs::create_dir_all(workspace.join(".zicode").join("notes")).unwrap();
        fs::write(workspace.join(".zicode").join("notes").join("a.md"), "x").unwrap();
        for _ in 0..(MAX_BACKUPS_PER_WORKSPACE + 3) {
            std::thread::sleep(std::time::Duration::from_millis(5));
            create_workspace_backup(&workspace_id, &workspace).unwrap();
        }
        assert_eq!(
            list_workspace_backups(&workspace_id).unwrap().len(),
            MAX_BACKUPS_PER_WORKSPACE
        );
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn restores_a_snapshot_over_the_workspace_and_snapshots_current_state_first() {
        let root = test_root();
        let workspace = root.join("ws-e");
        let workspace_id = unique_workspace_id("ws-e");
        let data = workspace.join(".zicode").join("notes");
        fs::create_dir_all(&data).unwrap();
        fs::write(data.join("before.md"), "before").unwrap();

        let backup = create_workspace_backup(&workspace_id, &workspace).unwrap();
        // Change the live data after the snapshot.
        fs::remove_file(data.join("before.md")).unwrap();
        fs::write(data.join("after.md"), "after").unwrap();

        let report = restore_workspace_backup(&workspace_id, &workspace, &backup.id).unwrap();
        assert_eq!(report.backup_id, backup.id);
        assert!(!report.pre_restore_backup_id.is_empty());
        assert!(report.apps.contains(&"notes".to_string()));
        assert!(data.join("before.md").is_file());
        assert!(!data.join("after.md").exists());

        // The current (pre-restore) state was snapshotted for reversibility.
        let backups = list_workspace_backups(&workspace_id).unwrap();
        assert!(backups
            .iter()
            .any(|entry| entry.id == report.pre_restore_backup_id));
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rejects_path_traversal_backup_ids() {
        let root = test_root();
        let workspace = root.join("ws-d");
        let workspace_id = unique_workspace_id("ws-d");
        fs::create_dir_all(workspace.join(".zicode").join("notes")).unwrap();
        fs::write(workspace.join(".zicode").join("notes").join("a.md"), "x").unwrap();
        assert!(create_workspace_backup("../escape", &workspace).is_err());
        assert!(delete_workspace_backup(&workspace_id, "../escape").is_err());
        assert!(delete_workspace_backup(&workspace_id, ".hidden").is_err());
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }
}

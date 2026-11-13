//! Workspace data snapshots.
//!
//! Every workspace keeps its app data under `<workspace>/.zicode/<app>`.
//! This module copies those directories into
//! `~/.zicode/backups/<workspaceId>/<timestamp>/` so accidental deletion or
//! corruption has a recovery path. Snapshots run on demand (settings) and
//! automatically on startup (at most once per day per workspace); retention
//! keeps the newest backups per workspace.

mod restore_request;
mod restore_transaction;
pub(crate) use restore_request::{RestoreOutcome, RestoreRequest};

#[cfg(test)]
mod test_support;

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

/// System-level backups live under `~/.zicode/backups`, separate from any
/// workspace so they survive workspace data loss.
pub fn backups_root() -> Result<PathBuf, String> {
    Ok(crate::app_paths::system_root()?.join("backups"))
}

fn lock_system_restore(root: &Path) -> Result<fs::File, String> {
    // A freshly prepared profile may not have a system directory yet.
    // Create only that child so a missing profile root still fails.
    match fs::create_dir(root) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!(
                "Cannot initialize workspace restore directory: {error}"
            ));
        }
    }
    if !is_plain_directory(root) {
        return Err("Workspace restore directory is not a regular directory".into());
    }
    restore_transaction::lock(root)
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
    let queued = restore_request::read(&crate::app_paths::system_root()?)?;
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
        if protected_ids.contains(&backup.id.as_str())
            || queued.as_ref().is_some_and(|request| {
                request.workspace_id == workspace_id && request.backup_id == backup.id
            })
        {
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
    let _lock = lock_system_restore(&crate::app_paths::system_root()?)?;
    create_workspace_backup_inner(workspace_id, workspace_root, true, None)?
        .ok_or_else(|| "Manual backup was unexpectedly skipped".to_string())
}

fn create_workspace_backup_inner(
    workspace_id: &str,
    workspace_root: &Path,
    prune: bool,
    skip_if_identical_to: Option<&WorkspaceBackup>,
) -> Result<Option<WorkspaceBackup>, String> {
    validate_workspace_id(workspace_id)?;
    let data_root =
        crate::app_paths::workspace_app_dir(workspace_root, &crate::app_paths::system_root()?);
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
        if skip_if_identical_to.is_some_and(|previous| {
            previous.apps == apps
                && previous.content_sha256.as_deref() == Some(content_sha256.as_str())
                && is_plain_directory(&directory.join(&previous.id))
                && backup_entries_match(&directory.join(&previous.id), previous)
                && checksum_apps(&directory.join(&previous.id), &apps)
                    .is_ok_and(|checksum| checksum == content_sha256)
        }) {
            return Ok(None);
        }
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
        Ok(Some(info))
    })();
    let info = match result {
        Ok(Some(info)) => info,
        Ok(None) => {
            fs::remove_dir_all(&staging)
                .map_err(|error| format!("Cannot remove unchanged backup staging: {error}"))?;
            return Ok(None);
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    if prune {
        if let Err(error) = prune_old_backups(workspace_id, &[]) {
            log::warn!("Cannot prune workspace backups after creation: {error}");
        }
    }
    Ok(Some(info))
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
    let system_root = crate::app_paths::system_root()?;
    let _request_lock = lock_system_restore(&system_root)?;
    if restore_request::read(&system_root)?.is_some_and(|request| {
        request.workspace_id == workspace_id && request.backup_id == backup_id
    }) {
        return Err("Cannot delete the backup queued for restore".into());
    }
    let directory = workspace_backups_dir(workspace_id)?.join(backup_id);
    if !is_plain_directory(&directory) {
        return Err("Backup does not exist".to_string());
    }
    fs::remove_dir_all(&directory).map_err(|error| format!("Cannot delete backup: {error}"))
}

/// Reconcile an interrupted swap before the desktop opens workspace stores.
pub(crate) fn enqueue_workspace_restore(
    workspace_id: &str,
    backup_id: &str,
) -> Result<RestoreRequest, String> {
    validate_backup_id(backup_id)?;
    let root = crate::app_paths::system_root()?;
    let _lock = lock_system_restore(&root)?;
    if !list_workspace_backups(workspace_id)?
        .iter()
        .any(|backup| backup.id == backup_id && has_restorable_metadata(backup))
    {
        return Err("Backup does not exist or is damaged".into());
    }
    restore_request::enqueue(&root, workspace_id, backup_id)
}

pub(crate) fn workspace_restore_outcome(
    workspace_id: &str,
) -> Result<Option<RestoreOutcome>, String> {
    Ok(restore_request::outcome(&crate::app_paths::system_root()?)?
        .filter(|outcome| outcome.workspace_id == workspace_id))
}

fn restore_roots(system_root: &Path, workspaces: &[(String, String)]) -> Vec<PathBuf> {
    let mut candidates = vec![system_root.join(".zicode")];
    candidates.extend(
        workspaces
            .iter()
            .map(|(_, path)| Path::new(path).join(".zicode")),
    );
    candidates
}

pub(crate) fn startup_restore_needed(workspaces: &[(String, String)]) -> Result<bool, String> {
    let system_root = crate::app_paths::system_root()?;
    if restore_request::read(&system_root)?.is_some() {
        return Ok(true);
    }
    for root in restore_roots(&system_root, workspaces) {
        if is_plain_directory(&root) && restore_transaction::needs_recovery(&root)? {
            return Ok(true);
        }
    }
    Ok(false)
}

fn reconcile_restore_roots(
    system_root: &Path,
    workspaces: &[(String, String)],
    request_id: Option<&str>,
) -> Result<(), String> {
    let mut roots = std::collections::HashSet::new();
    for root in restore_roots(system_root, workspaces) {
        if is_plain_directory(&root)
            && restore_transaction::needs_recovery(&root)?
            && roots.insert(root.canonicalize().map_err(|error| error.to_string())?)
        {
            let _lock = restore_transaction::lock(&root)?;
            restore_transaction::recover_preserving(&root, request_id)?;
        }
    }
    Ok(())
}

/// Run before opening any workspace stores, with the Worker maintenance lease held.
pub(crate) fn apply_startup_restore(workspaces: &[(String, String)]) -> Result<(), String> {
    let system_root = crate::app_paths::system_root()?;
    let _request_lock = lock_system_restore(&system_root)?;
    let request = restore_request::read(&system_root)?;
    reconcile_restore_roots(
        &system_root,
        workspaces,
        request.as_ref().map(|request| request.request_id.as_str()),
    )?;
    let Some(request) = request else {
        return Ok(());
    };
    let workspace = workspaces
        .iter()
        .find(|(id, _)| id == &request.workspace_id)
        .ok_or("Queued restore workspace is no longer registered")?;
    let workspace_root = Path::new(&workspace.1);
    let root = crate::app_paths::workspace_app_dir(workspace_root, &system_root);
    let committed = restore_transaction::committed(&root, &request.request_id);
    let report = if is_plain_directory(&committed) {
        let bytes = fs::read(committed.join("result.json")).map_err(|error| error.to_string())?;
        let report: RestoreReport =
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
        if report.backup_id != request.backup_id {
            return Err("Committed restore result does not match the queued backup".into());
        }
        report
    } else {
        restore_workspace_backup_inner(
            &request.workspace_id,
            workspace_root,
            &request.backup_id,
            Some(&request.request_id),
        )?
    };
    restore_request::complete(&system_root, request, report)?;
    if let Err(error) = fs::remove_dir_all(&committed) {
        log::warn!(
            "Cannot remove completed workspace restore {}: {error}",
            committed.display()
        );
    }
    Ok(())
}

/// With the Worker maintenance lease held, return a request ID that can be
/// offered for cancellation. A failed reconciliation is never cancellable.
pub(crate) fn cancellable_startup_restore(
    workspaces: &[(String, String)],
) -> Result<Option<String>, String> {
    let system = crate::app_paths::system_root()?;
    let _lock = lock_system_restore(&system)?;
    Ok(cancellable_request(&system, workspaces, None)?.map(|request| request.request_id))
}

/// Recheck the exact request under both locks after the user confirms.
pub(crate) fn cancel_startup_restore(
    expected: &str,
    workspaces: &[(String, String)],
) -> Result<(), String> {
    let system = crate::app_paths::system_root()?;
    let _lock = lock_system_restore(&system)?;
    let request = cancellable_request(&system, workspaces, Some(expected))?
        .ok_or("Workspace restore is no longer pending or cannot be safely cancelled")?;
    restore_request::cancel(&system, &request)
}

fn cancellable_request(
    system: &Path,
    workspaces: &[(String, String)],
    expected: Option<&str>,
) -> Result<Option<RestoreRequest>, String> {
    let Some(request) = restore_request::read(system)? else {
        return Ok(None);
    };
    if expected.is_some_and(|id| id != request.request_id) {
        return Ok(None);
    }
    let Some((_, path)) = workspaces
        .iter()
        .find(|(id, _)| id == &request.workspace_id)
    else {
        return Ok(None);
    };
    let target = crate::app_paths::workspace_app_dir(Path::new(path), system);
    if restore_request::outcome(system)?
        .is_some_and(|outcome| outcome.request_id == request.request_id)
    {
        return Ok(None);
    }
    let mut target_exists = false;
    for root in restore_roots(system, workspaces) {
        match fs::symlink_metadata(&root) {
            Ok(metadata) if is_plain_directory_metadata(&metadata) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Ok(_) => {
                return Err(format!(
                    "Invalid workspace restore root: {}",
                    root.display()
                ))
            }
            Err(error) => {
                return Err(format!(
                    "Cannot inspect workspace restore root {}: {error}",
                    root.display()
                ))
            }
        }
        target_exists |= root == target;
        match fs::symlink_metadata(restore_transaction::committed(&root, &request.request_id)) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Ok(_) => return Ok(None),
            Err(error) => return Err(format!("Cannot verify workspace restore commit: {error}")),
        }
    }
    if !target_exists {
        return Ok(None);
    }
    reconcile_restore_roots(system, workspaces, Some(&request.request_id))?;
    Ok(Some(request))
}

/// Replace the workspace's app data with a snapshot's contents. The current
/// state is snapshotted first so the operation is reversible.
#[cfg(test)]
fn restore_workspace_backup(
    workspace_id: &str,
    workspace_root: &Path,
    backup_id: &str,
) -> Result<RestoreReport, String> {
    restore_workspace_backup_inner(workspace_id, workspace_root, backup_id, None)
}

fn restore_workspace_backup_inner(
    workspace_id: &str,
    workspace_root: &Path,
    backup_id: &str,
    request_id: Option<&str>,
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
    let data_root =
        crate::app_paths::workspace_app_dir(workspace_root, &crate::app_paths::system_root()?);
    if !is_plain_directory(&data_root) {
        return Err(format!(
            "Workspace data directory does not exist: {}",
            data_root.display()
        ));
    }
    let _lock = restore_transaction::lock(&data_root)?;
    restore_transaction::recover_preserving(&data_root, request_id)?;
    let transaction_id = request_id
        .map(str::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string());
    let staging = restore_transaction::preparing(&data_root, &transaction_id);
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
    let pre_restore = match create_workspace_backup_inner(workspace_id, workspace_root, false, None)
    {
        Ok(Some(backup)) => backup,
        Ok(None) => {
            let _ = fs::remove_dir_all(&staging);
            return Err("Pre-restore backup was unexpectedly skipped".to_string());
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
    };
    let pending = restore_transaction::publish(&data_root, &staging, &transaction_id, &restorable)
        .inspect_err(|_| {
            let _ = fs::remove_dir_all(&staging);
        })?;
    let report = RestoreReport {
        backup_id: backup_id.to_string(),
        pre_restore_backup_id: pre_restore.id,
        apps: restorable.into_iter().map(str::to_owned).collect(),
        size_bytes,
    };
    let result = (|| {
        if request_id.is_some() {
            let bytes = serde_json::to_vec(&report).map_err(|error| error.to_string())?;
            use std::io::Write;
            let mut file =
                fs::File::create(pending.join("result.json")).map_err(|error| error.to_string())?;
            file.write_all(&bytes)
                .and_then(|()| file.sync_all())
                .map_err(|error| error.to_string())?;
        }
        restore_transaction::install(&data_root, &pending)?;
        if request_id.is_some() {
            restore_transaction::commit(&data_root, &pending, &transaction_id)?;
        } else {
            restore_transaction::finish(&data_root, &pending, &transaction_id)?;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        match restore_transaction::recover_preserving(&data_root, request_id) {
            Ok(()) => return Err(format!("Restore rolled back after failure: {error}")),
            Err(rollback_error) => {
                return Err(format!(
                    "Rollback incomplete after restore failure: {error}; {rollback_error}; previous data remains in {}",
                    pending.display()
                ));
            }
        }
    }
    if let Err(error) = prune_old_backups(workspace_id, &[backup_id, &report.pre_restore_backup_id])
    {
        log::warn!("Cannot prune workspace backups after restore: {error}");
    }
    Ok(report)
}

/// Create a backup on startup when the workspace has none, or its newest
/// snapshot is older than one day. Returns the created backup, if any.
pub fn backup_if_due(
    workspace_id: &str,
    workspace_root: &Path,
    now_secs: u64,
) -> Result<Option<WorkspaceBackup>, String> {
    let _lock = lock_system_restore(&crate::app_paths::system_root()?)?;
    let latest = list_workspace_backups(workspace_id)?
        .into_iter()
        .find(has_restorable_metadata);
    if let Some(latest) = &latest {
        if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&latest.created_at) {
            if (now_secs as i64) < parsed.timestamp() + BACKUP_INTERVAL_SECS as i64 {
                return Ok(None);
            }
        }
    }
    create_workspace_backup_inner(workspace_id, workspace_root, true, latest.as_ref())
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
        if !super::test_support::isolated() {
            return;
        }
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
    fn queued_restore_recovers_a_committed_result_without_reapplying() {
        if !super::test_support::isolated() {
            return;
        }
        let system = crate::app_paths::system_root().unwrap();
        let workspace = system.join("queued-workspace");
        let data = workspace.join(".zicode");
        let note = data.join("notes/probe.txt");
        fs::create_dir_all(note.parent().unwrap()).unwrap();
        fs::write(&note, "snapshot").unwrap();
        let workspace_id = "queued-workspace";
        let backup = create_workspace_backup(workspace_id, &workspace).unwrap();
        fs::write(&note, "current").unwrap();
        let request = enqueue_workspace_restore(workspace_id, &backup.id).unwrap();
        assert!(delete_workspace_backup(workspace_id, &backup.id).is_err());
        assert_eq!(fs::read_to_string(&note).unwrap(), "current");
        let registered = [(
            workspace_id.to_owned(),
            workspace.to_string_lossy().into_owned(),
        )];
        assert!(startup_restore_needed(&registered).unwrap());
        restore_workspace_backup_inner(
            workspace_id,
            &workspace,
            &backup.id,
            Some(&request.request_id),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&note).unwrap(), "snapshot");
        assert_eq!(cancellable_startup_restore(&registered).unwrap(), None);
        assert!(cancel_startup_restore(&request.request_id, &registered).is_err());
        let backups_after_commit = list_workspace_backups(workspace_id).unwrap().len();
        apply_startup_restore(&registered).unwrap();
        assert_eq!(
            list_workspace_backups(workspace_id).unwrap().len(),
            backups_after_commit
        );
        assert_eq!(
            workspace_restore_outcome(workspace_id)
                .unwrap()
                .unwrap()
                .request_id,
            request.request_id
        );
        assert!(!startup_restore_needed(&registered).unwrap());
    }

    #[test]
    fn missing_snapshot_can_be_cancelled_without_changing_workspace_bytes() {
        if !super::test_support::isolated() {
            return;
        }
        let system = crate::app_paths::system_root().unwrap();
        let workspace = system.join("cancel-workspace");
        let note = workspace.join(".zicode/notes/probe.txt");
        fs::create_dir_all(note.parent().unwrap()).unwrap();
        fs::write(&note, "snapshot").unwrap();
        let workspace_id = "cancel-workspace";
        let backup = create_workspace_backup(workspace_id, &workspace).unwrap();
        fs::write(&note, "current").unwrap();
        let request = enqueue_workspace_restore(workspace_id, &backup.id).unwrap();
        let source = workspace_backups_dir(workspace_id)
            .unwrap()
            .join(&backup.id);
        let displaced = source.with_extension("displaced");
        fs::rename(&source, &displaced).unwrap();
        let registered = [(
            workspace_id.to_owned(),
            workspace.to_string_lossy().into_owned(),
        )];
        assert!(apply_startup_restore(&registered).is_err());
        let legacy = system.join("legacy-workspace");
        fs::create_dir(&legacy).unwrap();
        let malformed_root = legacy.join(".zicode");
        fs::write(&malformed_root, "preserve this entry").unwrap();
        let mut with_legacy = registered.to_vec();
        with_legacy.push(("legacy".to_owned(), legacy.to_string_lossy().into_owned()));
        assert!(cancellable_startup_restore(&with_legacy)
            .unwrap_err()
            .contains("Invalid workspace restore root"));
        assert!(cancel_startup_restore(&request.request_id, &with_legacy).is_err());
        assert_eq!(
            restore_request::read(&system).unwrap().unwrap().request_id,
            request.request_id
        );
        assert_eq!(fs::read_to_string(&note).unwrap(), "current");
        assert_eq!(
            fs::read_to_string(&malformed_root).unwrap(),
            "preserve this entry"
        );
        fs::rename(&malformed_root, legacy.join("displaced")).unwrap();
        assert_eq!(
            cancellable_startup_restore(&with_legacy)
                .unwrap()
                .as_deref(),
            Some(request.request_id.as_str())
        );
        assert!(cancel_startup_restore("changed", &registered).is_err());
        assert!(startup_restore_needed(&registered).unwrap());
        cancel_startup_restore(&request.request_id, &registered).unwrap();
        assert!(!startup_restore_needed(&registered).unwrap());
        assert_eq!(fs::read_to_string(&note).unwrap(), "current");
        assert!(displaced.is_dir());
        assert!(system
            .join(format!(
                "workspace-restore-cancelled-{}.json",
                request.request_id
            ))
            .is_file());
    }

    #[test]
    fn startup_backup_respects_the_daily_interval() {
        if !super::test_support::isolated() {
            return;
        }
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
        // An unchanged workspace does not consume another full backup slot.
        let due = backup_if_due(&workspace_id, &workspace, now + 86_400 + 60).unwrap();
        assert!(due.is_none());
        assert_eq!(list_workspace_backups(&workspace_id).unwrap().len(), 1);
        assert_eq!(
            fs::read_dir(backups_root().unwrap().join(&workspace_id))
                .unwrap()
                .count(),
            1
        );
        fs::write(
            workspace.join(".zicode").join("notes").join("a.md"),
            "changed",
        )
        .unwrap();
        let changed = backup_if_due(&workspace_id, &workspace, now + 86_400 + 61).unwrap();
        assert!(changed.is_some());
        assert_eq!(list_workspace_backups(&workspace_id).unwrap().len(), 2);
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn automatic_backup_replaces_a_corrupt_latest_snapshot_even_when_source_is_unchanged() {
        if !super::test_support::isolated() {
            return;
        }
        let root = test_root();
        let workspace = root.join("ws-corrupt");
        let workspace_id = unique_workspace_id("ws-corrupt");
        let notes = workspace.join(".zicode").join("notes");
        fs::create_dir_all(&notes).unwrap();
        fs::write(notes.join("a.md"), "original").unwrap();
        let first = create_workspace_backup(&workspace_id, &workspace).unwrap();
        fs::write(
            backups_root()
                .unwrap()
                .join(&workspace_id)
                .join(&first.id)
                .join("notes")
                .join("a.md"),
            "corrupted",
        )
        .unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let replacement = backup_if_due(&workspace_id, &workspace, now + 86_400 + 60)
            .unwrap()
            .unwrap();
        assert_ne!(replacement.id, first.id);
        assert_eq!(list_workspace_backups(&workspace_id).unwrap().len(), 2);
        cleanup(&workspace_id);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn retains_only_the_newest_backups() {
        if !super::test_support::isolated() {
            return;
        }
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
        if !super::test_support::isolated() {
            return;
        }
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
        if !super::test_support::isolated() {
            return;
        }
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

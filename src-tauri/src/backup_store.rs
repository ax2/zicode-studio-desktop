//! Workspace data snapshots.
//!
//! Every workspace keeps its app data under `<workspace>/.zicode/<app>`.
//! This module copies those directories into
//! `~/.zicode/backups/<workspaceId>/<timestamp>/` so accidental deletion or
//! corruption has a recovery path. Snapshots run on demand (settings) and
//! automatically on startup (at most once per day per workspace); retention
//! keeps the newest backups per workspace.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_BACKUPS_PER_WORKSPACE: usize = 7;
const BACKUP_INTERVAL_SECS: u64 = 24 * 60 * 60;
const BACKUP_APPS: &[&str] = &[
    "sessions",
    "notes",
    "artifacts",
    "tasks",
    "automation",
    "finance",
];

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceBackup {
    pub id: String,
    pub workspace_id: String,
    pub workspace_root: String,
    pub created_at: String,
    pub size_bytes: u64,
    pub apps: Vec<String>,
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

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
    if workspace_id.is_empty()
        || workspace_id.len() > 128
        || workspace_id.contains(['\\', '/', '\0'])
    {
        return Err("invalid workspace id".to_string());
    }
    Ok(())
}

fn validate_backup_id(backup_id: &str) -> Result<(), String> {
    if backup_id.is_empty()
        || backup_id.len() > 128
        || backup_id.contains(['\\', '/', '\0'])
        || backup_id.starts_with('.')
    {
        return Err("invalid backup id".to_string());
    }
    Ok(())
}

fn workspace_backups_dir(workspace_id: &str) -> Result<PathBuf, String> {
    validate_workspace_id(workspace_id)?;
    Ok(backups_root()?.join(workspace_id))
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
        .flatten()
    {
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect {}: {error}", entry.path().display()))?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if file_type.is_dir() {
            total += copy_tree(&from, &to)?;
        } else if file_type.is_file() {
            fs::copy(&from, &to)
                .map_err(|error| format!("Cannot copy {}: {error}", from.display()))?;
            total += fs::metadata(&to)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
        }
    }
    Ok(total)
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

fn prune_old_backups(workspace_id: &str) -> Result<(), String> {
    let directory = workspace_backups_dir(workspace_id)?;
    if !directory.is_dir() {
        return Ok(());
    }
    let mut ids = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Cannot read backups: {error}"))?
        .flatten()
    {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let Some(id) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if validate_backup_id(&id).is_ok() && entry.path().join("backup.json").is_file() {
            ids.push(id);
        }
    }
    ids.sort();
    let keep = ids.len().saturating_sub(MAX_BACKUPS_PER_WORKSPACE);
    for id in ids.into_iter().take(keep) {
        let _ = fs::remove_dir_all(directory.join(&id));
    }
    Ok(())
}

/// Create a fresh snapshot of the workspace's `.zicode` app data and prune
/// the oldest backups past the retention limit.
pub fn create_workspace_backup(
    workspace_id: &str,
    workspace_root: &Path,
) -> Result<WorkspaceBackup, String> {
    validate_workspace_id(workspace_id)?;
    let data_root = workspace_root.join(".zicode");
    if !data_root.is_dir() {
        return Err(format!(
            "Workspace data directory does not exist: {}",
            data_root.display()
        ));
    }
    let target = workspace_backups_dir(workspace_id)?.join(backup_id());
    fs::create_dir_all(&target)
        .map_err(|error| format!("Cannot create {}: {error}", target.display()))?;
    let mut apps = Vec::new();
    let mut size_bytes = 0u64;
    for app in BACKUP_APPS {
        let source = data_root.join(app);
        if !source.is_dir() {
            continue;
        }
        size_bytes += copy_tree(&source, &target.join(app))?;
        apps.push((*app).to_string());
    }
    if apps.is_empty() {
        let _ = fs::remove_dir_all(&target);
        return Err("This workspace has no app data to back up yet".to_string());
    }
    let id = target
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_string)
        .unwrap_or_default();
    let info = WorkspaceBackup {
        id,
        workspace_id: workspace_id.to_string(),
        workspace_root: workspace_root.to_string_lossy().into_owned(),
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        size_bytes,
        apps,
    };
    atomic_json_write(&target.join("backup.json"), &info)?;
    prune_old_backups(workspace_id)?;
    Ok(info)
}

/// List backups for a workspace, newest first.
pub fn list_workspace_backups(workspace_id: &str) -> Result<Vec<WorkspaceBackup>, String> {
    let directory = workspace_backups_dir(workspace_id)?;
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(&directory)
        .map_err(|error| format!("Cannot read backups: {error}"))?
        .flatten()
    {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let metadata_path = entry.path().join("backup.json");
        let Ok(bytes) = fs::read(&metadata_path) else {
            continue;
        };
        if let Ok(mut backup) = serde_json::from_slice::<WorkspaceBackup>(&bytes) {
            if let Some(id) = entry.file_name().to_str().map(str::to_string) {
                backup.id = id;
            }
            backups.push(backup);
        }
    }
    backups.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });
    Ok(backups)
}

/// Permanently remove one backup snapshot.
pub fn delete_workspace_backup(workspace_id: &str, backup_id: &str) -> Result<(), String> {
    validate_workspace_id(workspace_id)?;
    validate_backup_id(backup_id)?;
    let directory = workspace_backups_dir(workspace_id)?.join(backup_id);
    if !directory.is_dir() {
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
    if !backup_dir.is_dir() {
        return Err("Backup does not exist".to_string());
    }
    let metadata_bytes = fs::read(backup_dir.join("backup.json"))
        .map_err(|_| "Backup metadata is missing".to_string())?;
    let metadata: WorkspaceBackup = serde_json::from_slice(&metadata_bytes)
        .map_err(|_| "Backup metadata is invalid".to_string())?;
    if metadata.workspace_id != workspace_id {
        return Err("Backup does not belong to this workspace".to_string());
    }
    // Protect the current state before replacing anything.
    let pre_restore = create_workspace_backup(workspace_id, workspace_root)?;
    let data_root = workspace_root.join(".zicode");
    let mut apps = Vec::new();
    let mut size_bytes = 0u64;
    for app in BACKUP_APPS {
        let source = backup_dir.join(app);
        if !source.is_dir() {
            continue;
        }
        let target = data_root.join(app);
        if target.exists() {
            fs::remove_dir_all(&target)
                .map_err(|error| format!("Cannot replace {}: {error}", target.display()))?;
        }
        size_bytes += copy_tree(&source, &target)?;
        apps.push((*app).to_string());
    }
    if apps.is_empty() {
        return Err("Backup contains no restorable app data".to_string());
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
    if let Some(latest) = list_workspace_backups(workspace_id)?.into_iter().next() {
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

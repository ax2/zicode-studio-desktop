use std::fs;
use std::path::{Path, PathBuf};

const APP_DATA_DIR_NAME: &str = "zicode";

pub fn data_root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|root| root.join(APP_DATA_DIR_NAME))
        .ok_or_else(|| "Cannot resolve the ZiCode Studio Desktop data directory".to_string())
}

pub fn sessions_root() -> Result<PathBuf, String> {
    Ok(data_root()?.join("sessions"))
}

pub fn agent_inbox_workspace() -> Result<PathBuf, String> {
    Ok(data_root()?.join("workspaces").join("agent-inbox"))
}

pub fn metadata_path() -> Result<PathBuf, String> {
    Ok(data_root()?.join("metadata").join("picot.sqlite3"))
}

pub fn logs_root() -> Result<PathBuf, String> {
    Ok(data_root()?.join("logs"))
}

pub fn webview_root() -> Result<PathBuf, String> {
    Ok(data_root()?.join("webview"))
}

/// Copy legacy Tauri metadata into the ZiCode data root on first launch.
///
/// The old file is intentionally preserved as a recovery backup. All new
/// reads and writes use `destination`, so active application data is no longer
/// split between the bundle identifier directory and the ZiCode directory.
pub fn migrate_legacy_metadata(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.is_file() || !source.is_file() {
        return Ok(());
    }
    let parent = destination
        .parent()
        .ok_or_else(|| format!("Metadata path has no parent: {}", destination.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create {}: {error}", parent.display()))?;
    let temporary = destination.with_extension(format!("sqlite3.tmp-{}", std::process::id()));
    fs::copy(source, &temporary).map_err(|error| {
        format!(
            "Cannot migrate metadata from {} to {}: {error}",
            source.display(),
            temporary.display()
        )
    })?;
    fs::rename(&temporary, destination).map_err(|error| {
        format!(
            "Cannot finish metadata migration from {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })
}

/// Remove abandoned instance directories that contain no saved Pi session.
///
/// A fresh temporary instance is created on every application launch. If the
/// user never sends a message, that instance has no `.jsonl` session and can
/// be removed safely on the next launch. Directories containing a session are
/// retained indefinitely.
pub fn cleanup_empty_instances() -> Result<usize, String> {
    cleanup_empty_instances_at(&data_root()?)
}

fn cleanup_empty_instances_at(root: &Path) -> Result<usize, String> {
    let instances = root.join("instances");
    if !instances.is_dir() {
        return Ok(0);
    }
    let mut removed = 0;
    for entry in fs::read_dir(&instances)
        .map_err(|error| format!("Cannot read {}: {error}", instances.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read instance entry: {error}"))?;
        let path = entry.path();
        if !path.is_dir() || contains_session_file(&path)? {
            continue;
        }
        fs::remove_dir_all(&path)
            .map_err(|error| format!("Cannot remove abandoned {}: {error}", path.display()))?;
        removed += 1;
    }
    Ok(removed)
}

fn contains_session_file(root: &Path) -> Result<bool, String> {
    for entry in
        fs::read_dir(root).map_err(|error| format!("Cannot read {}: {error}", root.display()))?
    {
        let entry = entry.map_err(|error| format!("Cannot read instance entry: {error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("Cannot inspect {}: {error}", entry.path().display()))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() && contains_session_file(&entry.path())? {
            return Ok(true);
        }
        if file_type.is_file()
            && entry
                .path()
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonl"))
        {
            return Ok(true);
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::{cleanup_empty_instances_at, migrate_legacy_metadata};
    use std::fs;

    #[test]
    fn migrates_metadata_once_without_deleting_the_legacy_backup() {
        let root = std::env::temp_dir().join(format!(
            "zicode-paths-metadata-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let source = root.join("legacy/picot.sqlite3");
        let destination = root.join("zicode/metadata/picot.sqlite3");
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, b"legacy database").unwrap();

        migrate_legacy_metadata(&source, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"legacy database");
        assert!(source.is_file());

        fs::write(&source, b"changed legacy database").unwrap();
        migrate_legacy_metadata(&source, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"legacy database");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn removes_only_instances_without_saved_sessions() {
        let root = std::env::temp_dir().join(format!(
            "zicode-paths-cleanup-{}",
            uuid::Uuid::new_v4().simple()
        ));
        let empty = root.join("instances/empty");
        let saved = root.join("instances/saved/sessions");
        fs::create_dir_all(empty.join("tmp")).unwrap();
        fs::create_dir_all(&saved).unwrap();
        fs::write(saved.join("session.jsonl"), b"{\"type\":\"session\"}\n").unwrap();

        assert_eq!(cleanup_empty_instances_at(&root).unwrap(), 1);
        assert!(!empty.exists());
        assert!(saved.parent().unwrap().exists());
        fs::remove_dir_all(root).unwrap();
    }
}

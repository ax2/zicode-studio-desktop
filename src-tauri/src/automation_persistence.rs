//! Shared file contract for Host automation state and the Pi repositories.
//! The Host only writes initialized workspace files; legacy global files must
//! be migrated by the Pi extension before a background scheduler can use them.

use chrono::Utc;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 8 * 1024 * 1024;
const MAX_WORKFLOWS: usize = 200;
const SNAPSHOT_KEEP: usize = 7;

#[derive(Clone, Copy)]
pub enum DocumentKind {
    Workflows,
    Tasks,
}

impl DocumentKind {
    fn invalid(self) -> &'static str {
        match self {
            Self::Workflows => "automation_workspace_invalid",
            Self::Tasks => "task_store_invalid",
        }
    }

    fn too_large(self) -> &'static str {
        match self {
            Self::Workflows => "automation_workspace_too_large",
            Self::Tasks => "task_store_too_large",
        }
    }

    fn busy(self) -> &'static str {
        match self {
            Self::Workflows => "automation_workspace_busy",
            Self::Tasks => "task_store_busy",
        }
    }

    fn conflict(self) -> &'static str {
        match self {
            Self::Workflows => "automation_workspace_conflict",
            Self::Tasks => "task_conflict",
        }
    }

    fn unreadable(self) -> &'static str {
        match self {
            Self::Workflows => "automation_workspace_unreadable",
            Self::Tasks => "task_store_unreadable",
        }
    }
}

pub struct DocumentSnapshot {
    pub value: Value,
    pub revision: String,
}

pub fn read_document(
    file: &Path,
    kind: DocumentKind,
) -> Result<Option<DocumentSnapshot>, &'static str> {
    let mut handle = match File::open(file) {
        Ok(handle) => handle,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(kind.unreadable()),
    };
    let mut bytes = Vec::new();
    Read::by_ref(&mut handle)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| kind.unreadable())?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(kind.too_large());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| kind.invalid())?;
    validate(&value, kind)?;
    Ok(Some(DocumentSnapshot {
        value,
        revision: digest(&bytes),
    }))
}

/// Compare the raw-byte revision under the same `<file>.lock` used by Pi,
/// snapshot the previous file, then publish a fully synced replacement.
/// Missing formal files are refused so legacy global data is not bypassed.
pub fn write_document(
    file: &Path,
    kind: DocumentKind,
    expected_revision: &str,
    value: &Value,
) -> Result<String, &'static str> {
    write_document_inner(file, kind, expected_revision, value, None)
}

/// Create the first formal file only when every known legacy fallback is
/// absent. This check runs while the Pi-compatible lock is held.
pub fn create_or_write_document(
    file: &Path,
    kind: DocumentKind,
    expected_revision: &str,
    value: &Value,
    legacy_paths: &[PathBuf],
) -> Result<String, &'static str> {
    if legacy_paths.is_empty() {
        return Err("task_migration_required");
    }
    write_document_inner(file, kind, expected_revision, value, Some(legacy_paths))
}

fn write_document_inner(
    file: &Path,
    kind: DocumentKind,
    expected_revision: &str,
    value: &Value,
    legacy_paths: Option<&[PathBuf]>,
) -> Result<String, &'static str> {
    if expected_revision.len() != 64
        || !expected_revision
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(match kind {
            DocumentKind::Workflows => "automation_workspace_revision_required",
            DocumentKind::Tasks => "task_revision_required",
        });
    }
    validate(value, kind)?;
    let content = serde_json::to_string_pretty(value).map_err(|_| kind.invalid())?;
    if content.len() as u64 > MAX_BYTES {
        return Err(kind.too_large());
    }
    let parent = file.parent().ok_or(kind.unreadable())?;
    fs::create_dir_all(parent).map_err(|_| kind.unreadable())?;
    let lock_path = append_suffix(file, ".lock");
    let lock = create_private_file(&lock_path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            kind.busy()
        } else {
            kind.unreadable()
        }
    })?;
    let mut lock_guard = LockGuard {
        file: Some(lock),
        path: lock_path,
    };
    let lock_metadata = serde_json::json!({
        "pid": std::process::id(),
        "createdAt": Utc::now().to_rfc3339(),
    });
    lock_guard
        .file
        .as_mut()
        .ok_or(kind.unreadable())?
        .write_all(lock_metadata.to_string().as_bytes())
        .map_err(|_| kind.unreadable())?;
    let current_revision = match read_document(file, kind)? {
        Some(snapshot) => snapshot.revision,
        None if legacy_paths.is_some() => {
            for path in legacy_paths.unwrap_or_default() {
                match fs::symlink_metadata(path) {
                    Ok(_) => return Err("task_migration_required"),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(_) => return Err("task_migration_unreadable"),
                }
            }
            digest(b"missing")
        }
        None => return Err(kind.conflict()),
    };
    if current_revision != expected_revision {
        return Err(kind.conflict());
    }
    let temporary = append_suffix(file, &format!(".{}.tmp", uuid::Uuid::new_v4()));
    let mut temp_guard = TempGuard::new(temporary.clone());
    let mut output = create_private_file(&temporary).map_err(|_| kind.unreadable())?;
    output
        .write_all(content.as_bytes())
        .and_then(|()| output.sync_all())
        .map_err(|_| kind.unreadable())?;
    drop(output);
    snapshot_before_write(file);
    fs::rename(&temporary, file).map_err(|_| kind.unreadable())?;
    temp_guard.committed = true;
    drop(lock_guard);
    Ok(digest(content.as_bytes()))
}

fn validate(value: &Value, kind: DocumentKind) -> Result<(), &'static str> {
    let entries = match kind {
        DocumentKind::Workflows => {
            if value.get("version").and_then(Value::as_u64) != Some(1) {
                return Err(kind.invalid());
            }
            let entries = value
                .get("workflows")
                .and_then(Value::as_array)
                .ok_or(kind.invalid())?;
            if entries.len() > MAX_WORKFLOWS {
                return Err(kind.invalid());
            }
            entries
        }
        DocumentKind::Tasks => value
            .get("tasks")
            .and_then(Value::as_array)
            .ok_or(kind.invalid())?,
    };
    let mut ids = HashSet::new();
    for entry in entries {
        let id = entry
            .get("id")
            .and_then(Value::as_str)
            .ok_or(kind.invalid())?;
        if id.is_empty() || !ids.insert(id) {
            return Err(kind.invalid());
        }
    }
    Ok(())
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn append_suffix(file: &Path, suffix: &str) -> PathBuf {
    let mut name = file.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}

fn create_private_file(path: &Path) -> std::io::Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

struct LockGuard {
    file: Option<File>,
    path: PathBuf,
}

impl Drop for LockGuard {
    fn drop(&mut self) {
        drop(self.file.take());
        let _ = fs::remove_file(&self.path);
    }
}

struct TempGuard {
    path: PathBuf,
    committed: bool,
}

impl TempGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            committed: false,
        }
    }
}

impl Drop for TempGuard {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

fn snapshot_before_write(file: &Path) {
    let Some(parent) = file.parent() else {
        return;
    };
    let history = parent.join(".history");
    if fs::create_dir_all(&history).is_err() {
        return;
    }
    let stamp = Utc::now().format("%Y-%m-%d_%H-%M-%S-%3f");
    let snapshot = history.join(format!(
        "snapshot-{stamp}-{}.json",
        &uuid::Uuid::new_v4().simple().to_string()[..6]
    ));
    if fs::copy(file, snapshot).is_err() {
        return;
    }
    let Ok(entries) = fs::read_dir(history) else {
        return;
    };
    let mut snapshots: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("snapshot-") && name.ends_with(".json"))
        })
        .collect();
    snapshots.sort();
    for stale in snapshots
        .iter()
        .take(snapshots.len().saturating_sub(SNAPSHOT_KEEP))
    {
        let _ = fs::remove_file(stale);
    }
}

//! Read-only, bounded inventory of common generated project directories.
use serde::Serialize;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_ENTRIES: u64 = 100_000;
const SCAN_BUDGET: Duration = Duration::from_secs(5);
const CANDIDATES: &[&str] = &[
    "node_modules",
    ".next",
    ".turbo",
    "dist",
    "build",
    "site",
    "coverage",
    "target",
    "src-tauri/target",
    ".cache",
    ".gradle",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".svelte-kit",
    ".nuxt",
    ".output",
    "obj",
    ".venv",
    ".conda",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageEntry {
    pub path: String,
    pub bytes: u64,
    pub files: u64,
    pub hardlink_bytes: u64,
    pub hardlink_files: u64,
    pub skipped: u64,
    pub status: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    pub directory: String,
    pub checked_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_bytes: Option<u64>,
    pub entries: Vec<StorageEntry>,
}

fn is_link(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        // Junctions and other reparse points must not lead a scan outside the workspace.
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    false
}

fn has_multiple_hardlinks(path: &Path, metadata: &Metadata) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let _ = path;
        metadata.nlink() > 1
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::Storage::FileSystem::{
            GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
        };
        let _ = metadata;
        let Ok(file) = fs::File::open(path) else {
            return false;
        };
        let mut info = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
        let status =
            unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr()) };
        status != 0 && unsafe { info.assume_init().nNumberOfLinks > 1 }
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = (path, metadata);
        false
    }
}

fn candidate(root: &Path, relative: &str) -> Result<Option<PathBuf>, &'static str> {
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("unreadable"),
        };
        if is_link(&metadata) {
            return Err("linked");
        }
        if !metadata.is_dir() {
            return Err("not_directory");
        }
    }
    Ok(Some(path))
}

fn scan(path: &Path, name: &str, deadline: Instant) -> StorageEntry {
    let mut entry = StorageEntry {
        path: name.into(),
        bytes: 0,
        files: 0,
        hardlink_bytes: 0,
        hardlink_files: 0,
        skipped: 0,
        status: "complete",
    };
    let mut seen = 0;
    let mut stack = vec![(path.to_path_buf(), 0usize)];
    while let Some((directory, depth)) = stack.pop() {
        if Instant::now() >= deadline || seen >= MAX_ENTRIES || depth > 64 {
            entry.status = "partial";
            break;
        }
        let children = match fs::read_dir(directory) {
            Ok(children) => children,
            Err(_) => {
                entry.status = "partial";
                continue;
            }
        };
        for child in children {
            if Instant::now() >= deadline || seen >= MAX_ENTRIES {
                entry.status = "partial";
                return entry;
            }
            seen += 1;
            let Ok(child) = child else {
                entry.skipped += 1;
                entry.status = "partial";
                continue;
            };
            let Ok(metadata) = fs::symlink_metadata(child.path()) else {
                entry.skipped += 1;
                entry.status = "partial";
                continue;
            };
            if is_link(&metadata) {
                entry.skipped += 1;
                entry.status = "partial";
            } else if metadata.is_dir() {
                if depth >= 64 {
                    entry.skipped += 1;
                    entry.status = "partial";
                } else {
                    stack.push((child.path(), depth + 1));
                }
            } else if metadata.is_file() {
                entry.files += 1;
                entry.bytes = entry.bytes.saturating_add(metadata.len());
                if has_multiple_hardlinks(&child.path(), &metadata) {
                    entry.hardlink_files += 1;
                    entry.hardlink_bytes = entry.hardlink_bytes.saturating_add(metadata.len());
                }
            } else {
                entry.skipped += 1;
                entry.status = "partial";
            }
        }
    }
    entry
}

pub fn inspect(root: &Path, directory: &str) -> Result<StorageReport, String> {
    let root = root
        .canonicalize()
        .map_err(|_| "project_storage_unavailable")?;
    if !root.is_dir() {
        return Err("project_storage_unavailable".into());
    }
    let selected = crate::project_tasks::directories::resolve(&root, directory)?;
    let available_bytes = fs2::available_space(&selected)
        .ok()
        .filter(|bytes| *bytes <= 9_007_199_254_740_991);
    let deadline = Instant::now() + SCAN_BUDGET;
    let entries = CANDIDATES
        .iter()
        .filter_map(|name| match candidate(&selected, name) {
            Ok(None) => None,
            Ok(Some(path)) => Some(scan(&path, name, deadline)),
            Err(status) => Some(StorageEntry {
                path: (*name).into(),
                bytes: 0,
                files: 0,
                hardlink_bytes: 0,
                hardlink_files: 0,
                skipped: 0,
                status,
            }),
        })
        .collect();
    Ok(StorageReport {
        directory: directory.into(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        available_bytes,
        entries,
    })
}

//! Read-only, bounded inventory of common generated project directories.
use serde::Serialize;
use std::collections::VecDeque;
use std::fs::{self, Metadata};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const MAX_ENTRIES: u64 = 100_000;
const DIRECTORY_BATCH: usize = 32;
const MAX_QUEUED_DIRECTORIES: usize = 1_024;
const SCAN_BUDGET: Duration = Duration::from_secs(5);
const DEEP_SCAN_BUDGET: Duration = Duration::from_secs(180);
const DEEP_MAX_ENTRIES: u64 = 1_000_000;
const CARGO_BREAKDOWNS: &[&str] = &[
    "debug",
    "release",
    "debug/deps",
    "debug/build",
    "debug/incremental",
];
const CACHE_BREAKDOWNS: &[&str] = &["task-scratch"];
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
    pub scan_mode: &'static str,
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
        use std::os::windows::ffi::OsStrExt;
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
            FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT,
            FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
            OPEN_EXISTING,
        };
        let _ = metadata;
        // File::open requests data-read access and can hydrate cold placeholders.
        // A metadata-only handle is enough to inspect the link count.
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
        let handle = unsafe {
            CreateFileW(
                wide.as_ptr(),
                FILE_READ_ATTRIBUTES,
                FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                std::ptr::null(),
                OPEN_EXISTING,
                FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_OPEN_NO_RECALL,
                std::ptr::null_mut(),
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            return false;
        }
        let file = unsafe { OwnedHandle::from_raw_handle(handle) };
        let mut info = std::mem::MaybeUninit::<BY_HANDLE_FILE_INFORMATION>::uninit();
        let status =
            unsafe { GetFileInformationByHandle(file.as_raw_handle() as _, info.as_mut_ptr()) };
        status != 0
            && unsafe {
                let info = info.assume_init();
                info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT == 0 && info.nNumberOfLinks > 1
            }
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

fn empty_entry(name: &str, status: &'static str) -> StorageEntry {
    StorageEntry {
        path: name.into(),
        bytes: 0,
        files: 0,
        hardlink_bytes: 0,
        hardlink_files: 0,
        skipped: 0,
        status,
    }
}

fn nested_breakdowns(path: &Path, name: &str) -> Vec<(Option<PathBuf>, StorageEntry)> {
    let children = match name {
        "target" | "src-tauri/target" => CARGO_BREAKDOWNS,
        ".cache" => CACHE_BREAKDOWNS,
        _ => return Vec::new(),
    };
    children
        .iter()
        .filter_map(|relative| {
            let label = format!("{name}/{relative}");
            match candidate(path, relative) {
                Ok(None) => None,
                Ok(Some(target)) => Some((Some(target), empty_entry(&label, "complete"))),
                Err(status) => Some((None, empty_entry(&label, status))),
            }
        })
        .collect()
}

fn observe_file(
    entry: &mut StorageEntry,
    breakdowns: &mut [(Option<PathBuf>, StorageEntry)],
    path: &Path,
    metadata: &Metadata,
) {
    entry.files += 1;
    entry.bytes = entry.bytes.saturating_add(metadata.len());
    let hardlinked = has_multiple_hardlinks(path, metadata);
    if hardlinked {
        entry.hardlink_files += 1;
        entry.hardlink_bytes = entry.hardlink_bytes.saturating_add(metadata.len());
    }
    for (target, breakdown) in breakdowns {
        if target
            .as_ref()
            .is_some_and(|target| path.starts_with(target))
        {
            breakdown.files += 1;
            breakdown.bytes = breakdown.bytes.saturating_add(metadata.len());
            if hardlinked {
                breakdown.hardlink_files += 1;
                breakdown.hardlink_bytes = breakdown.hardlink_bytes.saturating_add(metadata.len());
            }
        }
    }
}

fn finish_scan(
    entry: StorageEntry,
    mut breakdowns: Vec<(Option<PathBuf>, StorageEntry)>,
) -> Vec<StorageEntry> {
    if entry.status != "complete" {
        for (target, breakdown) in &mut breakdowns {
            if target.is_some() {
                breakdown.status = "partial";
            }
        }
    }
    std::iter::once(entry)
        .chain(breakdowns.into_iter().map(|(_, entry)| entry))
        .collect()
}

fn scan(path: &Path, name: &str, deadline: Instant) -> Vec<StorageEntry> {
    scan_with_limit(path, name, deadline, MAX_ENTRIES)
}

fn scan_with_limit(
    path: &Path,
    name: &str,
    deadline: Instant,
    max_entries: u64,
) -> Vec<StorageEntry> {
    let mut entry = empty_entry(name, "complete");
    let mut breakdowns = nested_breakdowns(path, name);
    let mut seen = 0;
    let mut queue = VecDeque::new();
    match fs::read_dir(path) {
        Ok(children) => queue.push_back((children, 0usize)),
        Err(_) => entry.status = "partial",
    }
    'directories: while let Some((mut children, depth)) = queue.pop_front() {
        let mut processed = 0;
        loop {
            if Instant::now() >= deadline || seen >= max_entries {
                entry.status = "partial";
                break 'directories;
            }
            if processed == DIRECTORY_BATCH {
                queue.push_back((children, depth));
                break;
            }
            let Some(child) = children.next() else { break };
            processed += 1;
            seen += 1;
            let Ok(child) = child else {
                entry.skipped += 1;
                entry.status = "partial";
                continue;
            };
            let child_path = child.path();
            let Ok(metadata) = fs::symlink_metadata(&child_path) else {
                entry.skipped += 1;
                entry.status = "partial";
                continue;
            };
            if is_link(&metadata) {
                entry.skipped += 1;
                entry.status = "partial";
            } else if metadata.is_dir() {
                if depth >= 64 || queue.len() >= MAX_QUEUED_DIRECTORIES {
                    entry.skipped += 1;
                    entry.status = "partial";
                } else {
                    match fs::read_dir(&child_path) {
                        Ok(children) => queue.push_back((children, depth + 1)),
                        Err(_) => {
                            entry.skipped += 1;
                            entry.status = "partial";
                        }
                    }
                }
            } else if metadata.is_file() {
                observe_file(&mut entry, &mut breakdowns, &child_path, &metadata);
            } else {
                entry.skipped += 1;
                entry.status = "partial";
            }
        }
    }
    finish_scan(entry, breakdowns)
}

fn scan_deep(path: &Path, name: &str, deadline: Instant) -> Vec<StorageEntry> {
    let mut entry = empty_entry(name, "complete");
    let mut breakdowns = nested_breakdowns(path, name);
    let mut seen = 0;
    let mut stack = vec![(path.to_path_buf(), 0usize)];
    'directories: while let Some((directory, depth)) = stack.pop() {
        if Instant::now() >= deadline || seen >= DEEP_MAX_ENTRIES {
            entry.status = "partial";
            break;
        }
        let children = match fs::read_dir(directory) {
            Ok(children) => children,
            Err(_) => {
                entry.skipped += 1;
                entry.status = "partial";
                continue;
            }
        };
        for child in children {
            if Instant::now() >= deadline || seen >= DEEP_MAX_ENTRIES {
                entry.status = "partial";
                break 'directories;
            }
            seen += 1;
            let Ok(child) = child else {
                entry.skipped += 1;
                entry.status = "partial";
                continue;
            };
            let child_path = child.path();
            let Ok(metadata) = fs::symlink_metadata(&child_path) else {
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
                    stack.push((child_path, depth + 1));
                }
            } else if metadata.is_file() {
                observe_file(&mut entry, &mut breakdowns, &child_path, &metadata);
            } else {
                entry.skipped += 1;
                entry.status = "partial";
            }
        }
    }
    finish_scan(entry, breakdowns)
}

pub fn inspect(root: &Path, directory: &str, deep: bool) -> Result<StorageReport, String> {
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
    let deadline = Instant::now() + if deep { DEEP_SCAN_BUDGET } else { SCAN_BUDGET };
    // Start independent roots together. A slow dependency tree must not consume
    // the whole deadline before Cargo or another candidate gets inspected.
    // The Tauri command admits only one scan at a time; at most CANDIDATES.len()
    // short-lived readers are active for that scan.
    let entries = std::thread::scope(|scope| {
        let mut readers = Vec::new();
        let mut rows: Vec<(usize, Vec<StorageEntry>)> = Vec::new();
        for (index, name) in CANDIDATES.iter().enumerate() {
            match candidate(&selected, name) {
                Ok(None) => {}
                Ok(Some(path)) => {
                    readers.push((
                        index,
                        name,
                        scope.spawn(move || {
                            if deep {
                                scan_deep(&path, name, deadline)
                            } else {
                                scan(&path, name, deadline)
                            }
                        }),
                    ));
                }
                Err(status) => rows.push((index, vec![empty_entry(name, status)])),
            }
        }
        for (index, name, reader) in readers {
            rows.push((
                index,
                reader
                    .join()
                    .unwrap_or_else(|_| vec![empty_entry(name, "unreadable")]),
            ));
        }
        rows.sort_by_key(|(index, _)| *index);
        rows.into_iter().flat_map(|(_, entries)| entries).collect()
    });
    Ok(StorageReport {
        directory: directory.into(),
        checked_at: chrono::Utc::now().to_rfc3339(),
        scan_mode: if deep { "deep" } else { "quick" },
        available_bytes,
        entries,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cargo_breakdown_counts_in_one_scan_and_never_marks_partial_detail_complete() {
        let root = std::env::temp_dir().join(format!("studio-storage-{}", uuid::Uuid::new_v4()));
        let target = root.join("target");
        for (name, bytes) in [
            ("debug/deps/dependency.bin", b"a".as_slice()),
            ("debug/build/build.bin", b"bb".as_slice()),
            ("debug/incremental/old.bin", b"ccc".as_slice()),
            ("release/app.bin", b"dddd".as_slice()),
        ] {
            let file = target.join(name);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, bytes).unwrap();
        }
        let rows = scan(&target, "target", Instant::now() + Duration::from_secs(5));
        let row = |name: &str| rows.iter().find(|entry| entry.path == name).unwrap();
        assert_eq!((row("target").bytes, row("target").files), (10, 4));
        assert_eq!(
            (row("target/debug").bytes, row("target/debug").files),
            (6, 3)
        );
        assert_eq!(row("target/release").bytes, 4);
        assert_eq!(row("target/debug/deps").bytes, 1);
        assert_eq!(row("target/debug/build").bytes, 2);
        assert_eq!(row("target/debug/incremental").bytes, 3);
        assert!(rows.iter().all(|entry| entry.status == "complete"));

        let deep_rows = scan_deep(&target, "target", Instant::now() + Duration::from_secs(5));
        assert_eq!(deep_rows.len(), rows.len());
        for expected in &rows {
            let actual = deep_rows
                .iter()
                .find(|entry| entry.path == expected.path)
                .unwrap();
            assert_eq!(
                (actual.bytes, actual.files, actual.status),
                (expected.bytes, expected.files, expected.status)
            );
        }

        let partial = scan(&target, "target", Instant::now());
        assert!(partial.iter().all(|entry| entry.status == "partial"));
        let deep_partial = scan_deep(&target, "target", Instant::now());
        assert!(deep_partial.iter().all(|entry| entry.status == "partial"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cargo_branches_both_receive_entries_under_a_scan_limit() {
        let root = std::env::temp_dir().join(format!("studio-storage-{}", uuid::Uuid::new_v4()));
        let target = root.join("target");
        for branch in ["debug/deps", "release"] {
            let directory = target.join(branch);
            fs::create_dir_all(&directory).unwrap();
            for index in 0..100 {
                fs::write(directory.join(format!("{index:03}.bin")), b"x").unwrap();
            }
        }
        let rows = scan_with_limit(
            &target,
            "target",
            Instant::now() + Duration::from_secs(5),
            80,
        );
        let row = |name: &str| rows.iter().find(|entry| entry.path == name).unwrap();
        assert!(row("target/debug/deps").files > 0);
        assert!(row("target/release").files > 0);
        assert_eq!(row("target").status, "partial");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn scratch_detail_is_included_in_cache_and_stays_partial_with_parent() {
        let root = std::env::temp_dir().join(format!("studio-storage-{}", uuid::Uuid::new_v4()));
        let cache = root.join(".cache");
        fs::create_dir_all(cache.join("task-scratch/run")).unwrap();
        fs::write(cache.join("task-scratch/run/evidence.bin"), b"abc").unwrap();
        fs::write(cache.join("download.bin"), b"de").unwrap();

        let complete = scan(&cache, ".cache", Instant::now() + Duration::from_secs(5));
        let parent = complete.iter().find(|entry| entry.path == ".cache").unwrap();
        let scratch = complete
            .iter()
            .find(|entry| entry.path == ".cache/task-scratch")
            .unwrap();
        assert_eq!((parent.bytes, parent.files, parent.status), (5, 2, "complete"));
        assert_eq!((scratch.bytes, scratch.files, scratch.status), (3, 1, "complete"));

        let partial = scan(&cache, ".cache", Instant::now());
        assert!(partial.iter().all(|entry| entry.status == "partial"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn hardlink_metadata_probe_uses_file_identity_without_reading_content() {
        let root = std::env::temp_dir().join(format!("studio-storage-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.bin");
        let second = root.join("second.bin");
        fs::write(&first, b"evidence").unwrap();
        fs::hard_link(&first, &second).unwrap();
        assert!(has_multiple_hardlinks(&first, &fs::symlink_metadata(&first).unwrap()));
        assert!(has_multiple_hardlinks(&second, &fs::symlink_metadata(&second).unwrap()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    #[ignore = "read-only diagnostic of an explicitly selected large workspace"]
    fn real_workspace_deep_scan_keeps_cargo_detail_status_consistent() {
        let root = PathBuf::from(
            std::env::var_os("STUDIO_STORAGE_REAL_WORKSPACE")
                .expect("set STUDIO_STORAGE_REAL_WORKSPACE to a workspace directory"),
        );
        let report = inspect(&root, "", true).unwrap();
        for entry in &report.entries {
            if entry.path == "target" || entry.path.starts_with("target/") {
                println!(
                    "{}: {} B / {} files / {} / {} skipped",
                    entry.path, entry.bytes, entry.files, entry.status, entry.skipped
                );
            }
        }
        if let Some(parent) = report.entries.iter().find(|entry| entry.path == "target") {
            if parent.status == "complete" {
                assert!(report
                    .entries
                    .iter()
                    .filter(|entry| entry.path.starts_with("target/"))
                    .all(|entry| entry.status == "complete"));
            }
        }
    }
}

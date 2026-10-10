//! Bounded workspace file listings for the sidebar and paged clients.
use super::{safe_join, HostDataError, HostDataPlane};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

const LEGACY_LIMIT: usize = 4096;
const PAGED_SCAN_LIMIT: usize = 100_000;
const PAGE_SIZE: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub relative_path: String,
    pub kind: FileKind,
    /// Byte size of the file; `None` for directories or when metadata is unavailable.
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FileKind {
    File,
    Directory,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilePage {
    pub entries: Vec<FileEntry>,
    pub next_offset: Option<usize>,
    pub snapshot: String,
}

impl HostDataPlane {
    /// Preserve the complete response for older clients, within its existing limit.
    pub fn list_files(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<Vec<FileEntry>, HostDataError> {
        scan(self, workspace_id, relative_path, LEGACY_LIMIT)
    }

    pub fn list_files_page(
        &self,
        workspace_id: &str,
        relative_path: &str,
        offset: usize,
        expected_snapshot: Option<&str>,
    ) -> Result<FilePage, HostDataError> {
        if offset > PAGED_SCAN_LIMIT
            || (offset > 0 && expected_snapshot.is_none())
            || expected_snapshot.is_some_and(|snapshot| {
                snapshot.len() != 64 || !snapshot.bytes().all(|byte| byte.is_ascii_hexdigit())
            })
        {
            return Err(HostDataError::Io(
                "File page is invalid; refresh the file list".into(),
            ));
        }
        let entries = scan(self, workspace_id, relative_path, PAGED_SCAN_LIMIT)?;
        let snapshot = fingerprint(&entries);
        if expected_snapshot.is_some_and(|expected| expected != snapshot) || offset > entries.len()
        {
            return Err(HostDataError::Io(
                "Directory changed; refresh the file list".into(),
            ));
        }
        let end = offset.saturating_add(PAGE_SIZE).min(entries.len());
        Ok(FilePage {
            entries: entries[offset..end].to_vec(),
            next_offset: (end < entries.len()).then_some(end),
            snapshot,
        })
    }
}

fn scan(
    data: &HostDataPlane,
    workspace_id: &str,
    relative_path: &str,
    limit: usize,
) -> Result<Vec<FileEntry>, HostDataError> {
    let root = data.workspace_root(workspace_id)?;
    let root = root.as_path();
    let requested = safe_join(root, relative_path)?;
    if !requested.is_dir() {
        return Err(HostDataError::NotDirectory);
    }
    let directory = std::fs::read_dir(&requested)
        .map_err(|_| HostDataError::Io("Directory could not be read completely".into()))?;
    let mut entries = Vec::new();
    for (index, entry) in directory.enumerate() {
        if index >= limit {
            return Err(HostDataError::Io(
                "Directory has too many entries; open it in the system file manager".into(),
            ));
        }
        let entry = entry
            .map_err(|_| HostDataError::Io("Directory could not be read completely".into()))?;
        let file_type = entry
            .file_type()
            .map_err(|_| HostDataError::Io("Directory could not be read completely".into()))?;
        let kind = if file_type.is_dir() {
            FileKind::Directory
        } else if file_type.is_file() {
            FileKind::File
        } else {
            continue;
        };
        let name = entry.file_name().into_string().map_err(|_| {
            HostDataError::Io("Directory contains a filename that cannot be displayed".into())
        })?;
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .ok()
            .and_then(Path::to_str)
            .ok_or_else(|| {
                HostDataError::Io("Directory contains a filename that cannot be displayed".into())
            })?;
        let size = if kind == FileKind::File {
            entry.metadata().ok().map(|metadata| metadata.len())
        } else {
            None
        };
        entries.push(FileEntry {
            name,
            relative_path: {
                #[cfg(windows)]
                {
                    relative.replace('\\', "/")
                }
                #[cfg(not(windows))]
                {
                    relative.to_owned()
                }
            },
            kind,
            size,
        });
    }
    entries.sort_by(|left, right| {
        (right.kind == FileKind::Directory)
            .cmp(&(left.kind == FileKind::Directory))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
    Ok(entries)
}

fn fingerprint(entries: &[FileEntry]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"zicode-file-page-v1\0");
    for entry in entries {
        hash.update([u8::from(entry.kind == FileKind::Directory)]);
        hash.update((entry.relative_path.len() as u64).to_le_bytes());
        hash.update(entry.relative_path.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

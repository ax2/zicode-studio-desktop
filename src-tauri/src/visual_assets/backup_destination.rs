use super::Result;
use std::{
    fs::{self, File, OpenOptions},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_SHARE_READ, FILE_SHARE_WRITE,
};

/// Keep the selected directory and its ancestors from being renamed during queued work.
pub fn hold(path: &Path) -> Result<(PathBuf, Vec<File>)> {
    let path = fs::canonicalize(path)?;
    let ancestors: Vec<_> = path.ancestors().collect();
    let mut handles = Vec::new();
    for ancestor in ancestors.into_iter().rev() {
        let handle = OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
            .open(ancestor)?;
        let metadata = handle.metadata()?;
        if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err("backup directory identity changed".into());
        }
        handles.push(handle);
    }
    Ok((path, handles))
}

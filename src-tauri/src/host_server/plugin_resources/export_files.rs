//! User-selected local destinations. Lock ancestors while publishing, never replace.
use super::*;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub(in crate::host_server) struct Destination {
    pub path: PathBuf,
    identity: String,
}

struct Parent {
    _handles: Vec<File>,
    identity: String,
}
fn parent(path: &Path) -> Result<Parent, ApiError> {
    #[cfg(windows)]
    if !matches!(path.components().next(),Some(std::path::Component::Prefix(p)) if matches!(p.kind(),std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(rejected("resource_export_path_invalid"));
    }
    if !path.is_absolute()
        || path.file_name().and_then(|s| s.to_str()).is_none_or(|s| {
            s.is_empty()
                || s.ends_with(['.', ' '])
                || s.chars().any(|c| c.is_control() || ":/\\".contains(c))
        })
    {
        return Err(rejected("resource_export_path_invalid"));
    }
    let mut ancestors: Vec<_> = path
        .parent()
        .ok_or_else(|| rejected("resource_export_path_invalid"))?
        .ancestors()
        .collect();
    ancestors.reverse();
    let mut handles = Vec::new();
    let mut identities = Vec::new();
    for directory in ancestors {
        let meta = fs::symlink_metadata(directory)
            .map_err(|_| rejected("resource_export_directory_unavailable"))?;
        if !meta.is_dir() || meta.file_type().is_symlink() {
            return Err(rejected("resource_export_path_invalid"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::{
                fs::{MetadataExt, OpenOptionsExt},
                io::AsRawHandle,
            };
            use windows_sys::Win32::Storage::FileSystem::*;
            if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                return Err(rejected("resource_export_path_invalid"));
            }
            let handle = OpenOptions::new()
                .read(true)
                .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
                .open(directory)
                .map_err(|_| rejected("resource_export_directory_unavailable"))?;
            let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
            if unsafe { GetFileInformationByHandle(handle.as_raw_handle(), &mut info) } == 0
                || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
            {
                return Err(rejected("resource_export_path_invalid"));
            }
            identities.push(format!(
                "{}:{}:{}",
                info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
            ));
            handles.push(handle);
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            identities.push(format!("{}:{}", meta.dev(), meta.ino()));
            handles.push(
                File::open(directory)
                    .map_err(|_| rejected("resource_export_directory_unavailable"))?,
            );
        }
    }
    Ok(Parent {
        _handles: handles,
        identity: identities.join("/"),
    })
}
impl Destination {
    pub(in crate::host_server) fn prepare(path: PathBuf) -> Result<Self, ApiError> {
        let locked = parent(&path)?;
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(rejected("resource_export_conflict")),
        }
        Ok(Self {
            path,
            identity: locked.identity,
        })
    }
    fn lock(&self) -> Result<Parent, ApiError> {
        let p = parent(&self.path)?;
        if p.identity != self.identity {
            return Err(rejected("resource_export_destination_changed"));
        }
        Ok(p)
    }
    pub(in crate::host_server) fn verify(&self, size: usize, version: &str) -> Result<(), ApiError> {
        let _parent = self.lock()?;
        let mut options = OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::*;
            options
                .share_mode(FILE_SHARE_READ)
                .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
        }
        let mut file = options
            .open(&self.path)
            .map_err(|_| rejected("resource_export_not_verified"))?;
        let meta = file
            .metadata()
            .map_err(|_| rejected("resource_export_not_verified"))?;
        if !meta.is_file() || meta.len() != size as u64 {
            return Err(rejected("resource_export_not_verified"));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if meta.file_attributes() & 0x400 != 0 {
                return Err(rejected("resource_export_not_verified"));
            }
        }
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        let mut read = 0usize;
        loop {
            let n = file
                .read(&mut buffer)
                .map_err(|_| rejected("resource_export_not_verified"))?;
            if n == 0 {
                break;
            }
            read += n;
            if read > size {
                return Err(rejected("resource_export_not_verified"));
            }
            hash.update(&buffer[..n]);
        }
        if read != size || format!("{:x}", hash.finalize()) != version {
            return Err(rejected("resource_export_not_verified"));
        }
        Ok(())
    }
}

pub(in crate::host_server) struct Staged {
    destination: Destination,
    temporary: PathBuf,
    file: Option<File>,
    _parent: Parent,
    published: bool,
}
impl Staged {
    pub(in crate::host_server) fn new(
        destination: &Destination,
        chunks: &[Arc<[u8]>],
        size: usize,
        version: &str,
    ) -> Result<Self, ApiError> {
        let locked = destination.lock()?;
        let temporary = destination
            .path
            .parent()
            .unwrap()
            .join(format!(".zicode-export-{}.pending", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_SHARE_READ};
            options
                .access_mode(0x40000000 | DELETE)
                .share_mode(FILE_SHARE_READ);
        }
        let file = options
            .open(&temporary)
            .map_err(|_| rejected("resource_export_write_failed"))?;
        let mut staged = Self {
            destination: destination.clone(),
            temporary,
            file: Some(file),
            _parent: locked,
            published: false,
        };
        let mut hash = Sha256::new();
        let mut length = 0usize;
        for chunk in chunks {
            length = length
                .checked_add(chunk.len())
                .ok_or_else(|| rejected("resource_budget_exceeded"))?;
            if length > size {
                return Err(rejected("resource_content_mismatch"));
            }
            staged
                .file
                .as_mut()
                .unwrap()
                .write_all(chunk)
                .map_err(|_| rejected("resource_export_write_failed"))?;
            hash.update(chunk);
        }
        if length != size || format!("{:x}", hash.finalize()) != version {
            return Err(rejected("resource_content_mismatch"));
        }
        staged
            .file
            .as_ref()
            .unwrap()
            .sync_all()
            .map_err(|_| rejected("resource_export_write_failed"))?;
        Ok(staged)
    }
    pub(in crate::host_server) fn publish(mut self) -> Result<(), ApiError> {
        #[cfg(windows)]
        {
            use std::os::windows::{ffi::OsStrExt, io::AsRawHandle};
            use windows_sys::Win32::Storage::FileSystem::*;
            let filename: Vec<u16> = self.destination.path.as_os_str().encode_wide().collect();
            let offset = std::mem::offset_of!(FILE_RENAME_INFO, FileName);
            // FileNameLength excludes the terminator, but the Win32 FileName
            // contract requires NUL termination. Do not depend on incidental
            // allocation padding: aligned path lengths had no trailing zero.
            let length = offset + (filename.len() + 1) * 2;
            // usize allocation supplies alignment and zero-initializes both
            // ReplaceIfExists=false and the explicit final UTF-16 NUL.
            let mut buffer = vec![0usize; length.div_ceil(std::mem::size_of::<usize>())];
            let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
            unsafe {
                (*info).FileNameLength = (filename.len() * 2) as u32;
                std::ptr::copy_nonoverlapping(
                    filename.as_ptr(),
                    buffer.as_mut_ptr().cast::<u8>().add(offset).cast::<u16>(),
                    filename.len(),
                );
            }
            if unsafe {
                SetFileInformationByHandle(
                    self.file.as_ref().unwrap().as_raw_handle(),
                    FileRenameInfo,
                    info.cast(),
                    length as u32,
                )
            } == 0
            {
                let code = match std::io::Error::last_os_error().raw_os_error() {
                    Some(80 | 183) => "resource_export_conflict",
                    _ => "resource_export_write_failed",
                };
                return Err(rejected(code));
            }
        }
        #[cfg(not(windows))]
        {
            fs::hard_link(&self.temporary, &self.destination.path)
                .map_err(|_| rejected("resource_export_conflict"))?;
            fs::remove_file(&self.temporary)
                .map_err(|_| rejected("resource_export_write_failed"))?;
        }
        self.published = true;
        Ok(())
    }
}
impl Drop for Staged {
    fn drop(&mut self) {
        self.file.take();
        if !self.published {
            let _ = fs::remove_file(&self.temporary);
        }
    }
}

#[cfg(test)]
mod tests;

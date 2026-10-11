use super::*;
use std::fs::{File, OpenOptions};
use std::io::Read;

pub(super) fn components(relative: &str) -> Result<Vec<&str>, ApiError> {
    if relative.is_empty() || relative.len() > 4096 || relative.split('/').count() > 64 {
        return Err(rejected("resource_file_path_invalid"));
    }
    let parts: Vec<_> = relative.split('/').collect();
    for part in &parts {
        let base = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(
            base.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'));
        if part.is_empty()
            || matches!(*part, "." | "..")
            || part.len() > 255
            || part.ends_with(['.', ' '])
            || reserved
            || part.chars().any(|c| {
                c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*')
            })
        {
            return Err(rejected("resource_file_path_invalid"));
        }
    }
    Ok(parts)
}

#[cfg(unix)]
pub(super) fn open(root: &Path, relative: &str) -> Result<File, ApiError> {
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::fs::OpenOptionsExt;
    let parts = components(relative)?;
    let mut directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(root)
        .map_err(|_| rejected("resource_file_unavailable"))?;
    for (index, part) in parts.iter().enumerate() {
        let name =
            std::ffi::CString::new(*part).map_err(|_| rejected("resource_file_path_invalid"))?;
        let flags = libc::O_RDONLY
            | libc::O_NOFOLLOW
            | libc::O_CLOEXEC
            | libc::O_NONBLOCK
            | if index + 1 == parts.len() {
                0
            } else {
                libc::O_DIRECTORY
            };
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(rejected("resource_file_unavailable"));
        }
        directory = unsafe { File::from_raw_fd(fd) };
    }
    stamp(&directory)?; // Reject devices, FIFO, directories and oversized files before any content read.
    Ok(directory)
}

#[cfg(windows)]
pub(super) fn open(root: &Path, relative: &str) -> Result<File, ApiError> {
    use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::*;
    let parts = components(relative)?;
    // This first profile is local-volume only; do not silently open a network share.
    if !matches!(root.components().next(), Some(std::path::Component::Prefix(p))
        if matches!(p.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
    {
        return Err(rejected("resource_file_path_invalid"));
    }
    let mut path = root.to_path_buf();
    for part in parts {
        path.push(part);
        let meta =
            std::fs::symlink_metadata(&path).map_err(|_| rejected("resource_file_unavailable"))?;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(rejected("resource_file_path_invalid"));
        }
    }
    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(&path)
        .map_err(|_| rejected("resource_file_unavailable"))?;
    let mut buffer = vec![0u16; 32768];
    let length = unsafe {
        GetFinalPathNameByHandleW(
            file.as_raw_handle(),
            buffer.as_mut_ptr(),
            buffer.len() as u32,
            0,
        )
    } as usize;
    if length == 0 || length >= buffer.len() {
        return Err(rejected("resource_file_unavailable"));
    }
    let resolved = PathBuf::from(
        String::from_utf16(&buffer[..length])
            .map_err(|_| rejected("resource_file_path_invalid"))?,
    );
    // Validate the object actually opened, not merely the earlier path walk.
    if !resolved.starts_with(root) {
        return Err(rejected("resource_file_path_invalid"));
    }
    stamp(&file)?;
    Ok(file)
}

pub(super) fn stamp(file: &File) -> Result<(String, usize), ApiError> {
    let meta = file
        .metadata()
        .map_err(|_| rejected("resource_file_unavailable"))?;
    if !meta.is_file() {
        return Err(rejected("resource_file_not_regular"));
    }
    if meta.len() > MAX_BYTES as u64 {
        return Err(rejected("resource_budget_exceeded"));
    }
    #[cfg(windows)]
    let identity = {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::*;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(rejected("resource_file_path_invalid"));
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
            return Err(rejected("resource_file_unavailable"));
        }
        format!(
            "{}:{}:{}:{}:{}:{}",
            info.dwVolumeSerialNumber,
            info.nFileIndexHigh,
            info.nFileIndexLow,
            meta.creation_time(),
            meta.last_write_time(),
            meta.file_size()
        )
    };
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        format!(
            "{}:{}:{}:{}:{}:{}:{}",
            meta.dev(),
            meta.ino(),
            meta.len(),
            meta.mtime(),
            meta.mtime_nsec(),
            meta.ctime(),
            meta.ctime_nsec()
        )
    };
    Ok((sha256_hex(identity.as_bytes()), meta.len() as usize))
}

pub(super) fn snapshot(root: &Path, relative: &str, expected: &str) -> Result<Vec<u8>, ApiError> {
    let mut file = open(root, relative)?;
    let (before, length) = stamp(&file)?;
    if before != expected {
        return Err(rejected("resource_file_changed"));
    }
    let mut bytes = Vec::with_capacity(length);
    Read::by_ref(&mut file)
        .take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| rejected("resource_file_unavailable"))?;
    if bytes.len() != length || stamp(&file)?.0 != before {
        return Err(rejected("resource_file_changed"));
    }
    Ok(bytes)
}

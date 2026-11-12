//! Windows access to originals under a root approved by the user.
use super::worker;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::{OsStr, OsString},
    fmt, fs, io,
    os::windows::{
        ffi::OsStringExt,
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Component, Path, PathBuf, Prefix},
};
use windows_sys::Win32::{
    Foundation::{
        ERROR_DEVICE_NOT_CONNECTED, ERROR_DEV_NOT_EXIST, ERROR_INVALID_DRIVE, ERROR_NOT_READY,
    },
    Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandleEx, GetFinalPathNameByHandleW,
        FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
        FILE_FLAG_OPEN_NO_RECALL, FILE_FLAG_OPEN_REPARSE_POINT, FILE_ID_INFO, FILE_SHARE_READ,
        FILE_SHARE_WRITE, VOLUME_NAME_GUID,
    },
};

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Fault {
    InvalidPath,
    InvalidFile,
    Offline,
    Missing,
    Replaced,
    ContentChanged,
    Unavailable,
}

impl fmt::Display for Fault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidPath => "reference_path_rejected",
            Self::InvalidFile => "reference_file_rejected",
            Self::Offline => "reference_volume_offline",
            Self::Missing => "reference_source_missing",
            Self::Replaced => "reference_identity_changed",
            Self::ContentChanged => "reference_content_changed",
            Self::Unavailable => "reference_source_unavailable",
        })
    }
}

impl std::error::Error for Fault {}

type Result<T> = std::result::Result<T, Fault>;

fn io_fault(error: io::Error) -> Fault {
    match error.raw_os_error().map(|value| value as u32) {
        Some(
            ERROR_NOT_READY
            | ERROR_INVALID_DRIVE
            | ERROR_DEV_NOT_EXIST
            | ERROR_DEVICE_NOT_CONNECTED,
        ) => Fault::Offline,
        _ if error.kind() == io::ErrorKind::NotFound => Fault::Missing,
        _ => Fault::Unavailable,
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
pub(super) struct Identity {
    volume: u64,
    file: [u8; 16],
    created: u64,
}

impl Identity {
    pub(super) fn has_file_id(&self) -> bool {
        self.file != [0; 16]
    }
}

pub(super) fn identity(file: &fs::File, metadata: &fs::Metadata) -> Result<Identity> {
    let mut info = FILE_ID_INFO::default();
    // The buffer is the FILE_ID_INFO structure required by FileIdInfo.
    if unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            FileIdInfo,
            (&raw mut info).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    } == 0
    {
        return Err(io_fault(io::Error::last_os_error()));
    }
    Ok(Identity {
        volume: info.VolumeSerialNumber,
        file: info.FileId.Identifier,
        created: metadata.creation_time(),
    })
}

fn final_path(file: &fs::File) -> Result<PathBuf> {
    let mut buffer = vec![0u16; 512];
    // Use a local volume GUID so changing drive-letter mappings cannot redirect subsequent opens.
    loop {
        let size = unsafe {
            GetFinalPathNameByHandleW(
                file.as_raw_handle(),
                buffer.as_mut_ptr(),
                buffer.len() as u32,
                VOLUME_NAME_GUID,
            )
        } as usize;
        if size == 0 {
            return Err(io_fault(io::Error::last_os_error()));
        }
        if size < buffer.len() {
            return Ok(PathBuf::from(OsString::from_wide(&buffer[..size])));
        }
        if size >= 32768 {
            return Err(Fault::InvalidPath);
        }
        buffer.resize(size + 1, 0);
    }
}

fn component(part: Component<'_>) -> Result<&OsStr> {
    let Component::Normal(name) = part else {
        return Err(Fault::InvalidPath);
    };
    let text = name.to_str().ok_or(Fault::InvalidPath)?;
    if text.ends_with([' ', '.'])
        || text
            .chars()
            .any(|ch| ch.is_control() || ":/\\*?\"<>|".contains(ch))
    {
        return Err(Fault::InvalidPath);
    }
    Ok(name)
}

fn open(path: &Path, directory: bool) -> Result<(fs::File, fs::Metadata)> {
    let mut options = fs::OpenOptions::new();
    options
        .read(true)
        .share_mode(if directory {
            FILE_SHARE_READ | FILE_SHARE_WRITE
        } else {
            FILE_SHARE_READ
        })
        .custom_flags(
            FILE_FLAG_OPEN_REPARSE_POINT
                | FILE_FLAG_OPEN_NO_RECALL
                | if directory {
                    FILE_FLAG_BACKUP_SEMANTICS
                } else {
                    0
                },
        );
    let handle = options.open(path).map_err(io_fault)?;
    let metadata = handle.metadata().map_err(io_fault)?;
    if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(Fault::InvalidPath);
    }
    if metadata.file_attributes() & FILE_ATTRIBUTE_OFFLINE != 0 {
        return Err(Fault::Offline);
    }
    if (directory && !metadata.is_dir()) || (!directory && !metadata.is_file()) {
        return Err(Fault::InvalidFile);
    }
    Ok((handle, metadata))
}

struct DirectoryChain {
    path: PathBuf,
    handles: Vec<fs::File>,
}

impl DirectoryChain {
    fn hold(path: &Path) -> Result<Self> {
        let mut components = path.components();
        let Some(Component::Prefix(prefix)) = components.next() else {
            return Err(Fault::InvalidPath);
        };
        let accepted = match prefix.kind() {
            Prefix::Disk(_) | Prefix::VerbatimDisk(_) => true,
            Prefix::Verbatim(volume) => volume
                .to_str()
                .and_then(|value| value.strip_prefix("Volume{"))
                .and_then(|value| value.strip_suffix('}'))
                .is_some_and(|value| uuid::Uuid::parse_str(value).is_ok()),
            _ => false,
        };
        if !accepted || components.next() != Some(Component::RootDir) {
            return Err(Fault::InvalidPath);
        }
        let parts = components.map(component).collect::<Result<Vec<_>>>()?;
        let mut anchor = prefix.as_os_str().to_os_string();
        anchor.push("\\");
        let (handle, _) = open(Path::new(&anchor), true).map_err(|error| match error {
            Fault::Missing => Fault::Offline,
            error => error,
        })?;
        let mut chain = Self {
            path: final_path(&handle)?,
            handles: vec![handle],
        };
        for name in parts {
            chain.descend(name)?;
        }
        Ok(chain)
    }

    fn descend(&mut self, name: &OsStr) -> Result<()> {
        let (handle, _) = open(&self.path.join(name), true)?;
        let actual = final_path(&handle)?;
        if actual.parent() != Some(self.path.as_path()) {
            return Err(Fault::Replaced);
        }
        self.path = actual;
        // Every already-verified ancestor stays open without delete sharing.
        self.handles.push(handle);
        Ok(())
    }

    fn identity(&self) -> Result<Identity> {
        let handle = self.handles.last().ok_or(Fault::Unavailable)?;
        identity(handle, &handle.metadata().map_err(io_fault)?)
    }
}

/// Constructed from an explicitly selected directory. Catalog data carries no grant.
#[derive(Deserialize, Serialize)]
pub(super) struct Root {
    path: PathBuf,
    identity: Identity,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
pub(super) struct Fingerprint {
    identity: Identity,
    pub(super) sha256: String,
}

impl Root {
    pub(super) fn approve(picked: &Path) -> Result<Self> {
        let chain = DirectoryChain::hold(picked)?;
        let identity = chain.identity()?;
        Ok(Self {
            path: chain.path,
            identity,
        })
    }

    pub(super) fn read(
        &self,
        relative: &Path,
        expected: Option<&Fingerprint>,
    ) -> Result<(Vec<u8>, Fingerprint)> {
        let names = relative
            .components()
            .map(component)
            .collect::<Result<Vec<_>>>()?;
        let (leaf, parents) = names.split_last().ok_or(Fault::InvalidPath)?;
        let mut chain = DirectoryChain::hold(&self.path)?;
        if chain.path != self.path || chain.identity()? != self.identity {
            return Err(Fault::Replaced);
        }
        for name in parents {
            chain.descend(name)?;
        }
        let (file, metadata) = open(&chain.path.join(leaf), false)?;
        if final_path(&file)?.parent() != Some(chain.path.as_path()) {
            return Err(Fault::Replaced);
        }
        if metadata.len() > worker::INPUT {
            return Err(Fault::InvalidFile);
        }
        let identity = identity(&file, &metadata)?;
        if expected.is_some_and(|previous| previous.identity != identity) {
            return Err(Fault::Replaced);
        }
        let bytes = worker::read_input_file(file).map_err(|error| {
            error
                .downcast::<io::Error>()
                .map_or(Fault::InvalidFile, |error| io_fault(*error))
        })?;
        let sha256 = format!("{:x}", Sha256::digest(&bytes));
        if expected.is_some_and(|previous| previous.sha256 != sha256) {
            return Err(Fault::ContentChanged);
        }
        Ok((bytes, Fingerprint { identity, sha256 }))
    }
}

#[cfg(test)]
#[path = "reference_source_tests.rs"]
mod tests;

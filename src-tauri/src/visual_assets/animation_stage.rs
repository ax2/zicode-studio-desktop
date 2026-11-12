//! Recover only directories durably claimed by an animation task.
use super::{backup_destination, reference_source, Result};
use std::{
    fs::{self, File, OpenOptions},
    io,
    mem::size_of,
    os::windows::{
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Path, PathBuf},
};
use uuid::Uuid;
use windows_sys::Win32::Storage::FileSystem::{
    FileDispositionInfo, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_DISPOSITION_INFO, FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    FILE_READ_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

const MAX_ENTRIES: usize = 280;

pub(super) fn path(parent: &Path, nonce: Uuid) -> PathBuf {
    parent.join(format!(".zicode-animation-{nonce}"))
}

pub(super) fn hold(path: &Path) -> Result<Option<(File, reference_source::Identity)>> {
    let directory = open(path, false)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("animation staging directory changed".into());
    }
    // Filesystems that cannot report a stable identity retain ordinary temporary cleanup.
    Ok(reference_source::identity(&directory, &metadata)
        .ok()
        .filter(reference_source::Identity::has_file_id)
        .map(|identity| (directory, identity)))
}

pub(super) fn remove(
    parent: &Path,
    nonce: Uuid,
    identity: &reference_source::Identity,
) -> Result<()> {
    let (resolved, _ancestors) = backup_destination::hold(parent)?;
    if resolved != parent {
        return Err("animation staging parent changed".into());
    }
    let path = path(parent, nonce);
    let directory = match open(&path, true) {
        Ok(directory) => directory,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let metadata = directory.metadata()?;
    if !metadata.is_dir()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        || &reference_source::identity(&directory, &metadata)? != identity
    {
        return Err("animation staging directory identity changed".into());
    }
    // Open every expected entry before making any changes. A renamed, linked, or unknown
    // entry prevents cleanup. Handles pin the entire tree through the bottom-up deletion.
    let mut entries = Vec::new();
    inventory(&path, Kind::Stage, &mut entries)?;
    for entry in entries {
        delete(entry)?;
    }
    delete(directory)
}

fn open(path: &Path, delete: bool) -> io::Result<File> {
    OpenOptions::new()
        .access_mode(FILE_READ_ATTRIBUTES | if delete { DELETE } else { 0 })
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

fn delete(file: File) -> Result<()> {
    let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
    // The same open handle was checked before choosing the file for deletion.
    if unsafe {
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileDispositionInfo,
            (&raw const disposition).cast(),
            size_of::<FILE_DISPOSITION_INFO>() as u32,
        )
    } == 0
    {
        return Err(io::Error::last_os_error().into());
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum Kind {
    Stage,
    Project,
    Slot,
    Versions,
    Frames,
    File,
}

impl Kind {
    fn child(self, name: &str) -> Option<Self> {
        match (self, name) {
            (Self::Stage, "project") => Some(Self::Project),
            (Self::Stage, "slot") => Some(Self::Slot),
            (Self::Slot, "versions") => Some(Self::Versions),
            (Self::Project, "frames") => Some(Self::Frames),
            (Self::Stage, "atlas.input" | "recipe.json" | "clip.tscn")
            | (
                Self::Project,
                "project.godot" | "preview.tscn" | "clip.tscn" | "clip.tres" | "manifest.json",
            )
            | (Self::Slot, ".zicode-animation.lock" | "clip.tscn") => Some(Self::File),
            (Self::Stage, _) if input_name(name) => Some(Self::File),
            (Self::Versions, _)
                if name.len() == 64 && name.bytes().all(|b| b.is_ascii_hexdigit()) =>
            {
                Some(Self::Project)
            }
            (Self::Frames, _) if frame_name(name) => Some(Self::File),
            _ => None,
        }
    }
}

fn input_name(name: &str) -> bool {
    name.strip_prefix("frame-")
        .and_then(|name| name.strip_suffix(".input"))
        .and_then(|name| name.split_once('-'))
        .is_some_and(|(asset, revision)| {
            [asset, revision].iter().all(|value| {
                value
                    .parse::<i64>()
                    .is_ok_and(|id| id > 0 && id.to_string() == *value)
            })
        })
}

fn frame_name(name: &str) -> bool {
    name.strip_prefix("frame-")
        .and_then(|name| name.strip_suffix(".png"))
        .is_some_and(|index| {
            index.len() == 3
                && index
                    .parse::<usize>()
                    .is_ok_and(|value| (1..=128).contains(&value) && format!("{value:03}") == index)
        })
}

fn inventory(path: &Path, kind: Kind, entries: &mut Vec<File>) -> Result<()> {
    for entry in fs::read_dir(path)? {
        if entries.len() >= MAX_ENTRIES {
            return Err("animation staging inventory exceeds its limit".into());
        }
        let entry = entry?;
        let name = entry.file_name();
        let kind = name
            .to_str()
            .and_then(|name| kind.child(name))
            .ok_or("unexpected animation staging entry")?;
        let path = entry.path();
        let file = open(&path, true)?;
        let metadata = file.metadata()?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
            || (matches!(kind, Kind::File) && !metadata.is_file())
            || (!matches!(kind, Kind::File) && !metadata.is_dir())
        {
            return Err("animation staging entry changed".into());
        }
        if metadata.is_dir() {
            inventory(&path, kind, entries)?;
        }
        entries.push(file);
        if entries.len() > MAX_ENTRIES {
            return Err("animation staging inventory exceeds its limit".into());
        }
    }
    Ok(())
}

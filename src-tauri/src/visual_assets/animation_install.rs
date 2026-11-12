//! Publish a stable Godot scene backed by immutable, content-addressed versions.
use super::{
    animation::{self, Output},
    animation_export::{self, Stage},
    backup_destination, snapshot, worker, Result,
};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    mem::{offset_of, size_of},
    os::windows::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
        io::AsRawHandle,
    },
    path::{Path, PathBuf},
    time::Duration,
};
use windows_sys::Win32::Storage::FileSystem::{
    FileRenameInfoEx, SetFileInformationByHandle, DELETE, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_RENAME_INFO, FILE_SHARE_DELETE, FILE_SHARE_READ,
};

const LOCK: &str = ".zicode-animation.lock";
const LOCK_MARKER: &[u8] = b"ZiCode Godot animation v1\n";
const POINTER: &str = "clip.tscn";
const POINTER_PREFIX: &str =
    "[gd_scene load_steps=2 format=3]\n\n[ext_resource type=\"PackedScene\" path=\"versions/";
const POINTER_SUFFIX: &str =
    "/clip.tscn\" id=\"1\"]\n\n[node name=\"Clip\" instance=ExtResource(\"1\")]\n";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Plan {
    pub(super) destination: PathBuf,
    pub(super) previous: Option<String>,
    resource_path: String,
}

pub(super) fn validate_name(name: &str) -> Result<()> {
    let alphanumeric = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    if name.len() > 48
        || !name.bytes().next().is_some_and(alphanumeric)
        || !name.bytes().last().is_some_and(alphanumeric)
        || !name.bytes().all(|byte| alphanumeric(byte) || byte == b'-')
    {
        return Err("invalid Godot animation name".into());
    }
    Ok(())
}

pub(super) fn plan(project: &Path, name: &str) -> Result<Plan> {
    validate_name(name)?;
    check_project(project)?;
    let folder = format!("zicode-animation-{name}");
    let destination = project.join(&folder);
    let previous = match fs::symlink_metadata(&destination) {
        Ok(_) => Some(Installed::open(&destination)?.digest),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error.into()),
    };
    Ok(Plan {
        destination,
        previous,
        resource_path: format!("res://{folder}/{POINTER}"),
    })
}

fn check_project(project: &Path) -> Result<()> {
    let mut settings = String::new();
    worker::open_input(&project.join("project.godot"))?
        .take(256 * 1024)
        .read_to_string(&mut settings)?;
    if !settings.lines().any(|line| {
        line.trim_start_matches('\u{feff}')
            .split_once('=')
            .is_some_and(|(key, value)| key.trim() == "config_version" && value.trim() == "5")
    }) {
        return Err("select a Godot 4 project directory".into());
    }
    Ok(())
}

fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

struct Installed {
    digest: String,
    _directories: Vec<File>,
    _lock: File,
    _pointer: File,
}

impl Installed {
    fn open(destination: &Path) -> Result<Self> {
        let (resolved, mut directories) = backup_destination::hold(destination)?;
        let versions = destination.join("versions");
        let (resolved_versions, version_handles) = backup_destination::hold(&versions)?;
        if resolved != destination || resolved_versions != versions {
            return Err("Godot animation directories changed".into());
        }
        directories.extend(version_handles);
        let mut lock = regular_file(&destination.join(LOCK), 0)?;
        let mut marker = Vec::new();
        (&mut lock)
            .take(LOCK_MARKER.len() as u64 + 1)
            .read_to_end(&mut marker)?;
        if marker != LOCK_MARKER {
            return Err("Godot animation slot is not managed by Studio".into());
        }
        let mut pointer = regular_file(
            &destination.join(POINTER),
            FILE_SHARE_READ | FILE_SHARE_DELETE,
        )?;
        let mut scene = String::new();
        (&mut pointer).take(512).read_to_string(&mut scene)?;
        let digest = scene
            .strip_prefix(POINTER_PREFIX)
            .and_then(|rest| rest.strip_suffix(POINTER_SUFFIX))
            .filter(|value| is_digest(value))
            .ok_or("managed Godot scene was edited")?;
        animation_export::verify_asset(&versions.join(digest), digest)?;
        Ok(Self {
            digest: digest.into(),
            _directories: directories,
            _lock: lock,
            _pointer: pointer,
        })
    }
}

fn regular_file(path: &Path, share: u32) -> Result<File> {
    let file = OpenOptions::new()
        .read(true)
        .share_mode(share)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("expected a regular managed file".into());
    }
    Ok(file)
}

pub(super) fn verify(destination: &Path, digest: &str) -> Result<()> {
    if Installed::open(destination)?.digest != digest {
        return Err("a different Godot animation version is installed".into());
    }
    Ok(())
}

pub(super) fn install(
    destination: &Path,
    previous: Option<&str>,
    worker: (&str, Duration),
    checkpoint: &impl Fn(&str) -> Result<()>,
    before_publish: &impl Fn(&str) -> Result<()>,
    prepare: impl FnOnce(&Path) -> Result<()>,
    create_stage: impl FnOnce(PathBuf) -> Result<Stage>,
) -> Result<()> {
    let parent = destination
        .parent()
        .ok_or("missing Godot project directory")?;
    let (resolved, _project_handles) = backup_destination::hold(parent)?;
    if resolved != parent {
        return Err("Godot project directory changed".into());
    }
    check_project(parent)?;
    let stage = create_stage(resolved)?;
    prepare(&stage.path)?;
    checkpoint("animation-rendering")?;
    stage.run(worker.0, worker.1, Output::Asset, &|| {
        checkpoint("animation-rendering")
    })?;
    let asset = stage.path.join("project");
    let digest = snapshot::hash(&asset.join("manifest.json"))?;
    animation_export::verify_asset(&asset, &digest)?;
    let pointer = format!("{POINTER_PREFIX}{digest}{POINTER_SUFFIX}");

    if let Some(previous) = previous {
        // Pin the old scene against writes and serialize Studio updates until the switch.
        let installed = Installed::open(destination)?;
        if installed.digest != previous {
            return Err("Godot animation changed after confirmation".into());
        }
        let version = destination.join("versions").join(&digest);
        if version.try_exists()? {
            animation_export::verify_asset(&version, &digest)?;
        } else {
            animation_export::publish(&asset, &version)?;
        }
        switch_pointer(&stage, destination, &installed, &digest, before_publish)?;
    } else {
        let slot = stage.path.join("slot");
        let versions = slot.join("versions");
        fs::create_dir_all(&versions)?;
        animation_export::publish(&asset, &versions.join(&digest))?;
        animation::write_new(&slot.join(LOCK), LOCK_MARKER)?;
        animation::write_new(&slot.join(POINTER), pointer.as_bytes())?;
        before_publish(&digest)?;
        animation_export::publish(&slot, destination)?;
    }
    Ok(())
}

pub(super) fn resume(
    destination: &Path,
    previous: &str,
    digest: &str,
    before_publish: &impl Fn(&str) -> Result<()>,
    create_stage: impl FnOnce(PathBuf) -> Result<Stage>,
) -> Result<bool> {
    if !is_digest(digest) {
        return Err("invalid saved Godot animation digest".into());
    }
    let parent = destination
        .parent()
        .ok_or("missing Godot project directory")?;
    let (resolved, _project_handles) = backup_destination::hold(parent)?;
    if resolved != parent {
        return Err("Godot project directory changed".into());
    }
    check_project(parent)?;
    let installed = Installed::open(destination)?;
    if installed.digest != previous {
        return Err("Godot animation changed after confirmation".into());
    }
    let version = destination.join("versions").join(digest);
    match fs::symlink_metadata(&version) {
        Ok(_) => animation_export::verify_asset(&version, digest)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    }
    let stage = create_stage(resolved)?;
    switch_pointer(&stage, destination, &installed, digest, before_publish)?;
    Ok(true)
}

fn switch_pointer(
    stage: &Stage,
    destination: &Path,
    installed: &Installed,
    digest: &str,
    before_publish: &impl Fn(&str) -> Result<()>,
) -> Result<()> {
    let replacement = stage.path.join(POINTER);
    let pointer = format!("{POINTER_PREFIX}{digest}{POINTER_SUFFIX}");
    animation::write_new(&replacement, pointer.as_bytes())?;
    before_publish(digest)?;
    if digest != installed.digest {
        replace(&replacement, &destination.join(POINTER))?;
    }
    Ok(())
}

fn replace(source: &Path, destination: &Path) -> Result<()> {
    let file = OpenOptions::new()
        .access_mode(DELETE)
        .share_mode(FILE_SHARE_READ)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(source)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("expected a regular staged scene".into());
    }
    let name: Vec<u16> = destination.as_os_str().encode_wide().collect();
    let name_bytes = name.len() * size_of::<u16>();
    let name_offset = offset_of!(FILE_RENAME_INFO, FileName);
    let size = name_offset + name_bytes;
    let mut buffer = vec![0_u64; size.div_ceil(size_of::<u64>())];
    let info = buffer.as_mut_ptr().cast::<FILE_RENAME_INFO>();
    // FileRenameInfoEx allows the old read handle to remain valid after the atomic switch.
    const REPLACE_WITH_OPEN_HANDLES: u32 = 1 | 2;
    let renamed = unsafe {
        (*info).Anonymous.Flags = REPLACE_WITH_OPEN_HANDLES;
        (*info).FileNameLength = u32::try_from(name_bytes)?;
        let filename = buffer
            .as_mut_ptr()
            .cast::<u8>()
            .add(name_offset)
            .cast::<u16>();
        std::ptr::copy_nonoverlapping(name.as_ptr(), filename, name.len());
        SetFileInformationByHandle(
            file.as_raw_handle(),
            FileRenameInfoEx,
            info.cast(),
            u32::try_from(size)?,
        )
    };
    if renamed == 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

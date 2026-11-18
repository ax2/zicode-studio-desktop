use super::{Config, Result};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use fs2::FileExt;
use std::{
    fs,
    io::{Read, Write},
    path::Path,
};

const LIMIT: usize = 16 * 1024;
pub(super) struct Storage(Dir);
fn failure<T>(_: T) -> &'static str {
    "notes_sync_settings_unavailable"
}

fn child(parent: &Dir, name: &str, create: bool) -> Result<Option<Dir>> {
    match parent.symlink_metadata(name) {
        Ok(meta) if !meta.is_dir() || meta.file_type().is_symlink() => {
            return Err("notes_sync_settings_invalid")
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            parent.create_dir(name).map_err(failure)?;
        }
        Err(_) => return Err("notes_sync_settings_unavailable"),
    }
    parent.open_dir(name).map(Some).map_err(failure)
}

impl Storage {
    pub(super) fn open(root: &Path, key: &str, create: bool) -> Result<Option<Self>> {
        if !root.exists() && !create {
            return Ok(None);
        }
        if create {
            fs::create_dir_all(root).map_err(failure)?;
        }
        let metadata = fs::symlink_metadata(root).map_err(failure)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("notes_sync_settings_invalid");
        }
        let root = Dir::open_ambient_dir(root, ambient_authority()).map_err(failure)?;
        let Some(folder) = child(&root, "notes-sync", create)? else {
            return Ok(None);
        };
        Ok(child(&folder, key, create)?.map(Self))
    }
    fn read(&self, name: &str) -> Result<Option<Vec<u8>>> {
        let meta = match self.0.symlink_metadata(name) {
            Ok(meta) => meta,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("notes_sync_settings_unavailable"),
        };
        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > LIMIT as u64 {
            return Err("notes_sync_settings_invalid");
        }
        let file = self.0.open(name).map_err(failure)?;
        let mut bytes = Vec::new();
        file.take(LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(failure)?;
        if bytes.len() > LIMIT {
            return Err("notes_sync_settings_invalid");
        }
        Ok(Some(bytes))
    }
    pub(super) fn read_current(&self) -> Result<Option<Vec<u8>>> {
        self.read("current.json")
    }
    pub(super) fn lock(&self) -> Result<fs::File> {
        if self
            .0
            .symlink_metadata("settings.lock")
            .is_ok_and(|meta| !meta.is_file() || meta.file_type().is_symlink())
        {
            return Err("notes_sync_settings_invalid");
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        let file = self
            .0
            .open_with("settings.lock", &options)
            .map_err(failure)?
            .into_std();
        file.try_lock_exclusive()
            .map_err(|_| "notes_sync_settings_busy")?;
        Ok(file)
    }
    fn new_file(&self, name: &str, bytes: &[u8]) -> Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = self.0.open_with(name, &options).map_err(failure)?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(failure)
    }
    pub(super) fn publish(&self, next: &Config, before: Option<&Config>) -> Result<()> {
        if let Some(before) = before {
            let name = format!("{}.json", before.revision);
            let bytes = serde_json::to_vec(before).map_err(failure)?;
            if let Some(existing) = self.read(&name)? {
                if existing != bytes {
                    return Err("notes_sync_settings_invalid");
                }
            } else {
                self.new_file(&name, &bytes)?;
            }
        }
        let bytes = serde_json::to_vec(next).map_err(failure)?;
        let temporary = format!("{}.tmp", next.revision);
        self.new_file(&temporary, &bytes)?;
        let result = self
            .0
            .rename(&temporary, &self.0, "current.json")
            .map_err(failure);
        if result.is_err() {
            let _ = self.0.remove_file(&temporary);
        }
        result
    }
}

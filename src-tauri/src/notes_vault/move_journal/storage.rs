//! Capability-relative, bounded I/O for a single note move journal.
use super::*;
use cap_std::{ambient_authority, fs::Dir};
use std::io::Read;
use std::path::Component;

const FILE_LIMIT: usize = 16 * 1024 * 1024;

pub(super) struct Storage(Dir);

impl Storage {
    pub fn open(root: &Path) -> Result<Self, NotesError> {
        let metadata = fs::symlink_metadata(root).map_err(|_| recovery_error())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(recovery_error());
        }
        Dir::open_ambient_dir(root, ambient_authority())
            .map(Self)
            .map_err(|_| recovery_error())
    }

    pub fn exists(&self, path: &Path) -> Result<bool, NotesError> {
        let mut current = PathBuf::new();
        for part in path.components() {
            let Component::Normal(name) = part else {
                return Err(recovery_error());
            };
            current.push(name);
            match self.0.symlink_metadata(&current) {
                Ok(value) if value.file_type().is_symlink() => return Err(recovery_error()),
                Ok(_) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(_) => return Err(recovery_error()),
            }
        }
        Ok(true)
    }

    pub fn list(&self, path: &Path) -> Result<Vec<String>, NotesError> {
        if !self.exists(path)? {
            return Err(recovery_error());
        }
        let mut result = Vec::new();
        for entry in self.0.read_dir(path).map_err(|_| recovery_error())? {
            result.push(
                entry
                    .map_err(|_| recovery_error())?
                    .file_name()
                    .into_string()
                    .map_err(|_| recovery_error())?,
            );
            if result.len() > 10_000 {
                return Err(recovery_error());
            }
        }
        result.sort();
        Ok(result)
    }

    pub fn read(&self, path: &Path) -> Result<Vec<u8>, NotesError> {
        if !self.exists(path)? {
            return Err(recovery_error());
        }
        let file = self.0.open(path).map_err(|_| recovery_error())?;
        let metadata = file.metadata().map_err(|_| recovery_error())?;
        if !metadata.is_file() || metadata.len() > FILE_LIMIT as u64 {
            return Err(recovery_error());
        }
        let mut bytes = Vec::new();
        file.take(FILE_LIMIT as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| recovery_error())?;
        if bytes.len() > FILE_LIMIT {
            return Err(recovery_error());
        }
        Ok(bytes)
    }

    pub fn mkdir(&self, path: &Path) -> Result<(), NotesError> {
        self.exists(path)?;
        self.0.create_dir_all(path).map_err(|_| recovery_error())
    }

    pub fn write_new(&self, path: &Path, bytes: &[u8]) -> Result<(), NotesError> {
        if bytes.len() > FILE_LIMIT || self.exists(path)? {
            return Err(recovery_error());
        }
        self.mkdir(path.parent().ok_or_else(recovery_error)?)?;
        let mut options = cap_std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        let mut file = self
            .0
            .open_with(path, &options)
            .map_err(|_| recovery_error())?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| recovery_error())
    }

    pub fn rename(&self, from: &Path, to: &Path) -> Result<(), NotesError> {
        if !self.exists(from)? || self.exists(to)? {
            return Err(recovery_error());
        }
        self.mkdir(to.parent().ok_or_else(recovery_error)?)?;
        self.0
            .rename(from, &self.0, to)
            .map_err(|_| recovery_error())
    }

    pub fn hash(&self, path: &Path) -> Result<Option<String>, NotesError> {
        if !self.exists(path)? {
            return Ok(None);
        }
        let mut hasher = Sha256::new();
        self.hash_entry(path, 0, &mut hasher)?;
        Ok(Some(format!("{:x}", hasher.finalize())))
    }

    fn hash_entry(&self, path: &Path, depth: usize, hash: &mut Sha256) -> Result<(), NotesError> {
        if depth > 8 || !self.exists(path)? {
            return Err(recovery_error());
        }
        let metadata = self
            .0
            .symlink_metadata(path)
            .map_err(|_| recovery_error())?;
        if metadata.is_dir() {
            hash.update(b"directory");
            for name in self.list(path)? {
                hash.update((name.len() as u64).to_le_bytes());
                hash.update(name.as_bytes());
                self.hash_entry(&path.join(name), depth + 1, hash)?;
            }
        } else {
            let bytes = self.read(path)?;
            hash.update(b"file");
            hash.update((bytes.len() as u64).to_le_bytes());
            hash.update(bytes);
        }
        Ok(())
    }

    pub fn remove(&self, path: &Path) -> Result<(), NotesError> {
        if !self.exists(path)? {
            return Ok(());
        }
        self.hash(path)?; // Reject links, special files and oversized traversal before deletion.
        let metadata = self
            .0
            .symlink_metadata(path)
            .map_err(|_| recovery_error())?;
        if metadata.is_dir() {
            self.0.remove_dir_all(path)
        } else {
            self.0.remove_file(path)
        }
        .map_err(|_| recovery_error())
    }
}

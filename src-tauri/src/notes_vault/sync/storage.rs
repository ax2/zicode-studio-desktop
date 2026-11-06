use super::*;
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions as CapOptions},
};
use std::io::{Read, Write};
use std::path::Component;

pub(super) struct Storage {
    pub root: PathBuf,
    dir: Dir,
}

impl Storage {
    pub fn open(root: &Path) -> Result<Self, NotesError> {
        let metadata = fs::symlink_metadata(root).map_err(|_| invalid())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(invalid());
        }
        let dir = Dir::open_ambient_dir(root, ambient_authority()).map_err(|_| invalid())?;
        Ok(Self {
            root: root.to_path_buf(),
            dir,
        })
    }

    pub fn exists(&self, path: &Path) -> Result<bool, NotesError> {
        let mut current = PathBuf::new();
        for component in path.components() {
            let Component::Normal(name) = component else {
                return Err(invalid());
            };
            current.push(name);
            match self.dir.symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => return Err(invalid()),
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(_) => return Err(invalid()),
            }
        }
        Ok(true)
    }

    pub fn directory(&self, path: &Path) -> Result<(), NotesError> {
        if !self.exists(path)?
            || !self
                .dir
                .symlink_metadata(if path.as_os_str().is_empty() {
                    Path::new(".")
                } else {
                    path
                })
                .map_err(|_| invalid())?
                .is_dir()
        {
            return Err(invalid());
        }
        Ok(())
    }

    pub fn list(&self, path: &Path) -> Result<Vec<String>, NotesError> {
        self.directory(path)?;
        let mut result = Vec::new();
        for entry in self
            .dir
            .read_dir(if path.as_os_str().is_empty() {
                Path::new(".")
            } else {
                path
            })
            .map_err(|_| invalid())?
        {
            let entry = entry.map_err(|_| invalid())?;
            result.push(entry.file_name().into_string().map_err(|_| invalid())?);
            if result.len() > crate::notes_sync::MAX_RECORDS {
                return Err(invalid());
            }
        }
        result.sort();
        Ok(result)
    }

    pub fn read(&self, path: &Path, limit: usize) -> Result<Vec<u8>, NotesError> {
        if !self.exists(path)? {
            return Err(invalid());
        }
        let file = self.dir.open(path).map_err(|_| invalid())?;
        let metadata = file.metadata().map_err(|_| invalid())?;
        if !metadata.is_file() || metadata.len() > limit as u64 {
            return Err(invalid());
        }
        let mut bytes = Vec::new();
        file.take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| invalid())?;
        if bytes.len() > limit {
            return Err(invalid());
        }
        Ok(bytes)
    }

    pub fn mkdir(&self, path: &Path) -> Result<(), NotesError> {
        self.exists(path)?;
        self.dir.create_dir_all(path).map_err(|_| invalid())?;
        self.directory(path)
    }

    pub fn write_new(&self, path: &Path, bytes: &[u8]) -> Result<(), NotesError> {
        if self.exists(path)? {
            return Err(invalid());
        }
        self.mkdir(path.parent().ok_or_else(invalid)?)?;
        let mut options = CapOptions::new();
        options.write(true).create_new(true);
        let mut file = self.dir.open_with(path, &options).map_err(|_| invalid())?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| invalid())
    }

    pub fn rename(&self, from: &Path, to: &Path) -> Result<(), NotesError> {
        if !self.exists(from)? || self.exists(to)? {
            return Err(recovery_error());
        }
        self.mkdir(to.parent().ok_or_else(invalid)?)?;
        self.dir
            .rename(from, &self.dir, to)
            .map_err(|_| recovery_error())
    }

    pub fn remove_file(&self, path: &Path) -> Result<(), NotesError> {
        self.read(path, crate::notes_sync::MAX_OBJECT_BYTES)?;
        self.dir.remove_file(path).map_err(|_| recovery_error())
    }

    pub fn tree_hash(&self, path: &Path) -> Result<String, NotesError> {
        let mut files = BTreeSet::new();
        let mut hasher = Sha256::new();
        let mut budget = crate::notes_sync::MAX_SNAPSHOT_BYTES * 3;
        self.hash_entry(path, Path::new(""), &mut hasher, &mut files, &mut budget)?;
        Ok(format!("{:x}", hasher.finalize()))
    }

    fn hash_entry(
        &self,
        root: &Path,
        relative: &Path,
        hasher: &mut Sha256,
        files: &mut BTreeSet<PathBuf>,
        budget: &mut usize,
    ) -> Result<(), NotesError> {
        if relative.components().count() > 16 {
            return Err(invalid());
        }
        let path = if relative.as_os_str().is_empty() {
            root.to_path_buf()
        } else {
            root.join(relative)
        };
        if !self.exists(&path)?
            || !files.insert(relative.to_path_buf())
            || files.len() > crate::notes_sync::MAX_RECORDS * 3
        {
            return Err(invalid());
        }
        let metadata = self.dir.symlink_metadata(&path).map_err(|_| invalid())?;
        let name = relative.to_string_lossy().replace('\\', "/");
        hasher.update((name.len() as u64).to_le_bytes());
        hasher.update(name.as_bytes());
        if metadata.is_dir() {
            hasher.update(b"directory");
            for name in self.list(&path)? {
                self.hash_entry(root, &relative.join(name), hasher, files, budget)?;
            }
        } else if metadata.is_file() {
            hasher.update(b"file");
            let bytes = self.read(&path, crate::notes_sync::MAX_OBJECT_BYTES)?;
            *budget = budget.checked_sub(bytes.len()).ok_or_else(invalid)?;
            hasher.update((bytes.len() as u64).to_le_bytes());
            hasher.update(bytes);
        } else {
            return Err(invalid());
        }
        Ok(())
    }

    pub fn remove_tree(&self, path: &Path) -> Result<(), NotesError> {
        // Capability-relative removal only after bounded traversal rejects links.
        self.tree_hash(path)?;
        self.dir.remove_dir_all(path).map_err(|_| recovery_error())
    }
}

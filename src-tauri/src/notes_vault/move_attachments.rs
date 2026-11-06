//! Stage attachments before publishing a moved note. The source remains intact
//! until both the destination note and attachments have been written.
use super::{NotesError, NotesVault, MAX_ATTACHMENT_BYTES};
use std::{fs, io::Write, path::PathBuf};

pub(super) struct MoveAttachments {
    source: PathBuf,
    target: PathBuf,
    files: Vec<String>,
    committed: bool,
}

fn unavailable() -> NotesError {
    NotesError::new("storage_unavailable", "Cannot move the note attachments")
}

impl MoveAttachments {
    pub(super) fn prepare(vault: &NotesVault, source: &str, target: &str, note: &str) -> Result<Option<Self>, NotesError> {
        let source = vault.vault_root(source)?.join("public/attachments").join(note);
        let target = vault.vault_root(target)?.join("public/attachments").join(note);
        if fs::symlink_metadata(&target).is_ok() {
            return Err(NotesError::new("conflict", "Attachments already exist in the target notebook"));
        }
        let metadata = match fs::symlink_metadata(&source) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(unavailable()),
        };
        if !metadata.is_dir() || metadata.file_type().is_symlink() { return Err(unavailable()); }
        fs::create_dir_all(target.parent().ok_or_else(unavailable)?).map_err(|_| unavailable())?;
        fs::create_dir(&target).map_err(|_| unavailable())?;
        let mut stage = Self { source, target, files: Vec::new(), committed: false };
        for entry in fs::read_dir(&stage.source).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            let name = entry.file_name().into_string().map_err(|_| unavailable())?;
            super::validate_attachment_id(&name)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(|_| unavailable())?;
            if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > MAX_ATTACHMENT_BYTES as u64 { return Err(unavailable()); }
            let data = fs::read(entry.path()).map_err(|_| unavailable())?;
            let mut destination = fs::OpenOptions::new().write(true).create_new(true)
                .open(stage.target.join(&name)).map_err(|_| unavailable())?;
            stage.files.push(name);
            destination.write_all(&data).and_then(|()| destination.sync_all()).map_err(|_| unavailable())?;
        }
        Ok(Some(stage))
    }

    pub(super) fn retain(mut self) { self.committed = true; }

    pub(super) fn commit(mut self) {
        self.committed = true;
        // Cleanup cannot invalidate the successful move. Keep any changed or
        // inaccessible source files rather than risking unrelated data.
        for name in &self.files {
            let source = self.source.join(name);
            if let (Ok(old), Ok(new)) = (fs::read(&source), fs::read(self.target.join(name))) {
                if old == new { let _ = fs::remove_file(source); }
            }
        }
        let _ = fs::remove_dir(&self.source);
    }
}

impl Drop for MoveAttachments {
    fn drop(&mut self) {
        if !self.committed {
            for name in &self.files { let _ = fs::remove_file(self.target.join(name)); }
            let _ = fs::remove_dir(&self.target);
        }
    }
}

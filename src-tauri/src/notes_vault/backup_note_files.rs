//! Strict discovery for archival export; ordinary UI scans remain tolerant.
use super::{read_note_file, validate_opaque_id, NoteDocument, NotesError, MAX_NOTES};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub(super) fn read(
    directory: &Path,
    notebook: &str,
    missing_is_empty: bool,
) -> Result<Vec<(PathBuf, NoteDocument)>, NotesError> {
    let unavailable =
        || NotesError::new("storage_unavailable", "Cannot read Notes files for backup");
    let metadata = match fs::symlink_metadata(directory) {
        Ok(metadata) => metadata,
        Err(error) if missing_is_empty && error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Vec::new())
        }
        Err(_) => return Err(unavailable()),
    };
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(unavailable());
    }
    let mut documents = Vec::new();
    for entry in fs::read_dir(directory).map_err(|_| unavailable())? {
        let entry = entry.map_err(|_| unavailable())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("md") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|value| value.to_str()) else {
            continue;
        };
        if validate_opaque_id(id).is_err() {
            continue;
        }
        let kind = entry.file_type().map_err(|_| unavailable())?;
        if !kind.is_file() || kind.is_symlink() {
            continue;
        }
        if documents.len() >= MAX_NOTES {
            return Err(NotesError::new(
                "quota_exceeded",
                "Notes backup contains too many notes",
            ));
        }
        let document = read_note_file(&path, notebook)?;
        documents.push((path, document));
    }
    Ok(documents)
}

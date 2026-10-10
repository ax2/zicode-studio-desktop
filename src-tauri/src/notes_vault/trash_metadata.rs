use super::{atomic_json_write, now_iso, NotesError};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{fs, io::ErrorKind, path::Path};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TrashMetadata {
    schema_version: u32,
    pub deleted_at: String,
    pub deletion_time_known: bool,
    pub trash_token: String,
}

fn invalid() -> NotesError {
    NotesError::new(
        "storage_unavailable",
        "Cannot read Notes trash metadata safely",
    )
}

impl TrashMetadata {
    pub fn expired(&self, days: u64) -> bool {
        DateTime::parse_from_rfc3339(&self.deleted_at)
            .ok()
            .is_some_and(|date| {
                let age = Utc::now().signed_duration_since(date).num_seconds();
                age >= 0 && age as u64 >= days.saturating_mul(86_400)
            })
    }
}

pub(super) fn write(
    note_path: &Path,
    deleted_at: String,
    deletion_time_known: bool,
) -> Result<TrashMetadata, NotesError> {
    let path = note_path.with_extension("trash.json");
    match fs::symlink_metadata(&path) {
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => return Err(invalid()),
        Err(error) if error.kind() != ErrorKind::NotFound => return Err(invalid()),
        _ => {}
    }
    let metadata = TrashMetadata {
        schema_version: 1,
        deleted_at,
        deletion_time_known,
        trash_token: uuid::Uuid::new_v4().to_string(),
    };
    atomic_json_write(&path, &metadata)?;
    Ok(metadata)
}

pub(super) fn read_or_initialize(note_path: &Path) -> Result<TrashMetadata, NotesError> {
    let path = note_path.with_extension("trash.json");
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == ErrorKind::NotFound => {
            // Original deletion time is unknown; never infer it from content mtime.
            return write(note_path, now_iso(), false);
        }
        Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() && meta.len() <= 4096 => {}
        _ => return Err(invalid()),
    }
    let metadata: TrashMetadata =
        serde_json::from_slice(&fs::read(path).map_err(|_| invalid())?).map_err(|_| invalid())?;
    if metadata.schema_version != 1
        || DateTime::parse_from_rfc3339(&metadata.deleted_at).is_err()
        || uuid::Uuid::parse_str(&metadata.trash_token).is_err()
    {
        return Err(invalid());
    }
    Ok(metadata)
}

pub(super) fn move_to_trash(source: &Path, target: &Path) -> Result<(), NotesError> {
    match fs::symlink_metadata(target) {
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        _ => {
            return Err(NotesError::new(
                "conflict",
                "A note with this ID is already in the trash",
            ));
        }
    }
    // Persist the new event first. A failed rename leaves the active note intact;
    // the next deletion replaces the unused stamp with a fresh event.
    write(target, now_iso(), true)?;
    fs::rename(source, target)
        .map_err(|_| NotesError::new("storage_unavailable", "Cannot move the note to trash"))
}

pub(super) fn remove(note_path: &Path) {
    // A stale stamp is harmless and is replaced on the next deletion.
    let _ = fs::remove_file(note_path.with_extension("trash.json"));
}

//! Prepare the exact file changes for a recoverable cross-notebook move.
use super::*;

pub(super) struct Change {
    pub(super) path: PathBuf,
    pub(super) before: Option<Vec<u8>>,
    pub(super) after: Option<Vec<u8>>,
}

fn unavailable(message: &str) -> NotesError {
    NotesError::new("storage_unavailable", message)
}

fn read(path: &Path) -> Result<Option<Vec<u8>>, NotesError> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => fs::read(path)
            .map(Some)
            .map_err(|_| unavailable("Cannot read note move data")),
        _ => Err(unavailable("Cannot inspect note move data")),
    }
}

impl Change {
    fn capture(path: PathBuf, after: Option<Vec<u8>>) -> Result<Self, NotesError> {
        Ok(Self {
            before: read(&path)?,
            path,
            after,
        })
    }
}

fn metadata(vault: &NotesVault, book: &str, changed_at: &str) -> Result<Change, NotesError> {
    let path = vault.vault_root(book)?.join(".zicode/vault.json");
    let before = read(&path)?.ok_or_else(|| unavailable("Notebook metadata is missing"))?;
    let mut value: VaultMetadata =
        serde_json::from_slice(&before).map_err(|_| unavailable("Notebook metadata is invalid"))?;
    if value.schema_version != VAULT_SCHEMA_VERSION || value.id != book {
        return Err(NotesError::new(
            "vault_corrupt",
            "Notebook metadata identity is invalid",
        ));
    }
    value.updated_at = changed_at.to_string();
    let after = serde_json::to_vec_pretty(&value)
        .map_err(|_| unavailable("Cannot encode notebook metadata"))?;
    Ok(Change {
        path,
        before: Some(before),
        after: Some(after),
    })
}

fn change_log(vault: &NotesVault, note: &NoteDocument) -> Result<Change, NotesError> {
    let path = vault.change_log_path();
    let before = read(&path)?;
    let mut after = before.clone().unwrap_or_default();
    if after.len() as u64 > MAX_CHANGE_LOG_BYTES {
        let text = std::str::from_utf8(&after)
            .map_err(|_| unavailable("Cannot compact note change log"))?;
        let records = text
            .lines()
            .filter_map(|line| serde_json::from_str::<NoteChange>(line).ok())
            .collect::<Vec<_>>();
        let start = records.len().saturating_sub(RETAINED_CHANGE_RECORDS.max(1));
        after.clear();
        for record in &records[start..] {
            serde_json::to_writer(&mut after, record)
                .map_err(|_| unavailable("Cannot encode note change log"))?;
            after.push(b'\n');
        }
    }
    let change = NoteChange {
        cursor: Uuid::new_v4().to_string(),
        operation: "moved".into(),
        notebook_id: note.summary.notebook_id.clone(),
        note_id: note.summary.id.clone(),
        version: Some(note.summary.version.clone()),
        changed_at: note.summary.updated_at.clone(),
    };
    serde_json::to_writer(&mut after, &change)
        .map_err(|_| unavailable("Cannot encode note move change"))?;
    after.push(b'\n');
    Ok(Change {
        path,
        before,
        after: Some(after),
    })
}

pub(super) fn commit(
    vault: &NotesVault,
    source_book: &str,
    mut note: NoteDocument,
    bytes: Vec<u8>,
    expected_version: &str,
) -> Result<NoteDocument, NotesError> {
    let _lock = match &vault.storage_guard {
        Some(guard) => guard.clone(),
        None => import_transaction::lock_storage(&vault.vaults_dir())?,
    };
    move_journal::recover(&vault.vaults_dir())?;
    note.summary.version = version_for(&bytes);
    let source = Change::capture(vault.note_path(source_book, &note.summary.id)?, None)?;
    if source
        .before
        .as_ref()
        .is_none_or(|bytes| version_for(bytes) != expected_version)
    {
        return Err(NotesError::new(
            "version_conflict",
            "The note changed after it was opened",
        ));
    }
    let target = Change::capture(
        vault.note_path(&note.summary.notebook_id, &note.summary.id)?,
        Some(bytes),
    )?;
    if target.before.is_some() {
        return Err(NotesError::new(
            "conflict",
            "A note with this ID already exists in the target notebook",
        ));
    }
    // Prepare all fallible reads before staging attachments or changing the note.
    // Reverse rollback restores the source before removing the destination.
    let changes = [
        target,
        source,
        metadata(vault, &note.summary.notebook_id, &note.summary.updated_at)?,
        metadata(vault, source_book, &note.summary.updated_at)?,
        change_log(vault, &note)?,
    ];
    move_journal::apply(
        vault,
        source_book,
        &note.summary.notebook_id,
        &note.summary.id,
        &changes,
    )?;
    Ok(note)
}

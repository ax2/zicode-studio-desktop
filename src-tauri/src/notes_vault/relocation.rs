use super::*;

pub(super) fn previous_notebooks(ids: Vec<String>) -> Result<Vec<String>, NotesError> {
    let mut seen = BTreeSet::new();
    let mut normalized = Vec::new();
    for id in ids {
        let id = validate_opaque_id(&id)?;
        if seen.insert(id.clone()) {
            normalized.push(id);
        }
    }
    Ok(normalized)
}

pub(super) fn read_history(frontmatter: &str) -> Result<Vec<String>, NotesError> {
    let Some(value) = frontmatter_line(frontmatter, "previousNotebookIds") else {
        return Ok(Vec::new());
    };
    let ids = serde_json::from_str(value)
        .map_err(|_| NotesError::new("note_corrupt", "Note move history is damaged"))?;
    previous_notebooks(ids).map_err(|_| {
        NotesError::new(
            "note_corrupt",
            "Note move history contains an invalid identity",
        )
    })
}

/// Exact physical identities win. Conflicting historical claims stay unresolved.
/// The caller must have a complete inventory before enabling historical aliases.
pub(super) fn reference_targets<'a>(
    documents: impl IntoIterator<Item = (&'a str, &'a NoteDocument)>,
    include_history: bool,
) -> Result<HashMap<(String, String), Option<String>>, NotesError> {
    let documents: Vec<_> = documents.into_iter().collect();
    let exact: BTreeSet<_> = documents
        .iter()
        .map(|(book, note)| {
            (
                book.to_ascii_lowercase(),
                note.summary.id.to_ascii_lowercase(),
            )
        })
        .collect();
    let mut targets = HashMap::new();
    for (book, note) in documents {
        let book = book.to_ascii_lowercase();
        let id = note.summary.id.to_ascii_lowercase();
        targets.insert((book.clone(), id.clone()), Some(book.clone()));
        if !include_history {
            continue;
        }
        for previous in previous_notebooks(note.previous_notebook_ids.clone())? {
            let key = (previous.to_ascii_lowercase(), id.clone());
            if exact.contains(&key) {
                continue;
            }
            targets
                .entry(key)
                .and_modify(|target| {
                    if target.as_ref() != Some(&book) {
                        *target = None;
                    }
                })
                .or_insert_with(|| Some(book.clone()));
        }
    }
    Ok(targets)
}

fn unavailable() -> NotesError {
    NotesError::new(
        "storage_unavailable",
        "Cannot safely resolve the note's current location",
    )
}

fn candidate(vault: &NotesVault, book: &str, id: &str) -> Result<Option<NoteDocument>, NotesError> {
    let root = vault.vaults_dir().join(book);
    match fs::symlink_metadata(&root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(unavailable()),
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err(unavailable()),
    }
    vault.read_notebook(book)?;
    let mut directory = root;
    for part in ["src", "content", "notes"] {
        directory.push(part);
        let metadata = fs::symlink_metadata(&directory).map_err(|_| unavailable())?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(unavailable());
        }
    }
    let path = directory.join(format!("{id}.md"));
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err(unavailable()),
        Ok(_) => read_note_file(&path, book).map(Some),
    }
}

impl NotesVault {
    /// Read-only link resolution. Mutations intentionally keep using strict get_note.
    pub fn resolve_note(
        &self,
        notebook_id: &str,
        note_id: &str,
    ) -> Result<NoteDocument, NotesError> {
        let book = validate_opaque_id(notebook_id)?;
        let id = validate_opaque_id(note_id)?;
        if let Some(note) = candidate(self, &book, &id)? {
            return Ok(note);
        }
        let mut found = None;
        let mut count = 0;
        // Do not use the display snapshot or list_notebooks: both can omit entries.
        for entry in fs::read_dir(self.vaults_dir()).map_err(|_| unavailable())? {
            let entry = entry.map_err(|_| unavailable())?;
            let Some(current) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if validate_opaque_id(&current).is_err() {
                continue;
            }
            count += 1;
            if count > MAX_NOTEBOOKS {
                return Err(NotesError::new(
                    "quota_exceeded",
                    "Cannot resolve a moved note from an incomplete notebook inventory",
                ));
            }
            if current == book {
                continue;
            }
            if let Some(note) = candidate(self, &current, &id)? {
                if note.previous_notebook_ids.contains(&book) {
                    if found.is_some() {
                        return Err(NotesError::new(
                            "reference_ambiguous",
                            "More than one note claims this previous location",
                        ));
                    }
                    found = Some(note);
                }
            }
        }
        found.ok_or_else(|| NotesError::new("note_not_found", "Note does not exist"))
    }
}

use super::*;

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Book {
    pub schema: u32,
    pub id: String,
    pub title: String,
    pub icon: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: String,
    pub deleted: bool,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SavedNote {
    pub markdown: String,
    pub deleted_at: Option<String>,
    pub deletion_time_known: bool,
}

pub(super) fn location(id: &str, deleted: bool) -> PathBuf {
    if deleted {
        Path::new(".deleted").join(id)
    } else {
        PathBuf::from(id)
    }
}

pub(super) fn canonical_id(value: &str) -> Result<(), NotesError> {
    if Uuid::parse_str(value).map_err(|_| invalid())?.to_string() != value {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn validate_book(book: &Book) -> Result<(), NotesError> {
    canonical_id(&book.id)?;
    if book.schema != 1
        || validate_title(&book.title)? != book.title
        || validate_icon(book.icon.clone())? != book.icon
        || chrono::DateTime::parse_from_rfc3339(&book.created_at).is_err()
    {
        return Err(invalid());
    }
    if let Some(parent) = &book.parent_id {
        canonical_id(parent)?;
    }
    Ok(())
}

pub(super) fn books(records: &RecordMap) -> Result<HashMap<String, Book>, NotesError> {
    let mut books = HashMap::new();
    for (key, bytes) in records {
        if let Some(id) = key.strip_prefix("book/") {
            let book: Book = decode(bytes)?;
            validate_book(&book)?;
            if id != book.id || books.insert(id.to_string(), book).is_some() {
                return Err(invalid());
            }
        }
    }
    if books.values().filter(|book| !book.deleted).count() > MAX_NOTEBOOKS
        || books.len() > crate::notes_sync::MAX_RECORDS
    {
        return Err(invalid());
    }
    for book in books.values() {
        let mut seen = BTreeSet::new();
        let mut next = Some(book.id.as_str());
        while let Some(id) = next {
            if !seen.insert(id) {
                return Err(invalid());
            }
            // Existing retention can remove a deleted parent before its child.
            // Preserve that reference; only cycles among present books are invalid.
            next = books.get(id).and_then(|book| book.parent_id.as_deref());
        }
    }
    Ok(books)
}

pub(super) fn validate_note(path: &Path, notebook: &str) -> Result<(), NotesError> {
    let note = read_note_file(path, notebook)?;
    validate_title(&note.summary.title)?;
    validate_icon(note.summary.icon)?;
    validate_content(&note.content)?;
    normalize_tags(note.summary.tags)?;
    if let Some(source) = note.summary.source {
        validate_source(&source)?;
    }
    if chrono::DateTime::parse_from_rfc3339(&note.summary.created_at).is_err()
        || chrono::DateTime::parse_from_rfc3339(&note.summary.updated_at).is_err()
    {
        return Err(invalid());
    }
    Ok(())
}

pub(super) fn prepare(
    store: &Storage,
    stage: &Path,
    desired: &RecordMap,
    current: &RecordMap,
) -> Result<HashMap<String, Book>, NotesError> {
    let books = books(desired)?;
    let old_books = self::books(current)?;
    let mut note_counts = HashMap::<String, usize>::new();
    let mut bytes_total = 0usize;
    for (key, bytes) in desired {
        bytes_total = bytes_total.checked_add(bytes.len()).ok_or_else(invalid)?;
        if desired.len() > crate::notes_sync::MAX_RECORDS
            || bytes_total > crate::notes_sync::MAX_SNAPSHOT_BYTES
            || bytes.len() > crate::notes_sync::MAX_OBJECT_BYTES
        {
            return Err(invalid());
        }
        let parts: Vec<&str> = key.split('/').collect();
        if parts.first() == Some(&"book") && parts.len() == 2 {
            continue;
        }
        if parts.len() < 3 {
            return Err(invalid());
        }
        let book = books.get(parts[1]).ok_or_else(invalid)?;
        canonical_id(parts[2])?;
        let root = stage.join(&book.id);
        match parts[0] {
            "note" if parts.len() == 3 => {
                let saved: SavedNote = decode(bytes)?;
                let count = note_counts.entry(book.id.clone()).or_default();
                *count += 1;
                if *count > MAX_NOTES {
                    return Err(invalid());
                }
                if saved.markdown.len() > MAX_NOTE_BYTES
                    || (book.deleted && saved.deleted_at.is_none())
                    || (saved.deleted_at.is_none() && saved.deletion_time_known)
                {
                    return Err(invalid());
                }
                let path = if let Some(deleted_at) = &saved.deleted_at {
                    if chrono::DateTime::parse_from_rfc3339(deleted_at).is_err() {
                        return Err(invalid());
                    }
                    root.join(".trash").join(format!("{}.md", parts[2]))
                } else {
                    root.join("src/content/notes")
                        .join(format!("{}.md", parts[2]))
                };
                store.write_new(&path, saved.markdown.as_bytes())?;
                validate_note(&store.root.join(&path), &book.id)?;
                if let Some(deleted_at) = &saved.deleted_at {
                    // Reuse local deletion guards when the same deletion event is unchanged.
                    let old = current.get(key).and_then(|b| decode::<SavedNote>(b).ok());
                    let stamp = if old.as_ref().is_some_and(|old| {
                        old.deleted_at == saved.deleted_at
                            && old.deletion_time_known == saved.deletion_time_known
                    }) {
                        let old_book = old_books.get(&book.id).ok_or_else(invalid)?;
                        let old_path = location(&book.id, old_book.deleted)
                            .join(".trash")
                            .join(format!("{}.trash.json", parts[2]));
                        store.read(&old_path, 4096)?
                    } else {
                        encode(
                            &json!({"schemaVersion":1,"deletedAt":deleted_at,"deletionTimeKnown":saved.deletion_time_known,"trashToken":Uuid::new_v4().to_string()}),
                        )?
                    };
                    store.write_new(&path.with_extension("trash.json"), &stamp)?;
                }
            }
            "attachment" if parts.len() == 4 => {
                validate_attachment_id(parts[3])?;
                if bytes.is_empty() || bytes.len() > MAX_ATTACHMENT_BYTES {
                    return Err(invalid());
                }
                store.write_new(
                    &root
                        .join("public/attachments")
                        .join(parts[2])
                        .join(parts[3]),
                    bytes,
                )?;
            }
            _ => return Err(invalid()),
        }
    }
    for book in books.values() {
        let root = stage.join(&book.id);
        for path in &PARTS[1..] {
            store.mkdir(&root.join(path))?;
        }
        let existing = current.get(&format!("book/{}", book.id));
        let canonical = encode(book)?;
        let metadata = if existing == Some(&canonical) {
            let current_book: Book = decode(existing.ok_or_else(invalid)?)?;
            store.read(
                &location(&book.id, current_book.deleted).join(PARTS[0]),
                65536,
            )?
        } else {
            encode(&VaultMetadata {
                schema_version: 1,
                id: book.id.clone(),
                title: book.title.clone(),
                icon: book.icon.clone(),
                parent_id: book.parent_id.clone(),
                created_at: book.created_at.clone(),
                updated_at: now_iso(),
            })?
        };
        store.write_new(&root.join(PARTS[0]), &metadata)?;
    }
    Ok(books)
}

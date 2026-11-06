use super::*;

impl NotesVault {
    pub fn capture_sync(&self) -> Result<SyncCapture, NotesError> {
        if self.storage_guard.is_none() || self.workspace_id.is_none() {
            return Err(NotesError::new(
                "notes_scope_required",
                "Notes synchronization requires a locked workspace",
            ));
        }
        recover(&self.vaults_dir())?;
        let store = Storage::open(&self.vaults_dir())?;
        capture(&store)
    }
}

pub(super) fn capture(store: &Storage) -> Result<SyncCapture, NotesError> {
    let mut records = RecordMap::new();
    let mut remaining = crate::notes_sync::MAX_SNAPSHOT_BYTES;
    let mut revisions = BTreeSet::new();
    let mut book_ids = BTreeSet::new();
    for deleted in [false, true] {
        let parent = if deleted {
            Path::new(".deleted")
        } else {
            Path::new("")
        };
        if !store.exists(parent)? {
            continue;
        }
        for id in store.list(parent)? {
            if Uuid::parse_str(&id).is_err() {
                continue;
            }
            records::canonical_id(&id)?;
            if !book_ids.insert(id.clone()) || book_ids.len() > crate::notes_sync::MAX_RECORDS {
                return Err(invalid());
            }
            let root = records::location(&id, deleted);
            store.directory(&root)?;
            let metadata_bytes = store.read(&root.join(PARTS[0]), 65536)?;
            let metadata_value: Value = decode(&metadata_bytes)?;
            let allowed = [
                "schemaVersion",
                "id",
                "title",
                "icon",
                "parentId",
                "createdAt",
                "updatedAt",
            ];
            if metadata_value
                .as_object()
                .ok_or_else(invalid)?
                .keys()
                .any(|key| !allowed.contains(&key.as_str()))
            {
                return Err(invalid());
            }
            let metadata: VaultMetadata = decode(&metadata_bytes)?;
            if metadata.schema_version != 1
                || metadata.id != id
                || chrono::DateTime::parse_from_rfc3339(&metadata.updated_at).is_err()
            {
                return Err(invalid());
            }
            let book = Book {
                schema: 1,
                id: id.clone(),
                title: metadata.title,
                icon: metadata.icon,
                parent_id: metadata.parent_id,
                created_at: metadata.created_at,
                deleted,
            };
            records::validate_book(&book)?;
            insert(
                &mut records,
                &mut remaining,
                format!("book/{id}"),
                encode(&book)?,
            )?;
            for part in PARTS {
                let path = root.join(part);
                let hash = if store.exists(&path)? {
                    Some(store.tree_hash(&path)?)
                } else {
                    None
                };
                if part != ".trash" && hash.is_none() {
                    return Err(invalid());
                }
                revisions.insert(format!("{}/{part}:{hash:?}", root.to_string_lossy()));
            }
            let mut notes = BTreeSet::new();
            for trashed in [false, true] {
                let directory = root.join(if trashed {
                    ".trash"
                } else {
                    "src/content/notes"
                });
                if !store.exists(&directory)? {
                    continue;
                }
                for name in store.list(&directory)? {
                    if trashed && name.ends_with(".trash.json") {
                        let id = name.strip_suffix(".trash.json").ok_or_else(invalid)?;
                        records::canonical_id(id)?;
                        let _: Value = decode(&store.read(&directory.join(name), 4096)?)?;
                        continue;
                    }
                    let note_id = name.strip_suffix(".md").ok_or_else(invalid)?;
                    records::canonical_id(note_id)?;
                    if !notes.insert(note_id.to_string())
                        || notes.len() > MAX_NOTES
                        || (deleted && !trashed)
                    {
                        return Err(invalid());
                    }
                    let path = directory.join(&name);
                    records::validate_note(&store.root.join(&path), &id)?;
                    let markdown = String::from_utf8(store.read(&path, MAX_NOTE_BYTES)?)
                        .map_err(|_| invalid())?;
                    let (deleted_at, deletion_time_known) = if trashed {
                        let stamp: Value =
                            decode(&store.read(&path.with_extension("trash.json"), 4096)?)?;
                        let deleted_at = stamp["deletedAt"].as_str().ok_or_else(invalid)?;
                        if stamp["schemaVersion"] != 1
                            || chrono::DateTime::parse_from_rfc3339(deleted_at).is_err()
                            || stamp["trashToken"]
                                .as_str()
                                .is_none_or(|s| records::canonical_id(s).is_err())
                        {
                            return Err(invalid());
                        }
                        (
                            Some(deleted_at.to_string()),
                            stamp["deletionTimeKnown"].as_bool().ok_or_else(invalid)?,
                        )
                    } else {
                        (None, false)
                    };
                    insert(
                        &mut records,
                        &mut remaining,
                        format!("note/{id}/{note_id}"),
                        encode(&SavedNote {
                            markdown,
                            deleted_at,
                            deletion_time_known,
                        })?,
                    )?;
                }
            }
            let attachments = root.join("public/attachments");
            for note in store.list(&attachments)? {
                records::canonical_id(&note)?;
                let directory = attachments.join(&note);
                for name in store.list(&directory)? {
                    validate_attachment_id(&name)?;
                    let bytes = store.read(&directory.join(&name), MAX_ATTACHMENT_BYTES)?;
                    if bytes.is_empty() {
                        return Err(invalid());
                    }
                    // Preserve orphan attachments too; never turn a missing note into silent data loss.
                    insert(
                        &mut records,
                        &mut remaining,
                        format!("attachment/{id}/{note}/{name}"),
                        bytes,
                    )?;
                }
            }
        }
    }
    records::books(&records)?;
    let total = records
        .values()
        .try_fold(0usize, |sum, bytes| sum.checked_add(bytes.len()))
        .ok_or_else(invalid)?;
    if records.len() > crate::notes_sync::MAX_RECORDS
        || total > crate::notes_sync::MAX_SNAPSHOT_BYTES
    {
        return Err(invalid());
    }
    Ok(SyncCapture {
        records,
        revision: format!("{:x}", Sha256::digest(encode(&revisions)?)),
    })
}

fn insert(
    records: &mut RecordMap,
    remaining: &mut usize,
    id: String,
    bytes: Vec<u8>,
) -> Result<(), NotesError> {
    *remaining = remaining.checked_sub(bytes.len()).ok_or_else(invalid)?;
    if records.len() >= crate::notes_sync::MAX_RECORDS || records.insert(id, bytes).is_some() {
        return Err(invalid());
    }
    Ok(())
}

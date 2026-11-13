//! A workspace-locked journal for moving a notebook subtree into the trash.
use super::{move_journal::storage::Storage, *};

const STAGE: &str = ".notebook-trash-transaction";

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Book {
    id: String,
    notes: Vec<String>,
}

fn blocked() -> NotesError {
    NotesError::new("notebook_trash_recovery_required", "Notebook trash recovery could not finish. Preserve the transaction directory and reopen Notes after resolving storage access.")
}

fn stage() -> &'static Path {
    Path::new(STAGE)
}

fn book_paths(id: &str) -> (PathBuf, PathBuf) {
    (PathBuf::from(id), Path::new(".deleted").join(id))
}

pub(super) fn apply(vault: &NotesVault, ids: &[String]) -> Result<(), NotesError> {
    apply_with(vault, ids, |store, from, to| {
        store.rename_with_io_error(from, to)
    })
}

fn apply_with(
    vault: &NotesVault,
    ids: &[String],
    mut move_book: impl FnMut(&Storage, &Path, &Path) -> Result<(), NotesError>,
) -> Result<(), NotesError> {
    let root = vault.vaults_dir();
    let store = Storage::open(&root)?;
    recover(&root)?;
    let mut books = Vec::new();
    let mut changes = Vec::new();
    for id in ids {
        let (source, target) = book_paths(id);
        if store.exists(&target)? || !store.exists(&source)? {
            return Err(blocked());
        }
        let mut book = Book {
            id: id.clone(),
            notes: Vec::new(),
        };
        for note in vault.scan_notebook_notes(id)? {
            let trash = source.join(".trash").join(format!("{}.md", note.id));
            if store.exists(&trash)? {
                return Err(NotesError::new(
                    "conflict",
                    "A note with this ID is already in the trash",
                ));
            }
            book.notes.push(note.id.clone());
            changes.push(NoteChange {
                cursor: Uuid::new_v4().to_string(),
                operation: "deleted".into(),
                notebook_id: id.clone(),
                note_id: note.id,
                version: None,
                changed_at: now_iso(),
            });
        }
        books.push(book);
    }

    let pending = stage().join("pending.json");
    let committed = stage().join("committed.json");
    let result = (|| {
        if !changes.is_empty() {
            prepare_log(&store, &changes)?;
        }
        let bytes = serde_json::to_vec(&books).map_err(|_| blocked())?;
        let preparing = stage().join("preparing.json");
        store.write_new(&preparing, &bytes)?;
        store.rename(&preparing, &pending)?;
        for book in &books {
            let (from, to) = book_paths(&book.id);
            move_book(&store, &from, &to)?;
        }
        store.rename(&pending, &committed)?;
        Ok(())
    })();
    if let Err(error) = result {
        recover(&root)?;
        return Err(error);
    }
    recover(&root)
}

fn prepare_log(store: &Storage, changes: &[NoteChange]) -> Result<(), NotesError> {
    let path = Path::new("changes.jsonl");
    let before = store.hash(path)?;
    let mut bytes = if store.exists(path)? {
        store.read(path)?
    } else {
        Vec::new()
    };
    if bytes.len() as u64 > MAX_CHANGE_LOG_BYTES {
        let text = std::str::from_utf8(&bytes).map_err(|_| blocked())?;
        let retained: Vec<_> = text.lines().rev().take(RETAINED_CHANGE_RECORDS).collect();
        let mut compacted = Vec::new();
        for line in retained.into_iter().rev() {
            compacted.extend_from_slice(line.as_bytes());
            compacted.push(b'\n');
        }
        bytes = compacted;
    }
    if !bytes.is_empty() && !bytes.ends_with(b"\n") {
        bytes.push(b'\n');
    }
    for change in changes {
        serde_json::to_writer(&mut bytes, change).map_err(|_| blocked())?;
        bytes.push(b'\n');
    }
    let next = stage().join("next-log");
    store.write_new(&next, &bytes)?;
    let expected = store.hash(&next)?.ok_or_else(blocked)?;
    store.write_new(&stage().join("next-log.sha256"), expected.as_bytes())?;
    store.write_new(
        &stage().join("previous-log.sha256"),
        before.as_deref().unwrap_or("").as_bytes(),
    )
}

pub(super) fn recover(root: &Path) -> Result<(), NotesError> {
    let store = Storage::open(root)?;
    if !store.exists(stage())? {
        return Ok(());
    }
    let pending = stage().join("pending.json");
    let committed = stage().join("committed.json");
    let committed_exists = store.exists(&committed)?;
    let pending_exists = store.exists(&pending)?;
    if pending_exists && committed_exists {
        return Err(blocked());
    }
    if pending_exists || committed_exists {
        let manifest = if committed_exists {
            &committed
        } else {
            &pending
        };
        let books: Vec<Book> =
            serde_json::from_slice(&store.read(manifest)?).map_err(|_| blocked())?;
        let mut seen = std::collections::HashSet::new();
        for book in &books {
            if validate_opaque_id(&book.id)? != book.id || !seen.insert(&book.id) {
                return Err(blocked());
            }
            let mut seen = std::collections::HashSet::new();
            for id in &book.notes {
                if validate_opaque_id(id)? != *id || !seen.insert(id) {
                    return Err(blocked());
                }
            }
            let (active, deleted) = book_paths(&book.id);
            if !matches!(
                (store.exists(&active)?, store.exists(&deleted)?),
                (false, true) | (true, false)
            ) || (committed_exists && store.exists(&active)?)
            {
                return Err(blocked());
            }
        }
        if committed_exists {
            for book in &books {
                let (_, deleted) = book_paths(&book.id);
                for id in &book.notes {
                    finish_note(root, &store, &deleted, id)?;
                }
            }
            if books.iter().any(|book| !book.notes.is_empty()) {
                publish_log(&store)?;
            }
        } else {
            for book in books.iter().rev() {
                let (active, deleted) = book_paths(&book.id);
                if store.exists(&deleted)? {
                    store.rename(&deleted, &active)?;
                }
            }
        }
        // Retire the manifest only after rollback or publication is complete.
        store.rename(manifest, &stage().join("done.json"))?;
    }
    store.remove(stage())
}

fn finish_note(root: &Path, store: &Storage, deleted: &Path, id: &str) -> Result<(), NotesError> {
    let file = format!("{id}.md");
    let source = deleted.join("src/content/notes").join(&file);
    let target = deleted.join(".trash").join(&file);
    match (store.exists(&source)?, store.exists(&target)?) {
        (true, false) => {
            store.mkdir(&deleted.join(".trash"))?;
            store.exists(&target.with_extension("trash.json"))?;
            trash_metadata::write(&root.join(&target), now_iso(), true)?;
            store.rename(&source, &target)
        }
        (false, true) if store.exists(&target.with_extension("trash.json"))? => Ok(()),
        _ => Err(blocked()),
    }
}

fn publish_log(store: &Storage) -> Result<(), NotesError> {
    let path = Path::new("changes.jsonl");
    let next = stage().join("next-log");
    let previous = stage().join("previous-log");
    let expected = store.read(&stage().join("next-log.sha256"))?;
    let expected = std::str::from_utf8(&expected).map_err(|_| blocked())?;
    let before = store.read(&stage().join("previous-log.sha256"))?;
    let before = std::str::from_utf8(&before).map_err(|_| blocked())?;
    let before = (!before.is_empty()).then_some(before);
    let current = store.hash(path)?;
    let saved = store.hash(&previous)?;
    if let Some(hash) = store.hash(&next)? {
        if hash != expected {
            return Err(blocked());
        }
        if saved.is_some() {
            if saved.as_deref() != before || current.is_some() {
                return Err(blocked());
            }
        } else if current.as_deref() != before {
            return Err(blocked());
        } else if current.is_some() {
            store.rename(path, &previous)?;
        }
        store.rename(&next, path)?;
    } else if current.as_deref() != Some(expected) || saved.as_deref() != before {
        return Err(blocked());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    const CHILD_ROOT: &str = "ZICODE_NOTEBOOK_TRASH_CHILD";

    #[test]
    fn interrupted_notebook_delete_child() {
        let Some(root) = std::env::var_os(CHILD_ROOT).map(PathBuf::from) else {
            return;
        };
        assert_eq!(
            fs::read(root.join("owner")).unwrap(),
            b"notebook-trash-test"
        );
        let (workspace, ids): (String, Vec<String>) =
            serde_json::from_slice(&fs::read(root.join("request.json")).unwrap()).unwrap();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let scoped = vault.scoped(&workspace).unwrap();
        apply_with(&scoped, &ids, |store, from, to| {
            store.rename(from, to)?;
            fs::write(root.join("ready"), b"first directory moved").unwrap();
            loop {
                std::thread::park_timeout(Duration::from_secs(1));
            }
        })
        .unwrap();
    }

    #[test]
    fn terminated_after_first_directory_move_recovers_on_reopen() {
        let scratch =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../.cache/task-scratch/notebook-trash");
        fs::create_dir_all(&scratch).unwrap();
        let root = scratch.join(Uuid::new_v4().to_string());
        fs::create_dir(&root).unwrap();
        fs::write(root.join("owner"), b"notebook-trash-test").unwrap();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace = Uuid::new_v4().to_string();
        let scoped = vault.scoped(&workspace).unwrap();
        let book = scoped.create_notebook("Parent", None, None).unwrap();
        let child = scoped
            .create_notebook("Child", None, Some(book.id.clone()))
            .unwrap();
        let note = scoped
            .create_note(&book.id, "Original", "Keep bytes", vec![], None, None)
            .unwrap();
        let note_path = scoped.note_path(&book.id, &note.summary.id).unwrap();
        let book_root = scoped.vault_root(&book.id).unwrap();
        let attachment = book_root.join("public/attachments/probe.txt");
        fs::create_dir_all(attachment.parent().unwrap()).unwrap();
        fs::write(&attachment, b"attachment").unwrap();
        let history = book_root.join(".history/probe.md");
        fs::create_dir_all(history.parent().unwrap()).unwrap();
        fs::write(&history, b"history").unwrap();
        let original = fs::read(&note_path).unwrap();
        let log = fs::read(scoped.change_log_path()).unwrap();
        fs::write(
            root.join("request.json"),
            serde_json::to_vec(&(&workspace, [&book.id, &child.id])).unwrap(),
        )
        .unwrap();
        drop(scoped);
        let mut process = crate::process_command::new_command(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "notes_vault::notebook_trash_transaction::tests::interrupted_notebook_delete_child",
            ])
            .env(CHILD_ROOT, &root)
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(20);
        while !root.join("ready").is_file() && Instant::now() < deadline {
            assert!(
                process.try_wait().unwrap().is_none(),
                "Child exited before interruption"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
        process.kill().unwrap();
        assert!(!process.wait().unwrap().success());
        assert!(root.join("ready").is_file() && !book_root.exists());
        let reopened = vault.scoped(&workspace).unwrap();
        assert_eq!(fs::read(note_path).unwrap(), original);
        assert_eq!(fs::read(attachment).unwrap(), b"attachment");
        assert_eq!(fs::read(history).unwrap(), b"history");
        assert_eq!(fs::read(reopened.change_log_path()).unwrap(), log);
        assert!(reopened.vault_root(&child.id).unwrap().is_dir());
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn publication_preserves_external_changes_to_original_log() {
        let root = std::env::temp_dir().join(format!("zicode-notebook-trash-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let log = root.join("changes.jsonl");
        fs::write(&log, b"original\n").unwrap();
        let store = Storage::open(&root).unwrap();
        prepare_log(&store, &[]).unwrap();
        fs::write(&log, b"external event\n").unwrap();
        assert_eq!(
            publish_log(&store).unwrap_err().code,
            "notebook_trash_recovery_required"
        );
        assert_eq!(fs::read(&log).unwrap(), b"external event\n");
        assert!(store.exists(&stage().join("next-log")).unwrap());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reopening_finishes_committed_delete_and_publishes_events_once() {
        let root = std::env::temp_dir().join(format!("zicode-notebook-trash-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace = Uuid::new_v4().to_string();
        let scoped = vault.scoped(&workspace).unwrap();
        let book = scoped.create_notebook("Original", None, None).unwrap();
        let note = scoped
            .create_note(&book.id, "Original", "Keep bytes", vec![], None, None)
            .unwrap();
        let original = fs::read(scoped.note_path(&book.id, &note.summary.id).unwrap()).unwrap();
        let store = Storage::open(&scoped.vaults_dir()).unwrap();
        let books = vec![Book {
            id: book.id.clone(),
            notes: vec![note.summary.id.clone()],
        }];
        prepare_log(
            &store,
            &[NoteChange {
                cursor: Uuid::new_v4().to_string(),
                operation: "deleted".into(),
                notebook_id: book.id.clone(),
                note_id: note.summary.id.clone(),
                version: None,
                changed_at: now_iso(),
            }],
        )
        .unwrap();
        let (active, deleted) = book_paths(&book.id);
        store
            .write_new(
                &stage().join("pending.json"),
                &serde_json::to_vec(&books).unwrap(),
            )
            .unwrap();
        store.rename(&active, &deleted).unwrap();
        store
            .rename(
                &stage().join("pending.json"),
                &stage().join("committed.json"),
            )
            .unwrap();
        drop(store);
        drop(scoped);

        let reopened = vault.scoped(&workspace).unwrap();
        let trash = reopened
            .vaults_dir()
            .join(deleted)
            .join(".trash")
            .join(format!("{}.md", note.summary.id));
        assert_eq!(fs::read(trash).unwrap(), original);
        let log = fs::read_to_string(reopened.change_log_path()).unwrap();
        assert_eq!(log.matches("\"operation\":\"deleted\"").count(), 1);
        drop(reopened);
        let reopened = vault.scoped(&workspace).unwrap();
        assert_eq!(fs::read_to_string(reopened.change_log_path()).unwrap(), log);
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_second_notebook_rename_restores_subtree_without_deletion_events() {
        let root = std::env::temp_dir().join(format!("zicode-notebook-trash-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        let workspace = Uuid::new_v4().to_string();
        let scoped = vault.scoped(&workspace).unwrap();
        let parent = scoped.create_notebook("Parent", None, None).unwrap();
        let child = scoped
            .create_notebook("Child", None, Some(parent.id.clone()))
            .unwrap();
        let note = scoped
            .create_note(&parent.id, "Original", "Keep bytes", vec![], None, None)
            .unwrap();
        let note_path = scoped.note_path(&parent.id, &note.summary.id).unwrap();
        let original = fs::read(&note_path).unwrap();
        let attachment = scoped
            .vault_root(&parent.id)
            .unwrap()
            .join("public/attachments/probe.txt");
        fs::create_dir_all(attachment.parent().unwrap()).unwrap();
        fs::write(&attachment, b"Keep attachment").unwrap();
        let log = fs::read(scoped.change_log_path()).unwrap();
        let mut count = 0;
        let result = apply_with(
            &scoped,
            &[parent.id.clone(), child.id.clone()],
            |store, from, to| {
                count += 1;
                if count == 2 {
                    return Err(NotesError::new(
                        "storage_unavailable",
                        "Injected directory rename failure",
                    ));
                }
                store.rename(from, to)
            },
        );
        assert_eq!(
            result.unwrap_err().message,
            "Injected directory rename failure"
        );
        assert_eq!(fs::read(&note_path).unwrap(), original);
        assert_eq!(fs::read(&attachment).unwrap(), b"Keep attachment");
        assert_eq!(fs::read(scoped.change_log_path()).unwrap(), log);
        assert!(scoped.vaults_dir().join(&child.id).is_dir());
        assert!(!scoped.vaults_dir().join(STAGE).exists());
        drop(scoped);
        let reopened = vault.scoped(&workspace).unwrap();
        assert_eq!(fs::read(reopened.change_log_path()).unwrap(), log);
        drop(reopened);
        fs::remove_dir_all(root).unwrap();
    }
}

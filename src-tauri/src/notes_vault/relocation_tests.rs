use super::*;

struct Fixture {
    root: PathBuf,
    vault: NotesVault,
}
impl Fixture {
    fn new() -> Self {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".cache/task-scratch/note-relocation")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(root.join("plugins")).unwrap();
        fs::write(root.join("owner"), b"note-relocation-tests").unwrap();
        let vault = NotesVault::new(root.join("plugins")).unwrap();
        Self { root, vault }
    }
    fn book(&self, title: &str) -> String {
        self.vault.create_notebook(title, None, None).unwrap().id
    }
    fn note(&self, book: &str, content: &str) -> NoteDocument {
        self.vault
            .create_note(book, "Original", content, vec![], None, None)
            .unwrap()
    }
    fn move_to(&self, note: &NoteDocument, book: &str) -> NoteDocument {
        self.vault
            .move_note(
                &note.summary.notebook_id,
                &note.summary.id,
                book,
                &note.summary.version,
            )
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let parent = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".cache/task-scratch/note-relocation")
            .canonicalize()
            .unwrap();
        if self.root.canonicalize().unwrap().parent() == Some(parent.as_path())
            && fs::read(self.root.join("owner")).unwrap() == b"note-relocation-tests"
        {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

#[test]
fn old_locations_survive_multiple_moves_edits_restart_and_trash_restore() {
    let f = Fixture::new();
    let (a, b, c) = (f.book("A"), f.book("B"), f.book("C"));
    let original = f.note(&a, "\n  unmodified body\n\n");
    let attachment = f
        .vault
        .store_attachment(
            &a,
            &original.summary.id,
            "data.txt",
            "text/plain",
            b"a\0\xff",
        )
        .unwrap();
    let moved = f.move_to(&original, &b);
    let moved = f.move_to(&moved, &c);
    assert_eq!(moved.previous_notebook_ids, vec![a.clone(), b.clone()]);
    let saved = f
        .vault
        .save_note(
            &c,
            &moved.summary.id,
            "Renamed",
            &moved.content,
            vec![],
            None,
            &moved.summary.version,
        )
        .unwrap();
    let reopened = NotesVault::new(f.root.join("plugins")).unwrap();
    for book in [&a, &b, &c] {
        let resolved = reopened.resolve_note(book, &original.summary.id).unwrap();
        assert_eq!(resolved.summary.notebook_id, c);
        assert_eq!(resolved.content, original.content);
        assert_eq!(resolved.previous_notebook_ids, saved.previous_notebook_ids);
    }
    assert!(reopened
        .save_note(
            &a,
            &saved.summary.id,
            "Stale",
            "wrong",
            vec![],
            None,
            &saved.summary.version
        )
        .is_err());
    reopened
        .delete_note(&c, &saved.summary.id, &saved.summary.version)
        .unwrap();
    assert_eq!(
        reopened
            .resolve_note(&a, &saved.summary.id)
            .unwrap_err()
            .code,
        "note_not_found"
    );
    let restored = reopened.restore_note(&c, &saved.summary.id).unwrap();
    let back = f.move_to(&restored, &a);
    for book in [&a, &b, &c] {
        assert_eq!(
            reopened
                .resolve_note(book, &back.summary.id)
                .unwrap()
                .summary
                .notebook_id,
            a
        );
    }
    assert_eq!(
        reopened
            .read_attachment(&a, &back.summary.id, &attachment.id)
            .unwrap()
            .0,
        b"a\0\xff"
    );
}

#[test]
fn imported_same_id_copy_never_claims_original_lineage() {
    let f = Fixture::new();
    let (a, b) = (f.book("A"), f.book("B"));
    let original = f.note(&a, "original");
    let moved = f.move_to(&original, &b);
    let imported = f
        .vault
        .import_export(f.vault.export_notebook(&b).unwrap())
        .unwrap();
    let copy = f
        .vault
        .get_note(&imported.id, &original.summary.id)
        .unwrap();
    assert!(copy.previous_notebook_ids.is_empty());
    assert_eq!(
        f.vault
            .resolve_note(&a, &original.summary.id)
            .unwrap()
            .summary
            .notebook_id,
        b
    );
    f.vault
        .delete_note(&b, &moved.summary.id, &moved.summary.version)
        .unwrap();
    assert_eq!(
        f.vault
            .resolve_note(&a, &original.summary.id)
            .unwrap_err()
            .code,
        "note_not_found"
    );
    assert_eq!(
        f.vault
            .resolve_note(&imported.id, &original.summary.id)
            .unwrap()
            .content,
        "original"
    );
}

#[test]
fn backlinks_and_imported_internal_links_follow_the_moved_target() {
    let f = Fixture::new();
    let (a, b) = (f.book("A"), f.book("B"));
    let original = f.note(&a, "target");
    let incoming = f.note(
        &a,
        &format!("[source](zicode-note://{a}/{})", original.summary.id),
    );
    f.move_to(&original, &b);
    let links = f.vault.knowledge().unwrap().links;
    assert!(links
        .iter()
        .any(|link| link.from_note_id == incoming.summary.id && link.to_notebook_id == b));
    let imports = f
        .vault
        .import_all_export(VaultExportBundle {
            schema_version: 1,
            notebooks: f.vault.export_all_notebooks().unwrap(),
        })
        .unwrap();
    let imported_a = &imports
        .iter()
        .find(|book| book.title == "A (Imported)")
        .unwrap()
        .id;
    let imported_b = &imports
        .iter()
        .find(|book| book.title == "B (Imported)")
        .unwrap()
        .id;
    let restored = f.vault.get_note(imported_a, &incoming.summary.id).unwrap();
    assert_eq!(
        restored.content,
        format!(
            "[source](zicode-note://{imported_b}/{})",
            original.summary.id
        )
    );
    assert!(f
        .vault
        .get_note(imported_b, &original.summary.id)
        .unwrap()
        .previous_notebook_ids
        .is_empty());
    assert_eq!(
        f.vault.get_note(&a, &incoming.summary.id).unwrap().content,
        incoming.content
    );
}

#[test]
fn ambiguous_manual_copies_and_incomplete_inventory_are_not_guessed() {
    let f = Fixture::new();
    let (a, b, c) = (f.book("A"), f.book("B"), f.book("C"));
    let original = f.note(&a, "target");
    let moved = f.move_to(&original, &b);
    let mut duplicate = moved.clone();
    duplicate.summary.notebook_id = c.clone();
    f.vault.write_note(&duplicate, None).unwrap();
    assert_eq!(
        f.vault
            .resolve_note(&a, &original.summary.id)
            .unwrap_err()
            .code,
        "reference_ambiguous"
    );
    fs::remove_file(f.vault.note_path(&c, &original.summary.id).unwrap()).unwrap();
    // A damaged valid-ID notebook prevents a supposedly unique alias result.
    fs::remove_file(f.vault.vault_root(&c).unwrap().join(".zicode/vault.json")).unwrap();
    assert!(f.vault.resolve_note(&a, &original.summary.id).is_err());
    // Exact current identity remains usable without a whole-workspace scan.
    assert_eq!(
        f.vault
            .resolve_note(&b, &original.summary.id)
            .unwrap()
            .content,
        "target"
    );
}

#[test]
fn legacy_and_corrupt_history_are_distinguished_and_no_history_is_invented() {
    let f = Fixture::new();
    let (a, b) = (f.book("A"), f.book("B"));
    let original = f.note(&a, "legacy");
    assert!(original.previous_notebook_ids.is_empty());
    let path = f.vault.note_path(&a, &original.summary.id).unwrap();
    let mut old_copy = original.clone();
    old_copy.summary.notebook_id = b.clone();
    f.vault.write_note(&old_copy, None).unwrap();
    fs::remove_file(&path).unwrap();
    assert_eq!(
        f.vault
            .resolve_note(&a, &original.summary.id)
            .unwrap_err()
            .code,
        "note_not_found"
    );
    assert!(relocation::read_history("previousNotebookIds: [\"not-an-id\"]").is_err());
    assert!(relocation::read_history("previousNotebookIds: invalid").is_err());
}

#[cfg(windows)]
#[test]
fn denied_source_removal_rolls_back_destination_history_and_attachments() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    let (a, b) = (f.book("A"), f.book("B"));
    let original = f.note(&a, "unchanged");
    let file = f
        .vault
        .store_attachment(
            &a,
            &original.summary.id,
            "data.txt",
            "text/plain",
            b"original bytes",
        )
        .unwrap();
    let held = OpenOptions::new()
        .read(true)
        .share_mode(3)
        .open(f.vault.note_path(&a, &original.summary.id).unwrap())
        .unwrap();
    let error = f
        .vault
        .move_note(&a, &original.summary.id, &b, &original.summary.version)
        .unwrap_err();
    assert_eq!(error.code, "storage_unavailable");
    assert!(f.vault.get_note(&b, &original.summary.id).is_err());
    let unchanged = f.vault.resolve_note(&a, &original.summary.id).unwrap();
    assert_eq!(unchanged.summary.version, original.summary.version);
    assert!(unchanged.previous_notebook_ids.is_empty());
    assert_eq!(
        f.vault
            .read_attachment(&a, &original.summary.id, &file.id)
            .unwrap()
            .0,
        b"original bytes"
    );
    assert!(!f
        .vault
        .vault_root(&b)
        .unwrap()
        .join("public/attachments")
        .join(&original.summary.id)
        .exists());
    drop(held);
}

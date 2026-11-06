use super::*;

#[test]
fn regular_metadata_file_hash_and_root_listing_work_without_directory_suffix() {
    let fixture = Fixture::new();
    let book = fixture.book();
    fixture.note(&book.id);
    let store = Storage::open(&fixture.vault.vaults_dir()).unwrap();
    assert!(store.list(Path::new("")).unwrap().contains(&book.id));
    let path = Path::new(&book.id).join(PARTS[0]);
    let original = store
        .tree_hash(&path)
        .expect("An ordinary file is not a directory");
    assert_eq!(store.tree_hash(&path).unwrap(), original);
    fixture
        .vault
        .capture_sync()
        .expect("generated Notes metadata and content must be valid");
    fs::write(store.root.join(&path), b"different bytes").unwrap();
    assert_ne!(store.tree_hash(&path).unwrap(), original);
}

#[test]
fn new_notebook_and_notebook_location_change_recover_at_each_checkpoint() {
    let source = Fixture::new();
    let book = source.book();
    let note = source.note(&book.id);
    let active = source.vault.capture_sync().unwrap().records;
    source
        .vault
        .delete_note(&book.id, &note.summary.id, &note.summary.version)
        .unwrap();
    source.vault.delete_notebook(&book.id).unwrap();
    let deleted = source.vault.capture_sync().unwrap().records;
    for new_book in [true, false] {
        for checkpoint in 1..=14 {
            let mut target = Fixture::new();
            if !new_book {
                let captured = target.vault.capture_sync().unwrap();
                target
                    .vault
                    .apply_sync(&captured.revision, &active)
                    .unwrap();
            }
            let before = target.vault.capture_sync().unwrap();
            let desired = if new_book { &active } else { &deleted };
            let result = target.vault.apply_sync_inner(
                &before.revision,
                desired,
                transaction::Run {
                    fail_at: Some(checkpoint),
                    step: 0,
                },
            );
            assert!(
                result.is_ok()
                    || result
                        .as_ref()
                        .err()
                        .is_some_and(|e| e.code == "test_interruption")
            );
            target.restart();
            let after = target.vault.capture_sync().unwrap();
            assert!(
                after.records == before.records || after.records == *desired,
                "new={new_book}, checkpoint={checkpoint}"
            );
        }
    }
}

#[test]
fn independent_handle_cannot_acquire_the_same_vault_while_snapshot_is_locked() {
    let fixture = Fixture::new();
    fixture.book();
    let base = NotesVault::new(fixture.root.join("plugins")).unwrap();
    assert_eq!(
        base.scoped(&fixture.workspace_id).err().unwrap().code,
        "notes_storage_busy"
    );
    assert!(fixture.vault.capture_sync().is_ok());
}

#[test]
fn journal_cleanup_interruption_cannot_make_committed_notes_unavailable() {
    let mut fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    fs::create_dir_all(fixture.vault.vault_root(&book.id).unwrap().join(".trash")).unwrap();
    let before = fixture.vault.capture_sync().unwrap();
    let mut desired = before.records.clone();
    let key = format!("note/{}/{}", book.id, note.summary.id);
    let mut saved: SavedNote = decode(&desired[&key]).unwrap();
    saved.markdown = saved.markdown.replace("不会改名", "已同步");
    desired.insert(key, encode(&saved).unwrap());
    let result = fixture.vault.apply_sync_inner(
        &before.revision,
        &desired,
        transaction::Run {
            fail_at: Some(13),
            step: 0,
        },
    );
    assert!(result
        .as_ref()
        .err()
        .is_some_and(|e| e.code == "test_interruption"));
    // Simulate a crash after the committed journal was atomically retired,
    // followed by only part of temporary-file cleanup completing.
    let root = fixture.vault.vaults_dir();
    let stage = fs::read_dir(root.join(JOURNALS))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let tx = stage.file_name().unwrap().to_os_string();
    fs::remove_file(root.join(&book.id).join(OWNER)).unwrap();
    fs::create_dir_all(root.join(".sync-discarded")).unwrap();
    let retired = root.join(".sync-discarded").join(tx);
    fs::rename(stage, &retired).unwrap();
    fs::remove_file(retired.join("owner")).unwrap();
    fixture.restart();
    assert_eq!(fixture.vault.capture_sync().unwrap().records, desired);
}

use super::*;

#[test]
fn every_install_checkpoint_recovers_old_data_or_committed_new_data_after_reopen() {
    let source = Fixture::new();
    let book = source.book();
    let note = source.note(&book.id);
    let old = source.vault.capture_sync().unwrap().records;
    source
        .vault
        .save_note(
            &book.id,
            &note.summary.id,
            "new title",
            "new data",
            vec![],
            None,
            &note.summary.version,
        )
        .unwrap();
    let new = source.vault.capture_sync().unwrap().records;
    for checkpoint in 1..=14 {
        let mut target = Fixture::new();
        let initial = target.vault.capture_sync().unwrap();
        target.vault.apply_sync(&initial.revision, &old).unwrap();
        let current = target.vault.capture_sync().unwrap();
        let result = target.vault.apply_sync_inner(
            &current.revision,
            &new,
            transaction::Run {
                fail_at: Some(checkpoint),
                step: 0,
            },
        );
        let interrupted = result
            .as_ref()
            .err()
            .is_some_and(|e| e.code == "test_interruption");
        target.restart();
        let actual = target.vault.capture_sync().unwrap().records;
        assert!(
            actual == old || actual == new,
            "checkpoint {checkpoint} left a partial snapshot"
        );
        if !interrupted {
            assert_eq!(actual, new);
        }
    }
}

#[test]
fn cloud_permanent_notebook_deletion_retains_complete_local_archive() {
    let fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    fs::write(
        fixture
            .vault
            .vault_root(&book.id)
            .unwrap()
            .join("custom.txt"),
        b"do not delete",
    )
    .unwrap();
    let current = fixture.vault.capture_sync().unwrap();
    fixture
        .vault
        .apply_sync(&current.revision, &RecordMap::new())
        .unwrap();
    assert!(fixture.vault.capture_sync().unwrap().records.is_empty());
    let archives = fixture.vault.vaults_dir().join(ARCHIVES);
    let archive = fs::read_dir(archives)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path()
        .join(&book.id);
    assert_eq!(
        fs::read(archive.join("custom.txt")).unwrap(),
        b"do not delete"
    );
    assert!(archive
        .join("src/content/notes")
        .join(format!("{}.md", note.summary.id))
        .is_file());
}

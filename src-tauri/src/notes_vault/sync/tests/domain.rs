use super::*;

#[test]
fn two_real_vaults_preserve_notebook_note_ids_whitespace_metadata_and_attachment_bytes() {
    let source = Fixture::new();
    let target = Fixture::new();
    let parent = source.book();
    let child = source
        .vault
        .create_notebook("子笔记本", None, Some(parent.id.clone()))
        .unwrap();
    let note = source.note(&child.id);
    let attachment = source
        .vault
        .store_attachment(
            &child.id,
            &note.summary.id,
            "data.txt",
            "text/plain",
            b"binary\0\xff",
        )
        .unwrap();
    let result = transfer(&source.vault, &target.vault);
    assert_eq!(result.records, source.vault.capture_sync().unwrap().records);
    let restored = target.vault.get_note(&child.id, &note.summary.id).unwrap();
    assert_eq!(restored.content, note.content);
    assert_eq!(restored.summary.version, note.summary.version);
    assert_eq!(restored.summary.title, "不会改名");
    assert_eq!(
        target.vault.read_notebook(&child.id).unwrap().parent_id,
        Some(parent.id)
    );
    assert_eq!(
        target
            .vault
            .read_attachment(&child.id, &note.summary.id, &attachment.id)
            .unwrap()
            .0,
        b"binary\0\xff"
    );
}

#[test]
fn updates_do_not_replace_unmanaged_files_or_copy_credentials_drafts_and_indexes() {
    let source = Fixture::new();
    let target = Fixture::new();
    let book = source.book();
    let note = source.note(&book.id);
    let root = source.vault.vault_root(&book.id).unwrap();
    fs::write(
        root.join(".zicode/private-draft.json"),
        b"must-not-upload-draft",
    )
    .unwrap();
    fs::write(root.join("secret-config.json"), b"must-not-upload-password").unwrap();
    transfer(&source.vault, &target.vault);
    let target_root = target.vault.vault_root(&book.id).unwrap();
    assert!(!target_root.join("secret-config.json").exists());
    fs::write(target_root.join("user-custom.txt"), b"local-only").unwrap();
    source
        .vault
        .save_note(
            &book.id,
            &note.summary.id,
            "新标题",
            "新正文",
            vec![],
            None,
            &note.summary.version,
        )
        .unwrap();
    transfer(&source.vault, &target.vault);
    assert_eq!(
        fs::read(target_root.join("user-custom.txt")).unwrap(),
        b"local-only"
    );
    assert_eq!(
        target
            .vault
            .get_note(&book.id, &note.summary.id)
            .unwrap()
            .summary
            .title,
        "新标题"
    );
    assert!(!target_root.join(".zicode/private-draft.json").exists());
}

#[test]
fn live_edit_during_sync_rejects_stale_application_without_mutation() {
    let source = Fixture::new();
    let target = Fixture::new();
    let book = source.book();
    let note = source.note(&book.id);
    transfer(&source.vault, &target.vault);
    let before = target.vault.capture_sync().unwrap();
    source
        .vault
        .save_note(
            &book.id,
            &note.summary.id,
            "远端",
            "remote",
            vec![],
            None,
            &note.summary.version,
        )
        .unwrap();
    let local = target.vault.get_note(&book.id, &note.summary.id).unwrap();
    target
        .vault
        .save_note(
            &book.id,
            &local.summary.id,
            "本地继续编辑",
            "newer local",
            vec![],
            None,
            &local.summary.version,
        )
        .unwrap();
    let expected = target.vault.capture_sync().unwrap();
    let error = target
        .vault
        .apply_sync(
            &before.revision,
            &source.vault.capture_sync().unwrap().records,
        )
        .err()
        .unwrap();
    assert_eq!(error.code, "sync_local_changed");
    assert_eq!(
        target.vault.capture_sync().unwrap().revision,
        expected.revision
    );
}

#[test]
fn deleted_notes_and_deleted_nested_notebooks_remain_restorable_with_attachments() {
    let source = Fixture::new();
    let target = Fixture::new();
    let book = source.book();
    let child = source
        .vault
        .create_notebook("child", None, Some(book.id.clone()))
        .unwrap();
    let note = source.note(&child.id);
    let attachment = source
        .vault
        .store_attachment(
            &child.id,
            &note.summary.id,
            "file.txt",
            "text/plain",
            b"keep me",
        )
        .unwrap();
    source.vault.delete_notebook(&book.id).unwrap();
    transfer(&source.vault, &target.vault);
    assert!(target
        .vault
        .list(None, None, None, false)
        .unwrap()
        .notebooks
        .is_empty());
    let trash = target.vault.list_trash(None).unwrap();
    assert_eq!(trash.len(), 1);
    assert_eq!(trash[0].note.id, note.summary.id);
    let restored = target
        .vault
        .restore_note(&child.id, &note.summary.id)
        .unwrap();
    assert_eq!(restored.content, note.content);
    assert_eq!(
        target
            .vault
            .read_attachment(&child.id, &note.summary.id, &attachment.id)
            .unwrap()
            .0,
        b"keep me"
    );
}

#[test]
fn invalid_remote_paths_markdown_or_hierarchy_do_not_change_local_files() {
    let fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    let original = fixture.vault.capture_sync().unwrap();
    for case in 0..3 {
        let mut desired = original.records.clone();
        if case == 0 {
            desired.insert("attachment/../../outside.txt".into(), b"no".to_vec());
        }
        if case == 1 {
            let key = format!("note/{}/{}", book.id, note.summary.id);
            desired.insert(
                key,
                encode(&SavedNote {
                    markdown: "broken frontmatter".into(),
                    deleted_at: None,
                    deletion_time_known: false,
                })
                .unwrap(),
            );
        }
        if case == 2 {
            let key = format!("book/{}", book.id);
            let mut saved: Book = decode(&desired[&key]).unwrap();
            saved.parent_id = Some(book.id.clone());
            desired.insert(key, encode(&saved).unwrap());
        }
        assert!(fixture
            .vault
            .apply_sync(&original.revision, &desired)
            .is_err());
        assert_eq!(
            fixture.vault.capture_sync().unwrap().revision,
            original.revision
        );
    }
}

#[test]
fn corrupt_local_note_or_missing_trash_stamp_cannot_be_interpreted_as_deletion() {
    let fixture = Fixture::new();
    let book = fixture.book();
    let note = fixture.note(&book.id);
    let path = fixture.vault.note_path(&book.id, &note.summary.id).unwrap();
    fixture
        .vault
        .capture_sync()
        .expect("valid generated data must capture before corruption");
    let bytes = fs::read(&path).unwrap();
    fs::write(&path, b"corrupt saved note").unwrap();
    assert!(fixture.vault.capture_sync().is_err());
    fs::write(&path, bytes).unwrap();
    fixture
        .vault
        .capture_sync()
        .expect("restored original bytes must capture");
    fixture
        .vault
        .delete_note(&book.id, &note.summary.id, &note.summary.version)
        .unwrap();
    fs::remove_file(
        fixture
            .vault
            .trash_path(&book.id, &note.summary.id)
            .unwrap()
            .with_extension("trash.json"),
    )
    .unwrap();
    assert!(fixture.vault.capture_sync().is_err());
}

#[test]
fn unchanged_sync_keeps_local_revision_and_does_not_create_journal() {
    let fixture = Fixture::new();
    let book = fixture.book();
    fixture.note(&book.id);
    let captured = fixture.vault.capture_sync().unwrap();
    let after = fixture
        .vault
        .apply_sync(&captured.revision, &captured.records)
        .unwrap();
    assert_eq!(captured.revision, after.revision);
    assert!(!fixture.vault.vaults_dir().join(JOURNALS).exists());
}

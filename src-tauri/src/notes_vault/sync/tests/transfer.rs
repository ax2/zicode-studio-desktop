use super::*;
use crate::notes_sync::{tests::Server, SyncError, SyncKey, SyncOutcome, SyncRepository};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

fn release_edit_lock(fixture: &mut Fixture) -> NotesVault {
    let storage = NotesVault::new(fixture.root.join("plugins")).unwrap();
    fixture.vault.storage_guard = None;
    storage
}

async fn sync_fixture(
    repository: &SyncRepository,
    fixture: &mut Fixture,
    cancel: &CancellationToken,
) -> Result<SyncOutcome, SyncError> {
    let storage = release_edit_lock(fixture);
    let result = repository
        .synchronize_saved(&storage, &fixture.workspace_id, cancel)
        .await;
    fixture.restart();
    result
}

fn scope_dir(vault: &NotesVault) -> PathBuf {
    let transfers = vault.vaults_dir().join(".sync-transfers");
    let mut scopes = fs::read_dir(transfers).unwrap();
    let scope = scopes.next().unwrap().unwrap();
    assert!(scopes.next().is_none());
    scope.path()
}

fn ciphertexts(vault: &NotesVault) -> Vec<Vec<u8>> {
    let mut files = fs::read_dir(scope_dir(vault).join("objects"))
        .unwrap()
        .map(|entry| fs::read(entry.unwrap().path()).unwrap())
        .collect::<Vec<_>>();
    files.sort();
    files
}

#[tokio::test]
async fn durable_saved_upload_recovers_lost_index_write_without_resending_objects() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let initial = server.configured(key).unwrap();
    let cancel = CancellationToken::new();
    let mut author = Fixture::new();
    let book = author.book();
    let note = author.note(&book.id);
    let attachment = author
        .vault
        .store_attachment(
            &book.id,
            &note.summary.id,
            "binary.txt",
            "text/plain",
            b"binary bytes\0\xff",
        )
        .unwrap();
    let local_only = author
        .vault
        .vault_root(&book.id)
        .unwrap()
        .join(".zicode/private-draft.json");
    fs::write(&local_only, b"draft must stay here").unwrap();
    let saved = author.vault.capture_sync().unwrap();
    assert_eq!(saved.records.len(), 3);

    server.fail_index(true);
    assert_eq!(
        sync_fixture(&initial, &mut author, &cancel).await.err(),
        Some(SyncError::Http(500))
    );
    let uploads = server.object_put_paths();
    assert_eq!(uploads.len(), saved.records.len());
    assert!(server.index().is_none());
    let staged = ciphertexts(&author.vault);
    assert_eq!(staged.len(), uploads.len());
    assert!(staged.iter().all(|bytes| bytes.starts_with(b"ZNS1")));
    assert!(staged.iter().all(|bytes| saved
        .records
        .values()
        .all(|plaintext| { !bytes.windows(plaintext.len()).any(|part| part == plaintext) })));
    drop(initial);
    let interrupted = scope_dir(&author.vault).join("pending");
    fs::write(&interrupted, b"partial ciphertext").unwrap();
    author.restart();

    server.fail_index(false);
    let next = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    let outcome = sync_fixture(&next, &mut author, &cancel).await.unwrap();
    let SyncOutcome::Synced { snapshot, .. } = outcome else {
        panic!("expected recovered sync")
    };
    assert_eq!(snapshot, saved.records);
    assert_eq!(server.object_put_paths(), uploads);
    assert_eq!(ciphertexts(&author.vault), staged);
    assert!(!interrupted.exists());
    assert_eq!(fs::read(&local_only).unwrap(), b"draft must stay here");

    let mut reader = Fixture::new();
    let read = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    sync_fixture(&read, &mut reader, &cancel).await.unwrap();
    let copied = reader.vault.get_note(&book.id, &note.summary.id).unwrap();
    assert_eq!(copied.content, note.content);
    assert_eq!(copied.summary.version, note.summary.version);
    assert_eq!(
        reader
            .vault
            .read_attachment(&book.id, &note.summary.id, &attachment.id)
            .unwrap()
            .0,
        b"binary bytes\0\xff"
    );
    let reader_root = reader.vault.vault_root(&book.id).unwrap();
    assert!(!reader_root.join(".zicode/private-draft.json").exists());
    assert_eq!(reader.vault.capture_sync().unwrap().records, saved.records);
    assert_eq!(server.object_put_paths(), uploads);
}

#[tokio::test]
async fn persisted_retry_deadline_checks_before_any_webdav_request_and_survives_reopen() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let first = server.configured(key).unwrap();
    let cancel = CancellationToken::new();
    let mut local = Fixture::new();
    local.note(&local.book().id);
    server.set_status(Some(429));
    assert_eq!(
        sync_fixture(&first, &mut local, &cancel).await.err(),
        Some(SyncError::RateLimited {
            retry_after_seconds: 123
        })
    );
    let before = server.request_count();
    assert_eq!(before, 1);
    drop(first);
    local.restart();

    server.set_status(None);
    let next = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    let error = sync_fixture(&next, &mut local, &cancel).await.err();
    assert!(matches!(
        error,
        Some(SyncError::RateLimited {
            retry_after_seconds: 1..=123
        })
    ));
    assert_eq!(server.request_count(), before);
    let path = scope_dir(&local.vault).join("retry-at");
    fs::write(&path, 0_u64.to_le_bytes()).unwrap();
    sync_fixture(&next, &mut local, &cancel).await.unwrap();
    assert!(server.request_count() > before);
    assert!(!path.exists());
}

#[tokio::test]
async fn separate_attempt_cannot_access_busy_queue_and_cancelled_read_never_publishes() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let repository = server.connect(key).await.unwrap();
    let competing = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    let cancel = CancellationToken::new();
    let other_cancel = CancellationToken::new();
    let mut local = Fixture::new();
    local.note(&local.book().id);
    let storage = release_edit_lock(&mut local);
    let signal = Arc::new(tokio::sync::Notify::new());
    server.hold_index_read(signal.clone());
    let (first, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        tokio::join!(
            repository.synchronize_saved(&storage, &local.workspace_id, &cancel),
            async {
                signal.notified().await;
                assert_eq!(
                    competing
                        .synchronize_saved(&storage, &local.workspace_id, &other_cancel)
                        .await
                        .err(),
                    Some(SyncError::Busy)
                );
                cancel.cancel();
            }
        )
    })
    .await
    .unwrap();
    assert_eq!(first.err(), Some(SyncError::Cancelled));
    assert!(server.object_put_paths().is_empty());
    assert!(server.index().is_none());
    server.release_index_read();
    competing
        .synchronize_saved(&storage, &local.workspace_id, &other_cancel)
        .await
        .unwrap();
    assert!(server.index().is_some());
    local.restart();
    assert_eq!(
        competing
            .synchronize_saved(&local.vault, &local.workspace_id, &other_cancel)
            .await
            .err(),
        Some(SyncError::LocalStorage),
        "a second caller must pass the unscoped Notes root"
    );
}

#[tokio::test]
async fn slow_webdav_allows_an_independent_editor_to_save_and_rejects_stale_apply() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repository = server.connect(key).await.unwrap();
    let cancel = CancellationToken::new();
    let mut local = Fixture::new();
    let book = local.book();
    let note = local.note(&book.id);
    let storage = release_edit_lock(&mut local);
    let signal = Arc::new(tokio::sync::Notify::new());
    server.hold_index_read(signal.clone());
    let (first, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        tokio::join!(
            repository.synchronize_saved(&storage, &local.workspace_id, &cancel),
            async {
                signal.notified().await;
                // Open a different scoped handle through the same lock path used by
                // ordinary Notes operations. The server is still waiting here.
                let editor = storage
                    .scoped(&local.workspace_id)
                    .expect("Notes editing lock is available");
                let saved = editor
                    .save_note(
                        &book.id,
                        &note.summary.id,
                        "并发更新",
                        "New local content",
                        vec![],
                        None,
                        &note.summary.version,
                    )
                    .unwrap();
                assert_eq!(saved.content, "New local content");
                drop(editor);
                assert!(server.index().is_none());
                server.release_index_read();
            }
        )
    })
    .await
    .unwrap();
    assert_eq!(first.err(), Some(SyncError::LocalChanged));
    assert!(server.index().is_some());
    local.restart();
    assert!(!scope_dir(&local.vault).join("baseline.zns").exists());
    assert_eq!(
        local
            .vault
            .get_note(&book.id, &note.summary.id)
            .unwrap()
            .content,
        "New local content"
    );
    let again = sync_fixture(&repository, &mut local, &cancel)
        .await
        .unwrap();
    assert!(matches!(again, SyncOutcome::Conflicts(_)));
    assert_eq!(
        local
            .vault
            .get_note(&book.id, &note.summary.id)
            .unwrap()
            .content,
        "New local content"
    );
}

#[tokio::test]
async fn saved_vaults_resume_the_encrypted_baseline_and_merge_independent_edits() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let first = server.configured(key).unwrap();
    let mut local = Fixture::new();
    let book = local.book();
    let first_note = local.note(&book.id);
    let second_note = local.note(&book.id);
    let cancel = CancellationToken::new();
    sync_fixture(&first, &mut local, &cancel).await.unwrap();
    let mut remote_copy = Fixture::new();
    let remote = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    sync_fixture(&remote, &mut remote_copy, &cancel)
        .await
        .unwrap();
    let baseline = scope_dir(&remote_copy.vault).join("baseline.zns");
    let before = fs::read(&baseline).unwrap();
    assert!(before.starts_with(b"ZNS1"));
    assert!(!before.windows(10).any(|part| part == b"generation"));
    drop(remote);
    remote_copy.restart();

    local
        .vault
        .save_note(
            &book.id,
            &first_note.summary.id,
            "First local edit",
            "Local content",
            vec![],
            None,
            &first_note.summary.version,
        )
        .unwrap();
    sync_fixture(&first, &mut local, &cancel).await.unwrap();
    remote_copy
        .vault
        .save_note(
            &book.id,
            &second_note.summary.id,
            "Other device edit",
            "Other content",
            vec![],
            None,
            &second_note.summary.version,
        )
        .unwrap();
    let reopened = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    assert!(matches!(
        sync_fixture(&reopened, &mut remote_copy, &cancel)
            .await
            .unwrap(),
        SyncOutcome::Synced { .. },
    ));
    let read = |fixture: &Fixture, id: &str| fixture.vault.get_note(&book.id, id).unwrap().content;
    assert_eq!(read(&remote_copy, &first_note.summary.id), "Local content");
    assert_eq!(read(&remote_copy, &second_note.summary.id), "Other content");
    assert_ne!(fs::read(&baseline).unwrap(), before);
    sync_fixture(&first, &mut local, &cancel).await.unwrap();
    assert_eq!(
        local.vault.capture_sync().unwrap().records,
        remote_copy.vault.capture_sync().unwrap().records
    );

    fs::write(&baseline, &before[..25]).unwrap();
    let requests = server.request_count();
    assert_eq!(
        sync_fixture(&reopened, &mut remote_copy, &cancel)
            .await
            .err(),
        Some(SyncError::Decryption)
    );
    assert_eq!(server.request_count(), requests);
    assert_eq!(read(&remote_copy, &second_note.summary.id), "Other content");
}

#[test]
fn vault_restart_publishes_baseline_only_for_a_committed_local_application() {
    use crate::notes_vault::sync::transaction::Run;
    use crate::notes_vault::BaselineUpdate;

    let mut recovered_uncommitted = false;
    let mut recovered_committed = false;
    for fail_at in 1..20 {
        let local = Fixture::new();
        let book = local.book();
        let note = local.note(&book.id);
        let mut target = Fixture::new();
        let captured = super::transfer(&local.vault, &target.vault);
        local
            .vault
            .save_note(
                &book.id,
                &note.summary.id,
                "After sync",
                "Incoming content",
                vec![],
                None,
                &note.summary.version,
            )
            .unwrap();
        let incoming = local.vault.capture_sync().unwrap();
        let scope = "a".repeat(64);
        let lease = target.vault.lock_sync_transfer(&scope).unwrap();
        let old_bytes = [b"ZNS1".as_slice(), &[3; 44]].concat();
        let new_bytes = [b"ZNS1".as_slice(), &[4; 44]].concat();
        let old = BaselineUpdate::new(&lease, old_bytes.clone());
        target
            .vault
            .apply_sync_baseline(&captured.revision, &captured.records, &old)
            .unwrap();
        let new = BaselineUpdate::new(&lease, new_bytes.clone());
        let Some(error) = target
            .vault
            .apply_inner(
                &captured.revision,
                &incoming.records,
                Some(&new),
                Run {
                    fail_at: Some(fail_at),
                    step: 0,
                },
            )
            .err()
        else {
            break;
        };
        assert_eq!(error.code, "test_interruption");
        let journals = fs::read_dir(target.vault.vaults_dir().join(".sync-transactions")).unwrap();
        let committed = journals
            .map(|entry| entry.unwrap().path())
            .any(|entry| entry.join("committed").is_file());
        assert_eq!(lease.baseline().unwrap().as_ref(), Some(&old_bytes));
        drop(lease);
        target.restart();
        let verified = target.vault.capture_sync().unwrap();
        let lease = target.vault.lock_sync_transfer(&scope).unwrap();
        if committed {
            assert_eq!(verified.records, incoming.records);
            assert_eq!(lease.baseline().unwrap(), Some(new_bytes));
            recovered_committed = true;
        } else {
            assert_eq!(verified.records, captured.records);
            assert_eq!(lease.baseline().unwrap(), Some(old_bytes));
            recovered_uncommitted = true;
        }
        if recovered_uncommitted && recovered_committed {
            break;
        }
    }
    assert!(recovered_uncommitted && recovered_committed);
}

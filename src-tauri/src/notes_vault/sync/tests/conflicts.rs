use super::*;
use crate::notes_sync::{tests::Server, SyncError, SyncKey, SyncOutcome, SyncRepository};
use crate::notes_vault::conflicts::{Choice, CopyLocale};
use std::collections::BTreeMap;
use tokio_util::sync::CancellationToken;

fn storage(fixture: &mut Fixture) -> NotesVault {
    fixture.vault.storage_guard = None;
    NotesVault::new(fixture.root.join("plugins")).unwrap()
}
async fn sync(
    repository: &SyncRepository,
    fixture: &mut Fixture,
) -> Result<SyncOutcome, SyncError> {
    let storage = storage(fixture);
    let result = repository
        .synchronize_saved(&storage, &fixture.workspace_id, &CancellationToken::new())
        .await;
    fixture.restart();
    result
}
fn edit(fixture: &Fixture, book: &str, note: &str, title: &str, body: &str) {
    let current = fixture.vault.get_note(book, note).unwrap();
    fixture
        .vault
        .save_note(
            book,
            note,
            title,
            body,
            vec![title.into()],
            None,
            &current.summary.version,
        )
        .unwrap();
}
struct Pair {
    server: Server,
    local_repo: SyncRepository,
    remote_repo: SyncRepository,
    local: Fixture,
    remote: Fixture,
    book: String,
    note: String,
    attachment: String,
    markdown: String,
}
impl Pair {
    async fn new() -> Self {
        let server = Server::start().await;
        let (key, recovery) = SyncKey::generate();
        let local_repo = server.configured(key).unwrap();
        let remote_repo = server
            .configured(SyncKey::from_recovery(&recovery).unwrap())
            .unwrap();
        let mut local = Fixture::new();
        let mut remote = Fixture::new();
        let book = local.book();
        let note = local.note(&book.id);
        let attachment = local
            .vault
            .store_attachment(
                &book.id,
                &note.summary.id,
                "proof.txt",
                "text/plain",
                b"original\0bytes",
            )
            .unwrap();
        let markdown = format!(
            "# Same page\n\n[self](#same-page)\n\n{}\n\n  original  \n",
            attachment.markdown
        );
        edit(&local, &book.id, &note.summary.id, "original", &markdown);
        assert!(matches!(
            sync(&local_repo, &mut local).await.unwrap(),
            SyncOutcome::Synced { .. }
        ));
        assert!(matches!(
            sync(&remote_repo, &mut remote).await.unwrap(),
            SyncOutcome::Synced { .. }
        ));
        Self {
            server,
            local_repo,
            remote_repo,
            local,
            remote,
            book: book.id,
            note: note.summary.id,
            attachment: attachment.id,
            markdown,
        }
    }
    async fn conflict(&mut self) -> Box<crate::notes_sync::PendingMerge> {
        assert!(matches!(
            sync(&self.remote_repo, &mut self.remote).await.unwrap(),
            SyncOutcome::Synced { .. }
        ));
        match sync(&self.local_repo, &mut self.local).await.unwrap() {
            SyncOutcome::Conflicts(pending) => pending,
            _ => panic!("real saved-note conflict expected"),
        }
    }
    fn choices(pending: &crate::notes_sync::PendingMerge) -> BTreeMap<String, Choice> {
        pending
            .conflicts
            .iter()
            .map(|entry| (entry.id.clone(), Choice::Both))
            .collect()
    }
}

#[tokio::test]
async fn both_real_note_versions_and_same_attachment_id_are_isolated_and_upload_only_on_next_manual_sync(
) {
    let mut pair = Pair::new().await;
    let local_body = pair.markdown.replace("original", "本地版本 🧪");
    let remote_body = pair
        .markdown
        .replace("original", "云端版本 <script>never execute</script>");
    edit(
        &pair.local,
        &pair.book,
        &pair.note,
        "Local title",
        &local_body,
    );
    edit(
        &pair.remote,
        &pair.book,
        &pair.note,
        "Cloud title",
        &remote_body,
    );
    for (fixture, bytes) in [
        (&pair.local, b"local\0attachment".as_slice()),
        (&pair.remote, b"cloud\0attachment".as_slice()),
    ] {
        fs::write(
            fixture
                .vault
                .vault_root(&pair.book)
                .unwrap()
                .join("public/attachments")
                .join(&pair.note)
                .join(&pair.attachment),
            bytes,
        )
        .unwrap();
    }
    let pending = pair.conflict().await;
    assert_eq!(pending.conflicts.len(), 2);
    let local_storage = storage(&mut pair.local);
    let requests = pair.server.request_count();
    let list = pair
        .local_repo
        .conflict_list(&local_storage, &pair.local.workspace_id, &pending, 0)
        .unwrap();
    assert_eq!(list.total, 2);
    assert!(list.next_cursor.is_none());
    let id = format!("note/{}/{}", pair.book, pair.note);
    let detail = pair
        .local_repo
        .conflict_detail(&local_storage, &pair.local.workspace_id, &pending, &id)
        .unwrap();
    assert_eq!(detail.local.text.as_deref(), Some(local_body.as_str()));
    assert_eq!(detail.remote.text.as_deref(), Some(remote_body.as_str()));
    let attachment_id = format!("attachment/{}/{}/{}", pair.book, pair.note, pair.attachment);
    let binary = pair
        .local_repo
        .conflict_detail(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &attachment_id,
        )
        .unwrap();
    assert!(binary.local.text.is_none() && binary.remote.text.is_none());
    assert_ne!(binary.local.sha256, binary.remote.sha256);
    let result = pair
        .local_repo
        .apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &Pair::choices(&pending),
            CopyLocale::ZhCn,
        )
        .unwrap();
    assert_eq!(result.copied_notes, 1);
    assert_eq!(result.copied_notebooks, 1);
    assert!(result.pending_upload);
    assert_eq!(
        pair.server.request_count(),
        requests,
        "review and apply never send a cloud request"
    );
    pair.local.restart();
    let copy = pair
        .local
        .vault
        .list_notebooks()
        .unwrap()
        .into_iter()
        .find(|book| book.id != pair.book)
        .unwrap();
    assert!(copy.title.ends_with("云端冲突副本"));
    let original = pair.local.vault.get_note(&pair.book, &pair.note).unwrap();
    let copied = pair.local.vault.get_note(&copy.id, &pair.note).unwrap();
    assert_eq!(original.content, local_body);
    assert_eq!(copied.content, remote_body);
    assert_eq!(original.summary.title, "Local title");
    assert_eq!(copied.summary.title, "Cloud title");
    assert_eq!(
        pair.local
            .vault
            .read_attachment(&pair.book, &pair.note, &pair.attachment)
            .unwrap()
            .0,
        b"local\0attachment"
    );
    assert_eq!(
        pair.local
            .vault
            .read_attachment(&copy.id, &pair.note, &pair.attachment)
            .unwrap()
            .0,
        b"cloud\0attachment"
    );
    assert!(matches!(
        sync(&pair.local_repo, &mut pair.local).await.unwrap(),
        SyncOutcome::Synced { .. }
    ));
    assert!(matches!(
        sync(&pair.remote_repo, &mut pair.remote).await.unwrap(),
        SyncOutcome::Synced { .. }
    ));
    assert_eq!(
        pair.remote
            .vault
            .get_note(&pair.book, &pair.note)
            .unwrap()
            .content,
        local_body
    );
    assert_eq!(
        pair.remote
            .vault
            .get_note(&copy.id, &pair.note)
            .unwrap()
            .content,
        remote_body
    );
    assert_eq!(
        pair.remote
            .vault
            .read_attachment(&copy.id, &pair.note, &pair.attachment)
            .unwrap()
            .0,
        b"cloud\0attachment"
    );
}

#[tokio::test]
async fn edit_delete_conflicts_keep_the_deletion_and_a_readable_edited_copy_in_either_direction() {
    for local_deleted in [true, false] {
        let mut pair = Pair::new().await;
        let (deleted, edited) = if local_deleted {
            (&pair.local, &pair.remote)
        } else {
            (&pair.remote, &pair.local)
        };
        let note = deleted.vault.get_note(&pair.book, &pair.note).unwrap();
        deleted
            .vault
            .delete_note(&pair.book, &pair.note, &note.summary.version)
            .unwrap();
        edit(
            edited,
            &pair.book,
            &pair.note,
            "edited survivor",
            "  edited body\n\n",
        );
        let pending = pair.conflict().await;
        let local_storage = storage(&mut pair.local);
        let result = pair
            .local_repo
            .apply_saved_choices(
                &local_storage,
                &pair.local.workspace_id,
                &pending,
                &Pair::choices(&pending),
                CopyLocale::En,
            )
            .unwrap();
        assert_eq!(result.copied_notes, 1);
        assert!(result.pending_upload);
        pair.local.restart();
        assert!(pair.local.vault.get_note(&pair.book, &pair.note).is_err());
        assert!(pair
            .local
            .vault
            .list_trash(Some(&pair.book))
            .unwrap()
            .iter()
            .any(|entry| entry.note.id == pair.note));
        let copy = pair
            .local
            .vault
            .list_notebooks()
            .unwrap()
            .into_iter()
            .find(|book| book.id != pair.book)
            .unwrap();
        assert_eq!(
            pair.local
                .vault
                .get_note(&copy.id, &pair.note)
                .unwrap()
                .content,
            "  edited body\n\n"
        );
        assert_eq!(
            pair.local
                .vault
                .read_attachment(&copy.id, &pair.note, &pair.attachment)
                .unwrap()
                .0,
            b"original\0bytes"
        );
    }
}

#[tokio::test]
async fn purged_note_and_new_edits_are_preserved_without_reviving_the_deleted_identity() {
    let mut pair = Pair::new().await;
    let note = pair.local.vault.get_note(&pair.book, &pair.note).unwrap();
    pair.local
        .vault
        .delete_note(&pair.book, &pair.note, &note.summary.version)
        .unwrap();
    pair.local.vault.purge_note(&pair.book, &pair.note).unwrap();
    edit(
        &pair.remote,
        &pair.book,
        &pair.note,
        "cloud survivor",
        "cloud body",
    );
    let pending = pair.conflict().await;
    let local_storage = storage(&mut pair.local);
    pair.local_repo
        .apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &Pair::choices(&pending),
            CopyLocale::En,
        )
        .unwrap();
    pair.local.restart();
    assert!(pair.local.vault.get_note(&pair.book, &pair.note).is_err());
    let copy = pair
        .local
        .vault
        .list_notebooks()
        .unwrap()
        .into_iter()
        .find(|book| book.id != pair.book)
        .unwrap();
    assert_eq!(
        pair.local
            .vault
            .get_note(&copy.id, &pair.note)
            .unwrap()
            .content,
        "cloud body"
    );
}

#[tokio::test]
async fn incomplete_unknown_and_stale_choices_never_apply_or_publish() {
    let mut pair = Pair::new().await;
    edit(&pair.local, &pair.book, &pair.note, "local", "local body");
    edit(
        &pair.remote,
        &pair.book,
        &pair.note,
        "remote",
        "remote body",
    );
    let pending = pair.conflict().await;
    let original = pair.local.vault.capture_sync().unwrap().records;
    let local_storage = storage(&mut pair.local);
    let requests = pair.server.request_count();
    for choices in [
        BTreeMap::new(),
        BTreeMap::from([("note/not-authorized".into(), Choice::Both)]),
    ] {
        assert!(matches!(
            pair.local_repo.apply_saved_choices(
                &local_storage,
                &pair.local.workspace_id,
                &pending,
                &choices,
                CopyLocale::En
            ),
            Err(SyncError::InvalidData)
        ));
    }
    pair.local.restart();
    assert_eq!(pair.local.vault.capture_sync().unwrap().records, original);
    edit(
        &pair.local,
        &pair.book,
        &pair.note,
        "latest local",
        "must survive review",
    );
    let latest = pair.local.vault.capture_sync().unwrap().records;
    let local_storage = storage(&mut pair.local);
    assert!(matches!(
        pair.local_repo
            .conflict_list(&local_storage, &pair.local.workspace_id, &pending, 0),
        Err(SyncError::LocalChanged)
    ));
    assert!(matches!(
        pair.local_repo.apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &Pair::choices(&pending),
            CopyLocale::En
        ),
        Err(SyncError::LocalChanged)
    ));
    assert_eq!(pair.server.request_count(), requests);
    pair.local.restart();
    assert_eq!(pair.local.vault.capture_sync().unwrap().records, latest);
}

#[tokio::test]
async fn replacement_transfer_identity_and_write_failures_preserve_complete_saved_versions() {
    let mut pair = Pair::new().await;
    edit(&pair.local, &pair.book, &pair.note, "local", "local body");
    edit(
        &pair.remote,
        &pair.book,
        &pair.note,
        "remote",
        "remote body",
    );
    pair.remote
        .vault
        .create_note(
            &pair.book,
            "independent sibling",
            "non-conflicting remote edit",
            vec![],
            None,
            None,
        )
        .unwrap();
    let pending = pair.conflict().await;
    let original = pair.local.vault.capture_sync().unwrap();
    let desired = crate::notes_vault::conflicts::resolve(
        &pending,
        &original.records,
        &Pair::choices(&pending),
        CopyLocale::En,
    )
    .unwrap()
    .records;
    let mut rolled_back = 0;
    let mut committed = 0;
    for step in 1..=128 {
        let mut candidate = Fixture::new();
        transfer(&pair.local.vault, &candidate.vault);
        let before = candidate.vault.capture_sync().unwrap();
        let result = candidate.vault.apply_sync_inner(
            &before.revision,
            &desired,
            transaction::Run {
                fail_at: Some(step),
                ..Default::default()
            },
        );
        assert!(result.is_err(), "failure hook {step} did not execute");
        candidate.restart();
        let after = candidate.vault.capture_sync().unwrap();
        if after.records == before.records {
            rolled_back += 1;
        } else if after.records == desired {
            committed += 1; break;
        }
        assert!(
            after.records == before.records || after.records == desired,
            "failed step {step} exposed a partial version"
        );
    }
    assert!(
        rolled_back > 0 && committed > 0,
        "cover rollback and durable-commit recovery"
    );
    let root = pair.local.vault.vaults_dir();
    let transfers = root.join(".sync-transfers");
    let scope = fs::read_dir(&transfers)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let local_storage = storage(&mut pair.local);
    fs::rename(
        scope.join("transfer.lock"),
        scope.join("original-transfer.lock"),
    )
    .unwrap();
    fs::write(scope.join("transfer.lock"), b"").unwrap();
    assert!(matches!(
        pair.local_repo.apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &Pair::choices(&pending),
            CopyLocale::En
        ),
        Err(SyncError::LocalChanged)
    ));
    pair.local.restart();
    assert_eq!(
        pair.local.vault.capture_sync().unwrap().records,
        original.records
    );
}

#[tokio::test]
async fn notebook_deletion_conflict_requires_safe_both_and_keeps_the_complete_active_copy() {
    let mut pair = Pair::new().await;
    let metadata = pair
        .local
        .vault
        .vault_root(&pair.book)
        .unwrap()
        .join(".zicode/vault.json");
    let mut value: Value = serde_json::from_slice(&fs::read(&metadata).unwrap()).unwrap();
    value["title"] = json!("Local renamed notebook");
    fs::write(metadata, serde_json::to_vec(&value).unwrap()).unwrap();
    pair.remote.vault.delete_notebook(&pair.book).unwrap();
    let pending = pair.conflict().await;
    let local_storage = storage(&mut pair.local);
    let listed = pair
        .local_repo
        .conflict_list(&local_storage, &pair.local.workspace_id, &pending, 0)
        .unwrap();
    assert!(listed
        .rows
        .iter()
        .all(|row| row.allowed_choices == vec![Choice::Both]));
    let forbidden = pending
        .conflicts
        .iter()
        .map(|entry| (entry.id.clone(), Choice::Local))
        .collect();
    assert!(matches!(
        pair.local_repo.apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &forbidden,
            CopyLocale::En
        ),
        Err(SyncError::InvalidData)
    ));
    pair.local_repo
        .apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &Pair::choices(&pending),
            CopyLocale::En,
        )
        .unwrap();
    pair.local.restart();
    assert!(pair.local.vault.get_note(&pair.book, &pair.note).is_err());
    let copies = pair.local.vault.list_notebooks().unwrap();
    assert_eq!(copies.len(), 1);
    assert!(copies[0].title.starts_with("Local renamed notebook"));
    assert_eq!(
        pair.local
            .vault
            .get_note(&copies[0].id, &pair.note)
            .unwrap()
            .content,
        pair.markdown
    );
    assert_eq!(
        pair.local
            .vault
            .read_attachment(&copies[0].id, &pair.note, &pair.attachment)
            .unwrap()
            .0,
        b"original\0bytes"
    );
}

#[tokio::test]
async fn orphan_attachment_choices_create_accessible_independent_notes_for_both_byte_versions() {
    let mut pair = Pair::new().await;
    let note = pair.remote.vault.get_note(&pair.book, &pair.note).unwrap();
    pair.remote
        .vault
        .delete_note(&pair.book, &pair.note, &note.summary.version)
        .unwrap();
    pair.remote
        .vault
        .purge_note(&pair.book, &pair.note)
        .unwrap();
    for (fixture, bytes) in [
        (&pair.local, b"local orphan\0file".as_slice()),
        (&pair.remote, b"remote orphan\0file".as_slice()),
    ] {
        let root = fixture
            .vault
            .vault_root(&pair.book)
            .unwrap()
            .join("public/attachments")
            .join(&pair.note);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join(&pair.attachment), bytes).unwrap();
    }
    let pending = pair.conflict().await;
    assert!(pending
        .conflicts
        .iter()
        .all(|entry| entry.id.starts_with("attachment/")));
    let local_storage = storage(&mut pair.local);
    let result = pair
        .local_repo
        .apply_saved_choices(
            &local_storage,
            &pair.local.workspace_id,
            &pending,
            &Pair::choices(&pending),
            CopyLocale::En,
        )
        .unwrap();
    assert_eq!(result.copied_notes, 2);
    assert_eq!(result.copied_notebooks, 2);
    pair.local.restart();
    assert!(pair.local.vault.get_note(&pair.book, &pair.note).is_err());
    let mut versions = Vec::new();
    for book in pair
        .local
        .vault
        .list_notebooks()
        .unwrap()
        .into_iter()
        .filter(|book| book.id != pair.book)
    {
        let note = pair.local.vault.get_note(&book.id, &pair.note).unwrap();
        assert!(note.content.contains(&pair.attachment));
        versions.push(
            pair.local
                .vault
                .read_attachment(&book.id, &pair.note, &pair.attachment)
                .unwrap()
                .0,
        );
    }
    versions.sort();
    let mut expected = vec![
        b"local orphan\0file".to_vec(),
        b"remote orphan\0file".to_vec(),
    ];
    expected.sort();
    assert_eq!(versions, expected);
}

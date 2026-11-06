use super::*;

#[tokio::test]
async fn encrypted_http_sync_between_two_actual_vaults_merges_independent_saved_edits() {
    use crate::notes_sync::{Manifest, SyncKey, SyncOutcome};
    let server = crate::notes_sync::tests::Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let repo_a = server.connect(key).await.unwrap();
    let repo_b = server
        .connect(SyncKey::from_recovery(&recovery).unwrap())
        .await
        .unwrap();
    let a = Fixture::new();
    let b = Fixture::new();
    let book = a.book();
    let first = a.note(&book.id);
    let second = a.note(&book.id);
    let empty = Manifest::empty(crate::notes_sync::tests::VAULT).unwrap();
    let local_a = a.vault.capture_sync().unwrap();
    let SyncOutcome::Synced {
        manifest: base_a, ..
    } = repo_a.synchronize(&empty, &local_a.records).await.unwrap()
    else {
        panic!("Initial sync conflict")
    };
    let local_b = b.vault.capture_sync().unwrap();
    let SyncOutcome::Synced {
        manifest: base_b,
        snapshot: downloaded,
    } = repo_b.synchronize(&empty, &local_b.records).await.unwrap()
    else {
        panic!("Initial download conflict")
    };
    b.vault.apply_sync(&local_b.revision, &downloaded).unwrap();
    a.vault
        .save_note(
            &book.id,
            &first.summary.id,
            "A edited",
            "A new content",
            vec![],
            None,
            &first.summary.version,
        )
        .unwrap();
    b.vault
        .save_note(
            &book.id,
            &second.summary.id,
            "B edited",
            "B new content",
            vec![],
            None,
            &second.summary.version,
        )
        .unwrap();
    let edited_a = a.vault.capture_sync().unwrap();
    let SyncOutcome::Synced { .. } = repo_a
        .synchronize(&base_a, &edited_a.records)
        .await
        .unwrap()
    else {
        panic!("A sync conflict")
    };
    let edited_b = b.vault.capture_sync().unwrap();
    let SyncOutcome::Synced {
        snapshot: merged, ..
    } = repo_b
        .synchronize(&base_b, &edited_b.records)
        .await
        .unwrap()
    else {
        panic!("Independent notes must merge despite local notebook timestamps")
    };
    b.vault.apply_sync(&edited_b.revision, &merged).unwrap();
    assert_eq!(
        b.vault
            .get_note(&book.id, &first.summary.id)
            .unwrap()
            .content,
        "A new content"
    );
    assert_eq!(
        b.vault
            .get_note(&book.id, &second.summary.id)
            .unwrap()
            .content,
        "B new content"
    );
    assert_eq!(b.vault.capture_sync().unwrap().records, merged);
}

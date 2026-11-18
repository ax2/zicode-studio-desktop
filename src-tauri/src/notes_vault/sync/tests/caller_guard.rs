use super::*;
use crate::notes_sync::{tests::Server, SyncError, SyncKey};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn stale_caller_configuration_sends_no_requests_or_changes_to_saved_notes() {
    let server = Server::start().await;
    let repository = server
        .configured(SyncKey::generate().0)
        .unwrap()
        .with_guard(|| Err(SyncError::ConfigurationChanged));
    let mut fixture = Fixture::new();
    fixture.note(&fixture.book().id);
    let original = fixture.vault.capture_sync().unwrap().records;
    fixture.vault.storage_guard = None;
    let storage = NotesVault::new(fixture.root.join("plugins")).unwrap();
    assert_eq!(
        repository
            .synchronize_saved(&storage, &fixture.workspace_id, &CancellationToken::new())
            .await
            .err(),
        Some(SyncError::ConfigurationChanged)
    );
    assert_eq!(server.request_count(), 0);
    fixture.restart();
    assert_eq!(fixture.vault.capture_sync().unwrap().records, original);
}

#[tokio::test]
async fn configuration_changed_during_network_rejects_old_apply_then_manual_retry_recovers() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let current = Arc::new(AtomicBool::new(true));
    let check = current.clone();
    let repository = server.configured(key).unwrap().with_guard(move || {
        if check.load(Ordering::SeqCst) {
            Ok(Box::new(()) as Box<dyn Send>)
        } else {
            Err(SyncError::ConfigurationChanged)
        }
    });
    let mut fixture = Fixture::new();
    fixture.note(&fixture.book().id);
    let original = fixture.vault.capture_sync().unwrap().records;
    fixture.vault.storage_guard = None;
    let storage = NotesVault::new(fixture.root.join("plugins")).unwrap();
    let signal = Arc::new(tokio::sync::Notify::new());
    server.hold_index_read(signal.clone());
    let cancel = CancellationToken::new();
    let (result, ()) = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        tokio::join!(
            repository.synchronize_saved(&storage, &fixture.workspace_id, &cancel),
            async {
                signal.notified().await;
                current.store(false, Ordering::SeqCst);
                server.release_index_read();
            }
        )
    })
    .await
    .unwrap();
    assert_eq!(result.err(), Some(SyncError::ConfigurationChanged));
    assert!(
        server.index().is_some(),
        "already approved requests may commit remotely before configuration changes are observed"
    );
    fixture.restart();
    assert_eq!(fixture.vault.capture_sync().unwrap().records, original);
    fixture.vault.storage_guard = None;
    let retry = server
        .configured(SyncKey::from_recovery(&recovery).unwrap())
        .unwrap();
    retry
        .synchronize_saved(&storage, &fixture.workspace_id, &CancellationToken::new())
        .await
        .unwrap();
    fixture.restart();
    assert_eq!(fixture.vault.capture_sync().unwrap().records, original);
}

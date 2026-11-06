use super::*;

#[tokio::test]
async fn two_clients_sync_notebook_note_and_binary_attachment_without_plaintext_on_server() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let first = server.connect(key).await.unwrap();
    let second = server
        .connect(SyncKey::from_recovery(&recovery).unwrap())
        .await
        .unwrap();
    let original = snapshot(&[
        ("notebook/one", b"private-notebook-title"),
        ("note/one", b"private-note-body"),
        ("attachment/one", &[0, 255, 42, 1]),
    ]);
    let (base_a, saved_a) = synced(
        first
            .synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let (base_b, saved_b) = synced(
        second
            .synchronize(&Manifest::empty(VAULT).unwrap(), &Snapshot::new())
            .await,
    );
    assert_eq!(saved_a, saved_b);
    assert_eq!(base_a, base_b);
    assert_eq!(saved_b, original);
    let state = server.state.lock().unwrap();
    assert!(!state.files.keys().any(|p| p.contains("probe-")));
    for bytes in state.files.values() {
        assert!(!bytes.windows(12).any(|w| w == b"private-note"));
        assert!(!bytes.windows(8).any(|w| w == b"note/one"));
    }
    assert!(!state
        .requests
        .iter()
        .any(|(method, _)| method == "PROPFIND"));
}

#[tokio::test]
async fn concurrent_independent_edits_merge_and_noop_does_not_reupload() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let a = server.connect(key).await.unwrap();
    let b = server
        .connect(SyncKey::from_recovery(&recovery).unwrap())
        .await
        .unwrap();
    let original = snapshot(&[("note/a", b"original-a"), ("note/b", b"original-b")]);
    let (base, _) = synced(
        a.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let local_a = snapshot(&[("note/a", b"edited-a"), ("note/b", b"original-b")]);
    synced(a.synchronize(&base, &local_a).await);
    let local_b = snapshot(&[("note/a", b"original-a"), ("note/b", b"edited-b")]);
    let (merged_base, merged) = synced(b.synchronize(&base, &local_b).await);
    assert_eq!(
        merged,
        snapshot(&[("note/a", b"edited-a"), ("note/b", b"edited-b")])
    );
    let writes = server.writes();
    synced(b.synchronize(&merged_base, &merged).await);
    assert_eq!(server.writes(), writes);
}

#[tokio::test]
async fn concurrent_same_note_preserves_both_payloads_and_does_not_commit() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"original")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    synced(
        repo.synchronize(&base, &snapshot(&[("note/a", b"remote edit")]))
            .await,
    );
    let index = server.index();
    let writes = server.writes();
    let result = repo
        .synchronize(&base, &snapshot(&[("note/a", b"local edit")]))
        .await
        .unwrap();
    let SyncOutcome::Conflicts(conflicts) = result else {
        panic!("Conflict expected")
    };
    let conflicts = conflicts.conflicts;
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts[0].id, "note/a");
    assert_eq!(
        conflicts[0].local.as_deref(),
        Some(b"local edit".as_slice())
    );
    assert_eq!(
        conflicts[0].remote.as_deref(),
        Some(b"remote edit".as_slice())
    );
    assert_eq!(server.index(), index);
    assert_eq!(server.writes(), writes);
}

#[tokio::test]
async fn tombstone_prevents_offline_resurrection_and_concurrent_edit_is_conflict() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"original")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let (deleted_base, deleted) = synced(repo.synchronize(&base, &Snapshot::new()).await);
    assert!(deleted.is_empty());
    assert_eq!(deleted_base.entries.get("note/a"), Some(&None));
    let (_, offline) = synced(repo.synchronize(&base, &original).await);
    assert!(offline.is_empty());
    let SyncOutcome::Conflicts(conflicts) = repo
        .synchronize(&base, &snapshot(&[("note/a", b"edited offline")]))
        .await
        .unwrap()
    else {
        panic!("Conflict expected")
    };
    let conflicts = conflicts.conflicts;
    assert!(conflicts[0].remote.is_none());
    assert_eq!(
        conflicts[0].local.as_deref(),
        Some(b"edited offline".as_slice())
    );
    // A client that has observed the tombstone can explicitly restore the saved record.
    let (_, restored) = synced(repo.synchronize(&deleted_base, &original).await);
    assert_eq!(restored, original);
}

#[tokio::test]
async fn two_simultaneous_clients_cannot_overwrite_each_other_and_retry_merges() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let a = server.connect(key).await.unwrap();
    let b = server
        .connect(SyncKey::from_recovery(&recovery).unwrap())
        .await
        .unwrap();
    let original = snapshot(&[("note/a", b"a0"), ("note/b", b"b0")]);
    let (base, _) = synced(
        a.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let a_edit = snapshot(&[("note/a", b"a1"), ("note/b", b"b0")]);
    let b_edit = snapshot(&[("note/a", b"a0"), ("note/b", b"b1")]);
    server.state.lock().unwrap().read_gate = Some(Arc::new(tokio::sync::Barrier::new(2)));
    let (result_a, result_b) =
        tokio::join!(a.synchronize(&base, &a_edit), b.synchronize(&base, &b_edit));
    server.state.lock().unwrap().read_gate = None;
    let lost_a = matches!(result_a, Err(SyncError::RemoteChanged));
    let lost_b = matches!(result_b, Err(SyncError::RemoteChanged));
    assert_ne!(lost_a, lost_b, "Exactly one conditional write must fail");
    let (_, merged) = if lost_a {
        synced(a.synchronize(&base, &a_edit).await)
    } else {
        synced(b.synchronize(&base, &b_edit).await)
    };
    assert_eq!(merged, snapshot(&[("note/a", b"a1"), ("note/b", b"b1")]));
}

#[tokio::test]
async fn unpaired_copy_cannot_resurrect_a_known_cloud_tombstone() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let empty = Manifest::empty(VAULT).unwrap();
    let original = snapshot(&[("note/a", b"old copy")]);
    let (base, _) = synced(repo.synchronize(&empty, &original).await);
    synced(repo.synchronize(&base, &Snapshot::new()).await);
    let before = server.index();
    let SyncOutcome::Conflicts(conflicts) = repo.synchronize(&empty, &original).await.unwrap()
    else {
        panic!("A cloud tombstone must not be implicitly undone")
    };
    let conflicts = conflicts.conflicts;
    assert_eq!(conflicts.len(), 1);
    assert!(conflicts[0].remote.is_none());
    assert_eq!(server.index(), before);
}

#[tokio::test]
async fn same_creation_on_two_clients_converges_but_different_creation_conflicts() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let empty = Manifest::empty(VAULT).unwrap();
    let first = snapshot(&[("note/a", b"same")]);
    synced(repo.synchronize(&empty, &first).await);
    let writes = server.writes();
    let (_, result) = synced(repo.synchronize(&empty, &first).await);
    assert_eq!(result, first);
    assert_eq!(server.writes(), writes);
    assert!(matches!(
        repo.synchronize(&empty, &snapshot(&[("note/a", b"different")]))
            .await
            .unwrap(),
        SyncOutcome::Conflicts(_)
    ));
}

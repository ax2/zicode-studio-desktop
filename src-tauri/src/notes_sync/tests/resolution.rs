use super::*;

async fn conflict_fixture() -> (Server, SyncRepository, Box<PendingMerge>) {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"original"), ("note/b", b"unchanged")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    synced(
        repo.synchronize(
            &base,
            &snapshot(&[("note/a", b"remote"), ("note/b", b"unchanged")]),
        )
        .await,
    );
    let local = snapshot(&[("note/a", b"local"), ("note/b", b"independent local edit")]);
    let SyncOutcome::Conflicts(pending) = repo.synchronize(&base, &local).await.unwrap() else {
        panic!("Conflict expected")
    };
    (server, repo, pending)
}

#[tokio::test]
async fn explicit_choice_resolves_conflict_and_preserves_other_local_edits() {
    for (choice, expected) in [
        (ConflictChoice::Local, b"local".as_slice()),
        (ConflictChoice::Remote, b"remote".as_slice()),
    ] {
        let (_server, repo, pending) = conflict_fixture().await;
        let choices = BTreeMap::from([("note/a".into(), choice)]);
        let (base, resolved) = pending.resolve(&choices).unwrap();
        let (_, result) = synced(repo.synchronize(&base, &resolved).await);
        assert_eq!(result["note/a"], expected);
        assert_eq!(result["note/b"], b"independent local edit");
    }
}

#[tokio::test]
async fn missing_or_unknown_conflict_choices_cannot_implicitly_delete_a_note() {
    let (server, _repo, pending) = conflict_fixture().await;
    let before = server.index();
    assert!(matches!(
        pending.resolve(&BTreeMap::new()),
        Err(SyncError::InvalidData)
    ));
    assert!(matches!(
        pending.resolve(&BTreeMap::from([(
            "other-note".into(),
            ConflictChoice::Local
        )])),
        Err(SyncError::InvalidData)
    ));
    assert_eq!(server.index(), before);
    assert_eq!(
        pending.conflicts[0].local.as_deref(),
        Some(b"local".as_slice())
    );
}

#[tokio::test]
async fn new_remote_edit_after_resolution_returns_another_conflict_without_overwrite() {
    let (server, repo, pending) = conflict_fixture().await;
    let (base, resolved) = pending
        .resolve(&BTreeMap::from([("note/a".into(), ConflictChoice::Local)]))
        .unwrap();
    let third = snapshot(&[("note/a", b"new remote edit"), ("note/b", b"unchanged")]);
    synced(repo.synchronize(&base, &third).await);
    let before = server.index();
    let SyncOutcome::Conflicts(again) = repo.synchronize(&base, &resolved).await.unwrap() else {
        panic!("New conflict expected")
    };
    assert_eq!(
        again.conflicts[0].remote.as_deref(),
        Some(b"new remote edit".as_slice())
    );
    assert_eq!(
        again.conflicts[0].local.as_deref(),
        Some(b"local".as_slice())
    );
    assert_eq!(server.index(), before);
}

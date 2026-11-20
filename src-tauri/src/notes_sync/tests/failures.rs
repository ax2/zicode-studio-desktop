use super::*;

#[tokio::test]
async fn object_or_index_failure_keeps_previous_index_and_restart_can_retry() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"original")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let before = server.index();
    let edited = snapshot(&[("note/a", b"edited")]);
    server.state.lock().unwrap().fail_object = true;
    assert!(matches!(
        repo.synchronize(&base, &edited).await,
        Err(SyncError::Http(500))
    ));
    assert_eq!(server.index(), before);
    server.state.lock().unwrap().fail_object = false;
    server.state.lock().unwrap().fail_index = true;
    assert!(matches!(
        repo.synchronize(&base, &edited).await,
        Err(SyncError::Http(500))
    ));
    assert_eq!(server.index(), before);
    server.state.lock().unwrap().fail_index = false;
    drop(repo);
    // Persisted baseline is serializable and remains sufficient after a process restart.
    let baseline: Manifest = serde_json::from_slice(&serde_json::to_vec(&base).unwrap()).unwrap();
    let restarted = server
        .connect(SyncKey::from_recovery(&recovery).unwrap())
        .await
        .unwrap();
    let (_, result) = synced(restarted.synchronize(&baseline, &edited).await);
    assert_eq!(result, edited);
}

#[tokio::test]
async fn committed_but_failed_response_is_idempotent_on_retry() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let base = Manifest::empty(VAULT).unwrap();
    let local = snapshot(&[("note/a", b"saved")]);
    server.state.lock().unwrap().lose_commit_response = true;
    assert!(matches!(
        repo.synchronize(&base, &local).await,
        Err(SyncError::Http(500))
    ));
    assert!(server.index().is_some());
    let writes = server.writes();
    let (_, result) = synced(repo.synchronize(&base, &local).await);
    assert_eq!(local, result);
    assert_eq!(server.writes(), writes);
}

#[tokio::test]
async fn remote_race_is_reported_without_overwriting_index() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"original")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let before = server.index();
    server.state.lock().unwrap().race_index = true;
    assert!(matches!(
        repo.synchronize(&base, &snapshot(&[("note/a", b"edited")]))
            .await,
        Err(SyncError::RemoteChanged)
    ));
    assert_eq!(server.index(), before);
}

#[tokio::test]
async fn bad_conditional_server_or_weak_etag_is_rejected_before_index_write() {
    for weak in [false, true] {
        let server = Server::start().await;
        if weak {
            server.state.lock().unwrap().weak_etags = true;
        } else {
            server.state.lock().unwrap().ignore_conditions = true;
        }
        let (key, _) = SyncKey::generate();
        assert!(matches!(
            server.connect(key).await,
            Err(SyncError::UnsupportedServer)
        ));
        assert_eq!(server.writes(), 0);
    }
}

#[tokio::test]
async fn authentication_and_rate_limit_have_bounded_safe_errors_without_retries() {
    for (status, expected) in [
        (401, SyncError::Authentication),
        (403, SyncError::Authentication),
        (
            429,
            SyncError::RateLimited {
                retry_after_seconds: 123,
            },
        ),
        (
            503,
            SyncError::RateLimited {
                retry_after_seconds: 123,
            },
        ),
    ] {
        let server = Server::start().await;
        server.state.lock().unwrap().status = Some(status);
        let (key, _) = SyncKey::generate();
        let result = server.connect(key).await;
        assert!(matches!(result, Err(ref error) if *error == expected));
        assert_eq!(server.state.lock().unwrap().requests.len(), 1);
    }
}

#[tokio::test]
async fn redirects_are_not_followed_and_credentials_never_reach_other_server() {
    let source = Server::start().await;
    let other = Server::start().await;
    source.state.lock().unwrap().redirect = Some(other.url.clone());
    let (key, _) = SyncKey::generate();
    assert!(matches!(
        source.connect(key).await,
        Err(SyncError::Http(307))
    ));
    assert!(other.state.lock().unwrap().requests.is_empty());
}

#[tokio::test]
async fn deleted_index_or_rollback_is_not_silently_recreated() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"original")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let old = server.index().unwrap();
    let (new_base, new_local) = synced(
        repo.synchronize(&base, &snapshot(&[("note/a", b"new")]))
            .await,
    );
    server.state.lock().unwrap().files.insert(index_path(), old);
    assert!(matches!(
        repo.synchronize(&new_base, &new_local).await,
        Err(SyncError::RemoteReset)
    ));
    server.state.lock().unwrap().files.remove(&index_path());
    assert!(matches!(
        repo.synchronize(&new_base, &new_local).await,
        Err(SyncError::RemoteReset)
    ));
    assert!(server.index().is_none());
}

#[tokio::test]
async fn wrong_key_corrupted_or_missing_objects_never_apply_or_commit() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let original = snapshot(&[("note/a", b"private")]);
    let (base, _) = synced(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &original)
            .await,
    );
    let before = server.index();
    let (wrong, _) = SyncKey::generate();
    let wrong_repo = server.connect(wrong).await.unwrap();
    assert!(matches!(
        wrong_repo
            .synchronize(&Manifest::empty(VAULT).unwrap(), &Snapshot::new())
            .await,
        Err(SyncError::Decryption)
    ));
    let path = format!(
        "/dav/zicode-notes/{VAULT}/objects/{}",
        base.entries["note/a"].as_ref().unwrap().object_hash
    );
    server
        .state
        .lock()
        .unwrap()
        .files
        .insert(path.clone(), b"damaged".to_vec());
    assert!(matches!(
        repo.synchronize(&base, &original).await,
        Err(SyncError::InvalidData)
    ));
    server.state.lock().unwrap().files.remove(&path);
    assert!(matches!(
        repo.synchronize(&base, &original).await,
        Err(SyncError::InvalidData)
    ));
    assert_eq!(server.index(), before);
}

#[tokio::test]
async fn invalid_configuration_and_oversize_records_stop_before_upload() {
    let server = Server::start().await;
    for endpoint in [
        "http://example.com/dav/",
        "https://user:password@example.com/",
        "https://example.com/?q=1",
        "https://example.com/#secret",
    ] {
        let (key, _) = SyncKey::generate();
        assert!(matches!(
            SyncRepository::connect(
                endpoint,
                "fixture-user".into(),
                "fixture-password".into(),
                VAULT,
                key
            )
            .await,
            Err(SyncError::InvalidConfig)
        ));
    }
    assert!(server.state.lock().unwrap().requests.is_empty());
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let count = server.state.lock().unwrap().requests.len();
    let huge = snapshot(&[("note/a", &vec![0; MAX_OBJECT_BYTES + 1])]);
    assert!(matches!(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &huge)
            .await,
        Err(SyncError::TooLarge)
    ));
    assert_eq!(server.state.lock().unwrap().requests.len(), count);
}

#[tokio::test]
async fn oversized_remote_index_is_rejected_before_decryption_or_object_requests() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    server
        .state
        .lock()
        .unwrap()
        .files
        .insert(index_path(), vec![0; MAX_INDEX_BYTES + 45]);
    assert!(matches!(
        repo.synchronize(&Manifest::empty(VAULT).unwrap(), &Snapshot::new())
            .await,
        Err(SyncError::TooLarge)
    ));
    assert_eq!(server.writes(), 0);
    assert!(!server
        .state
        .lock()
        .unwrap()
        .requests
        .iter()
        .any(|(_, p)| p.contains("/objects/") && !p.ends_with("/objects/")));
}

#[tokio::test]
async fn incompatible_manifest_and_invalid_object_reference_fail_closed() {
    let server = Server::start().await;
    let (key, recovery) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let fixture_key = SyncKey::from_recovery(&recovery).unwrap();
    let mut manifest = Manifest::empty(VAULT).unwrap();
    for case in 0..4 {
        manifest.schema = if case == 0 { 2 } else { 1 };
        manifest.vault_id = if case == 1 {
            "b27199ee-84e0-4638-ad5f-e040bd699fe0".into()
        } else {
            VAULT.into()
        };
        manifest.entries.clear();
        if case == 2 {
            manifest.entries.insert(
                "note/a".into(),
                Some(model::ObjectRef {
                    content_hash: "bad".into(),
                    object_hash: "../bad".into(),
                }),
            );
        }
        let bytes = if case == 3 {
            b"not JSON".to_vec()
        } else {
            serde_json::to_vec(&manifest).unwrap()
        };
        let sealed = fixture_key.seal(VAULT, "index", &bytes).unwrap();
        server
            .state
            .lock()
            .unwrap()
            .files
            .insert(index_path(), sealed);
        assert!(matches!(
            repo.synchronize(&Manifest::empty(VAULT).unwrap(), &Snapshot::new())
                .await,
            Err(SyncError::InvalidData)
        ));
    }
    assert_eq!(server.writes(), 0);
}

#[tokio::test]
async fn foreign_baseline_does_not_read_or_write_remote_data() {
    let server = Server::start().await;
    let (key, _) = SyncKey::generate();
    let repo = server.connect(key).await.unwrap();
    let count = server.state.lock().unwrap().requests.len();
    let foreign = Manifest::empty("b27199ee-84e0-4638-ad5f-e040bd699fe0").unwrap();
    assert!(matches!(
        repo.synchronize(&foreign, &Snapshot::new()).await,
        Err(SyncError::InvalidData)
    ));
    assert_eq!(server.state.lock().unwrap().requests.len(), count);
}

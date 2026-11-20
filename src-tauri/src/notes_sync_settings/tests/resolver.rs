use super::*;
use crate::notes_sync_settings::resolver::{lock_current_config, resolve};

#[test]
fn resolver_uses_saved_credentials_and_rejects_stale_disabled_or_other_named_domains() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let recovery = SyncKey::generate().1;
    let saved = save(
        &root.0,
        Some("a"),
        "workspace",
        true,
        &secrets,
        request(
            connection(),
            None,
            Some("synthetic-password"),
            Some(&recovery),
        ),
    )
    .unwrap();
    let revision = saved.revision.as_deref().unwrap();
    assert!(resolve(&root.0, Some("a"), "workspace", true, revision, &secrets).is_ok());
    let reads = secrets.reads.get();
    assert!(resolve(&root.0, Some("a"), "workspace", false, revision, &secrets).is_err());
    assert!(resolve(&root.0, Some("a"), "workspace", true, "stale", &secrets).is_err());
    assert!(resolve(&root.0, Some("b"), "workspace", true, revision, &secrets).is_err());
    assert!(resolve(&root.0, None, "workspace", true, revision, &secrets).is_err());
    assert_eq!(
        secrets.reads.get(),
        reads,
        "denied reads never inspect secret accounts"
    );
}

#[test]
fn local_apply_lease_and_settings_save_share_one_revision_fence_without_holding_it_for_network() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let recovery = SyncKey::generate().1;
    let saved = save(
        &root.0,
        Some("a"),
        "workspace",
        true,
        &secrets,
        request(
            connection(),
            None,
            Some("synthetic-password"),
            Some(&recovery),
        ),
    )
    .unwrap();
    let revision = saved.revision.unwrap();
    let lease = lock_current_config(&root.0, Some("a"), "workspace", &revision).unwrap();
    let change = || request(saved.connection.clone(), Some(revision.clone()), None, None);
    assert!(matches!(
        save(&root.0, Some("a"), "workspace", true, &secrets, change()),
        Err("notes_sync_settings_busy")
    ));
    drop(lease);
    let updated = save(&root.0, Some("a"), "workspace", true, &secrets, change()).unwrap();
    assert_ne!(updated.revision.as_deref(), Some(revision.as_str()));
    assert!(matches!(
        lock_current_config(&root.0, Some("a"), "workspace", &revision),
        Err("notes_sync_settings_changed")
    ));
    assert!(resolve(
        &root.0,
        Some("a"),
        "workspace",
        true,
        updated.revision.as_deref().unwrap(),
        &secrets
    )
    .is_ok());
}

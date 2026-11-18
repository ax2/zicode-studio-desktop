#[path = "isolation_tests.rs"]
mod isolation;

use super::*;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    fs,
    path::PathBuf,
};
use zeroize::Zeroizing;

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/notes-sync-settings")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let base = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../.cache/task-scratch/notes-sync-settings");
        if self.0.starts_with(base)
            && self
                .0
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(valid_id)
        {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
}
#[derive(Default)]
struct MemorySecrets {
    data: RefCell<HashMap<String, String>>,
    fail_after: Cell<Option<usize>>,
    reads: Cell<usize>,
}
impl Secrets for MemorySecrets {
    fn get(&self, account: &str) -> Result<Option<Zeroizing<String>>> {
        self.reads.set(self.reads.get() + 1);
        Ok(self.data.borrow().get(account).cloned().map(Zeroizing::new))
    }
    fn set(&self, account: &str, value: &str) -> Result<()> {
        if let Some(remaining) = self.fail_after.get() {
            if remaining == 0 {
                return Err("notes_sync_credentials_unavailable");
            }
            self.fail_after.set(Some(remaining - 1));
        }
        self.data.borrow_mut().insert(account.into(), value.into());
        Ok(())
    }
    fn delete(&self, account: &str) -> Result<()> {
        self.data.borrow_mut().remove(account);
        Ok(())
    }
}
fn connection() -> Connection {
    Connection {
        endpoint: "https://fixture.invalid/dav/".into(),
        username: "synthetic".into(),
        vault_id: Uuid::new_v4().to_string(),
    }
}
fn request(
    connection: Connection,
    revision: Option<String>,
    password: Option<&str>,
    recovery: Option<&str>,
) -> Save {
    Save {
        expected_revision: revision,
        connection,
        password: password.map(str::to_owned),
        recovery_code: recovery.map(str::to_owned),
    }
}

#[test]
fn metadata_and_status_never_store_or_expose_secrets_or_change_notes() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let note = root.0.join("saved-note.md");
    let original = b"  synthetic saved note\n\n";
    fs::write(&note, original).unwrap();
    let code = SyncKey::generate().1;
    let saved = save(
        &root.0,
        Some("synthetic"),
        "workspace",
        true,
        &secrets,
        request(connection(), None, Some("test-password"), Some(&code)),
    )
    .unwrap();
    assert_eq!(saved.state, "configured");
    assert!(!saved.sync_available);
    let serialized = serde_json::to_string(&saved).unwrap();
    let store = Storage::open(
        &root.0,
        &configuration_key("workspace", Some("synthetic")).unwrap(),
        false,
    )
    .unwrap()
    .unwrap();
    let bytes = String::from_utf8(store.read_current().unwrap().unwrap()).unwrap();
    for content in [serialized, bytes] {
        assert!(!content.contains("test-password"));
        assert!(!content.contains(&code));
    }
    assert_eq!(fs::read(note).unwrap(), original);
    assert!(!root.0.join("credential-index.json").exists());
    assert_eq!(secrets.data.borrow().len(), 2);
}

#[test]
fn unchanged_connection_preserves_secrets_and_stale_revision_cannot_replace_them() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let connection = connection();
    let first = save(
        &root.0,
        None,
        "workspace",
        true,
        &secrets,
        request(
            connection.clone(),
            None,
            Some("password"),
            Some(&SyncKey::generate().1),
        ),
    )
    .unwrap();
    let old_accounts = secrets.data.borrow().clone();
    let next = save(
        &root.0,
        None,
        "workspace",
        true,
        &secrets,
        request(connection.clone(), first.revision.clone(), None, None),
    )
    .unwrap();
    assert_eq!(next.state, "configured");
    assert!(next.revision != first.revision);
    assert_eq!(*secrets.data.borrow(), old_accounts);
    assert!(matches!(
        save(
            &root.0,
            None,
            "workspace",
            true,
            &secrets,
            request(connection, first.revision, Some("stale-password"), None)
        ),
        Err("notes_sync_settings_changed")
    ));
    assert_eq!(*secrets.data.borrow(), old_accounts);
    let reopened = status(&root.0, None, "workspace", true, &secrets).unwrap();
    assert_eq!(reopened.revision, next.revision);
}

#[test]
fn changing_destination_does_not_reuse_previous_secrets_and_retains_old_configuration() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let mut connection = connection();
    let first = save(
        &root.0,
        None,
        "workspace",
        true,
        &secrets,
        request(
            connection.clone(),
            None,
            Some("password"),
            Some(&SyncKey::generate().1),
        ),
    )
    .unwrap();
    connection.endpoint = "https://other.invalid/dav/".into();
    let next = save(
        &root.0,
        None,
        "workspace",
        true,
        &secrets,
        request(connection, first.revision.clone(), None, None),
    )
    .unwrap();
    assert_eq!(next.state, "credentialsMissing");
    assert!(!next.password_configured && !next.key_configured);
    assert_eq!(secrets.data.borrow().len(), 2);
    let key = workspace_key("workspace").unwrap();
    assert!(root
        .0
        .join("notes-sync")
        .join(key)
        .join(format!("{}.json", first.revision.unwrap()))
        .is_file());
}

#[test]
fn failed_secret_staging_keeps_previous_revision_and_deletes_only_new_accounts() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let connection = connection();
    let first = save(
        &root.0,
        None,
        "workspace",
        true,
        &secrets,
        request(
            connection.clone(),
            None,
            Some("old-password"),
            Some(&SyncKey::generate().1),
        ),
    )
    .unwrap();
    let before = secrets.data.borrow().clone();
    secrets.fail_after.set(Some(1));
    assert!(matches!(
        save(
            &root.0,
            None,
            "workspace",
            true,
            &secrets,
            request(
                connection,
                first.revision.clone(),
                Some("new-password"),
                Some(&SyncKey::generate().1)
            )
        ),
        Err("notes_sync_credentials_unavailable")
    ));
    assert_eq!(*secrets.data.borrow(), before);
    assert_eq!(
        status(&root.0, None, "workspace", true, &secrets)
            .unwrap()
            .revision,
        first.revision
    );
}

#[test]
fn isolated_disabled_status_and_save_never_read_system_credentials() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    assert_eq!(
        status(&root.0, None, "workspace", false, &secrets)
            .unwrap()
            .state,
        "credentialStorageDisabled"
    );
    assert!(matches!(
        save(
            &root.0,
            None,
            "workspace",
            false,
            &secrets,
            request(connection(), None, Some("password"), None)
        ),
        Err("notes_sync_credentials_disabled")
    ));
    assert_eq!(secrets.reads.get(), 0);
    assert!(secrets.data.borrow().is_empty());
    assert!(!root.0.join("notes-sync").exists());
}

#[test]
fn profile_test_name_workspace_and_secret_kind_all_separate_accounts() {
    let root = Scratch::new();
    let peer = Scratch::new();
    let reference = Uuid::new_v4().to_string();
    let base = account(&root.0, None, "workspace", &reference, "password");
    for other in [
        account(&peer.0, None, "workspace", &reference, "password"),
        account(&root.0, Some("named"), "workspace", &reference, "password"),
        account(&root.0, None, "peer", &reference, "password"),
        account(&root.0, None, "workspace", &reference, "key"),
    ] {
        assert_ne!(base, other);
    }
    assert!(base.starts_with("notes-sync-"));
    assert_ne!(secrets::SERVICE, "ZiCode Studio Desktop");
}

#[test]
fn malformed_configuration_invalid_connections_and_invalid_key_do_not_read_or_write_secrets() {
    let root = Scratch::new();
    let secrets = MemorySecrets::default();
    let original = connection();
    for endpoint in [
        "http://fixture.invalid/",
        "https://name:pass@fixture.invalid/",
        "https://fixture.invalid/?token=hidden",
        "https://fixture.invalid/#secret",
    ] {
        let mut connection = original.clone();
        connection.endpoint = endpoint.into();
        assert!(matches!(
            save(
                &root.0,
                None,
                "workspace",
                true,
                &secrets,
                request(connection, None, Some("password"), None)
            ),
            Err("notes_sync_invalid_endpoint")
        ));
    }
    assert!(matches!(
        save(
            &root.0,
            None,
            "workspace",
            true,
            &secrets,
            request(original, None, Some("password"), Some("bad-key"))
        ),
        Err("notes_sync_invalid_key")
    ));
    let folder = root
        .0
        .join("notes-sync")
        .join(workspace_key("workspace").unwrap());
    fs::create_dir_all(&folder).unwrap();
    fs::write(
        folder.join("current.json"),
        br#"{"schema":1,"password":"must-not-be-accepted"}"#,
    )
    .unwrap();
    assert!(matches!(
        status(&root.0, None, "workspace", true, &secrets),
        Err("notes_sync_settings_invalid")
    ));
    assert_eq!(secrets.reads.get(), 0);
    assert!(secrets.data.borrow().is_empty());
}

#[cfg(windows)]
#[test]
#[ignore = "explicit synthetic Windows credential-store acceptance; never personal accounts"]
fn windows_system_credentials_roundtrip_in_fresh_named_scope() {
    struct Cleanup(Vec<String>);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            for account in &self.0 {
                let _ = secrets::SystemSecrets.delete(account);
            }
        }
    }
    let root = Scratch::new();
    let workspace = Uuid::new_v4().to_string();
    let code = SyncKey::generate().1;
    let saved = save(
        &root.0,
        Some("synthetic-acceptance"),
        &workspace,
        true,
        &secrets::SystemSecrets,
        request(
            connection(),
            None,
            Some("synthetic-not-a-user-password"),
            Some(&code),
        ),
    )
    .unwrap();
    let reference = saved.revision.clone().unwrap();
    let _cleanup = Cleanup(
        ["password", "key"]
            .map(|kind| {
                account(
                    &root.0,
                    Some("synthetic-acceptance"),
                    &workspace,
                    &reference,
                    kind,
                )
            })
            .to_vec(),
    );
    assert_eq!(saved.state, "configured");
    let reopened = status(
        &root.0,
        Some("synthetic-acceptance"),
        &workspace,
        true,
        &secrets::SystemSecrets,
    )
    .unwrap();
    assert_eq!(reopened.state, "configured");
    assert_eq!(
        status(
            &root.0,
            Some("other-name"),
            &workspace,
            true,
            &secrets::SystemSecrets
        )
        .unwrap()
        .state,
        "unconfigured"
    );
    assert_eq!(
        status(
            &root.0,
            Some("synthetic-acceptance"),
            &workspace,
            false,
            &secrets::SystemSecrets
        )
        .unwrap()
        .state,
        "credentialStorageDisabled"
    );
}

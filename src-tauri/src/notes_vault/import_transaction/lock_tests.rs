use super::*;

#[test]
fn last_vault_owner_releases_storage_lock() {
    let root = std::env::temp_dir().join(format!("zicode-notes-lock-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let guard = lock_storage(&root).unwrap();
    let clone = guard.clone();
    drop(guard);
    assert_eq!(lock_storage(&root).err().unwrap().code, "notes_storage_busy");
    drop(clone);
    drop(lock_storage(&root).expect("last owner released the lock"));
    fs::remove_file(root.join(".notes.lock")).unwrap();
    fs::remove_dir(root).unwrap();
}

#[cfg(unix)]
#[test]
fn inherited_descriptor_does_not_keep_a_closed_vault_locked() {
    let root = std::env::temp_dir().join(format!("zicode-notes-lock-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    let guard = lock_storage(&root).unwrap();
    // dup and fork share the same open file description and flock. Hold that
    // descriptor deterministically instead of racing a real child's exec.
    let inherited = guard.0.try_clone().unwrap();
    assert_eq!(lock_storage(&root).err().unwrap().code, "notes_storage_busy");
    drop(guard);
    let reopened = lock_storage(&root).expect("explicit unlock released the inherited flock");
    drop(inherited);
    assert_eq!(lock_storage(&root).err().unwrap().code, "notes_storage_busy");
    drop(reopened);
    drop(lock_storage(&root).unwrap());
    fs::remove_file(root.join(".notes.lock")).unwrap();
    fs::remove_dir(root).unwrap();
}

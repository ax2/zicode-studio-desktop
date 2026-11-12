use super::*;

fn fixture() -> (PathBuf, PathBuf, Connection, String) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!(
            "visual-assets-snapshot-test-{}",
            uuid::Uuid::new_v4()
        ));
    let library = root.join("library");
    fs::create_dir_all(&library).unwrap();
    let db = super::super::catalog::open(&library).unwrap();
    let digest = format!("{:x}", Sha256::digest(b"original"));
    db.execute_batch("PRAGMA user_version=1").unwrap();
    db.execute("INSERT INTO blob VALUES (?1, 8)", [&digest])
        .unwrap();
    db.execute("INSERT INTO asset VALUES (1, '中文角色')", [])
        .unwrap();
    db.execute("INSERT INTO revision VALUES (1, 1, ?1)", [&digest])
        .unwrap();
    fs::write(library.join(format!("{digest}.blob")), b"original").unwrap();
    (root, library, db, digest)
}

fn clean(root: PathBuf) {
    let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .canonicalize()
        .unwrap();
    let resolved = root.canonicalize().unwrap();
    assert_eq!(resolved.parent(), Some(expected.as_path()));
    assert!(resolved
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("visual-assets-snapshot-test-"));
    fs::remove_dir_all(resolved).unwrap();
}

#[test]
fn published_backup_requires_the_manifest_bytes_committed_before_rename() {
    let (root, library, mut db, _) = fixture();
    let destination = root.join("backup");
    fs::create_dir(&destination).unwrap();
    let receipt = std::cell::RefCell::new(String::new());
    let snapshot = create(
        &mut db,
        &library,
        &destination,
        None,
        &|_| Ok(()),
        &|digest| {
            receipt.replace(digest.into());
            Ok(())
        },
    )
    .unwrap();
    let destination = snapshot.parent().unwrap();
    verify_publication(destination, &receipt.borrow()).unwrap();
    let path = snapshot.join("manifest.json");
    let mut bytes = fs::read(&path).unwrap();
    bytes.push(b'\n');
    fs::write(path, bytes).unwrap();
    assert!(verify_publication(destination, &receipt.borrow()).is_err());
    drop(db);
    clean(root);
}

#[test]
fn cancellation_between_catalog_and_original_copy_keeps_source_and_never_publishes() {
    let (root, library, mut db, digest) = fixture();
    let destination = root.join("cancelled-backup");
    fs::create_dir(&destination).unwrap();
    assert!(create(
        &mut db,
        &library,
        &destination,
        None,
        &|phase| {
            if phase == "copying-originals" {
                return Err("cancelled".into());
            }
            Ok(())
        },
        &|_| Ok(())
    )
    .is_err());
    assert!(!destination.join("snapshot").exists());
    assert!(!destination
        .join("pending-snapshot")
        .join(format!("{digest}.blob"))
        .exists());
    assert_eq!(
        fs::read(library.join(format!("{digest}.blob"))).unwrap(),
        b"original"
    );
    drop(db);
    clean(root);
}

#[test]
fn snapshot_pins_writes_and_restores_the_original_revision_after_source_changes() {
    let (root, library, mut db, digest) = fixture();
    let destination = root.join("backup");
    fs::create_dir(&destination).unwrap();
    let snapshot = create(
        &mut db,
        &library,
        &destination,
        None,
        &|phase| {
            if phase == "snapshot-catalog" {
                let competitor = Connection::open(library.join("catalog.sqlite")).unwrap();
                competitor.busy_timeout(std::time::Duration::ZERO).unwrap();
                assert!(competitor.execute("DELETE FROM revision", []).is_err());
            }
            Ok(())
        },
        &|_| Ok(()),
    )
    .unwrap();
    db.execute("UPDATE asset SET name='changed'", []).unwrap();
    let restored = root.join("restored");
    let manifest = restore(
        &snapshot,
        &restored,
        |_, target| {
            fs::write(target, b"rebuilt-preview")?;
            Ok(())
        },
        &|_| Ok(()),
    )
    .unwrap();
    let reopened = super::super::catalog::open(&restored).unwrap();
    assert_eq!(
        super::super::catalog::page(&reopened, 0).unwrap().assets[0].name,
        "中文角色"
    );
    let id: String = db
        .query_row("SELECT id FROM library", [], |row| row.get(0))
        .unwrap();
    assert_eq!(manifest.library_id, id);
    assert_eq!(
        fs::read(restored.join(format!("{digest}.blob"))).unwrap(),
        b"original"
    );
    assert_eq!(
        fs::read(restored.join(format!("{digest}.png"))).unwrap(),
        b"rebuilt-preview"
    );
    assert!(restore(&snapshot, &restored, |_, _| Ok(()), &|_| Ok(())).is_err());
    drop(reopened);
    drop(db);
    clean(root);
}

#[test]
fn corrupted_or_missing_originals_never_publish_a_backup_or_restored_library() {
    let (root, library, mut db, digest) = fixture();
    let destination = root.join("backup");
    fs::create_dir(&destination).unwrap();
    let snapshot = create(&mut db, &library, &destination, None, &|_| Ok(()), &|_| {
        Ok(())
    })
    .unwrap();
    fs::write(snapshot.join(format!("{digest}.blob")), b"modified").unwrap();
    let restored = root.join("restored");
    assert!(restore(
        &snapshot,
        &restored,
        |_, _| panic!("must validate before decoding"),
        &|_| Ok(())
    )
    .is_err());
    assert!(!restored.exists());
    fs::remove_file(library.join(format!("{digest}.blob"))).unwrap();
    let broken = root.join("broken");
    fs::create_dir(&broken).unwrap();
    assert!(create(&mut db, &library, &broken, None, &|_| Ok(()), &|_| Ok(())).is_err());
    assert!(!broken.join("snapshot").exists());
    assert!(broken.join("pending-snapshot").exists());
    drop(db);
    clean(root);
}

#[test]
fn manifest_and_catalog_tampering_and_preview_failure_leave_destination_unpublished() {
    let (root, library, mut db, _) = fixture();
    let destination = root.join("backup");
    fs::create_dir(&destination).unwrap();
    let snapshot = create(&mut db, &library, &destination, None, &|_| Ok(()), &|_| {
        Ok(())
    })
    .unwrap();
    let restored = root.join("restored");
    assert!(restore(
        &snapshot,
        &restored,
        |_, _| Err("decoder failed".into()),
        &|_| Ok(())
    )
    .is_err());
    assert!(!restored.exists());
    let manifest_file = snapshot.join("manifest.json");
    let valid = fs::read(&manifest_file).unwrap();
    let mut manifest: Manifest = serde_json::from_slice(&valid).unwrap();
    manifest.blob_count += 1;
    fs::write(&manifest_file, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(restore(&snapshot, &restored, |_, _| Ok(()), &|_| Ok(())).is_err());
    fs::write(&manifest_file, valid).unwrap();
    let altered = Connection::open(snapshot.join("catalog.sqlite")).unwrap();
    altered
        .execute("UPDATE asset SET name='tampered'", [])
        .unwrap();
    drop(altered);
    assert!(restore(&snapshot, &restored, |_, _| Ok(()), &|_| Ok(())).is_err());
    assert!(!restored.exists());
    drop(db);
    clean(root);
}

#[test]
fn a_matching_digest_does_not_authorize_extra_catalog_objects() {
    let (root, library, mut db, _) = fixture();
    let destination = root.join("backup");
    fs::create_dir(&destination).unwrap();
    let snapshot = create(&mut db, &library, &destination, None, &|_| Ok(()), &|_| {
        Ok(())
    })
    .unwrap();
    let catalog = snapshot.join("catalog.sqlite");
    let modified = Connection::open(&catalog).unwrap();
    modified
        .execute_batch("CREATE TRIGGER foreign_trigger AFTER INSERT ON asset BEGIN SELECT 1; END;")
        .unwrap();
    drop(modified);
    let manifest_path = snapshot.join("manifest.json");
    let mut manifest: Manifest =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest.catalog_sha256 = hash(&catalog).unwrap();
    fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    let target = root.join("restored");
    assert!(restore(
        &snapshot,
        &target,
        |_, _| panic!("unexpected decode"),
        &|_| Ok(())
    )
    .is_err());
    assert!(!target.exists());
    drop(db);
    clean(root);
}

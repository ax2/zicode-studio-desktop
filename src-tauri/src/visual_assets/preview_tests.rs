use super::*;

fn fixture() -> (Connection, Owner) {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE library(id TEXT); INSERT INTO library VALUES ('library');
        CREATE TABLE revision(asset INTEGER, version INTEGER, digest TEXT);",
    )
    .unwrap();
    db.execute("INSERT INTO revision VALUES (1, 1, ?1)", ["a".repeat(64)])
        .unwrap();
    (
        db,
        Owner {
            window: "window-a".into(),
            workspace: "workspace".into(),
            route: "/".into(),
        },
    )
}

#[test]
fn preview_is_scoped_expiring_and_rechecks_revision() {
    let (db, owner) = fixture();
    let mut previews = Previews::default();
    assert!(previews
        .issue(&db, owner.clone(), "other-library", 1, 1)
        .is_err());
    let ticket = previews.issue(&db, owner.clone(), "library", 1, 1).unwrap();
    for stranger in [
        Owner {
            window: "window-b".into(),
            ..owner.clone()
        },
        Owner {
            workspace: "other".into(),
            ..owner.clone()
        },
        Owner {
            route: "/other".into(),
            ..owner.clone()
        },
    ] {
        assert_eq!(
            previews
                .read(&db, Path::new("unused"), &stranger, &ticket.handle)
                .unwrap_err(),
            "visual_assets_preview_owner_mismatch"
        );
    }
    previews.grants.get_mut(&ticket.handle).unwrap().expires = Instant::now();
    assert_eq!(
        previews
            .read(&db, Path::new("unused"), &owner, &ticket.handle)
            .unwrap_err(),
        "visual_assets_preview_expired"
    );
    let ticket = previews.issue(&db, owner.clone(), "library", 1, 1).unwrap();
    db.execute("UPDATE revision SET digest=?1", ["b".repeat(64)])
        .unwrap();
    assert_eq!(
        previews
            .read(&db, Path::new("unused"), &owner, &ticket.handle)
            .unwrap_err(),
        "visual_assets_revision_changed"
    );
}

#[test]
fn preview_reads_bounded_bytes_once_and_limits_outstanding_handles() {
    let (db, owner) = fixture();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("visual-assets-preview-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let path = root.join(format!("{}.png", "a".repeat(64)));
    let png = base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5VQAAAAASUVORK5CYII=").unwrap();
    fs::write(&path, &png).unwrap();
    let mut previews = Previews::default();
    let ticket = previews.issue(&db, owner.clone(), "library", 1, 1).unwrap();
    let data = previews.read(&db, &root, &owner, &ticket.handle).unwrap();
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(data)
            .unwrap(),
        png
    );
    assert!(previews.read(&db, &root, &owner, &ticket.handle).is_err());
    fs::OpenOptions::new()
        .write(true)
        .open(&path)
        .unwrap()
        .set_len(MAX_BYTES + 1)
        .unwrap();
    let ticket = previews.issue(&db, owner.clone(), "library", 1, 1).unwrap();
    assert_eq!(
        previews
            .read(&db, &root, &owner, &ticket.handle)
            .unwrap_err(),
        "visual_assets_preview_invalid"
    );
    for _ in 0..MAX_HANDLES {
        previews.issue(&db, owner.clone(), "library", 1, 1).unwrap();
    }
    assert!(previews.issue(&db, owner, "library", 1, 1).is_err());
    fs::remove_file(path).unwrap();
    fs::remove_dir(root).unwrap();
}

#[cfg(windows)]
#[test]
fn cached_reference_preview_still_requires_current_source_and_grant() {
    use super::super::{catalog, reference_grants::Grants, reference_source::Root};
    use rusqlite::params;
    let profile = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!(
            "visual-assets-reference-cache-{}",
            uuid::Uuid::new_v4()
        ));
    fs::create_dir_all(&profile).unwrap();
    let profile = fs::canonicalize(profile).unwrap();
    let library = profile.join("visual-assets");
    let source_dir = profile.join("source");
    fs::create_dir(&library).unwrap();
    fs::create_dir(&source_dir).unwrap();
    let source = Root::approve(&source_dir).unwrap();
    let path = Path::new("original.png");
    let original = source_dir.join(path);
    let cached = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5VQAAAAASUVORK5CYII=";
    let png = base64::engine::general_purpose::STANDARD
        .decode(cached)
        .unwrap();
    fs::write(&original, &png).unwrap();
    let (_, fingerprint) = source.read(path, None).unwrap();
    let db = catalog::open(&library).unwrap();
    let id: String = db
        .query_row("SELECT id FROM library", [], |row| row.get(0))
        .unwrap();
    let grant = Grants::open(&profile)
        .unwrap()
        .register(&id, &source)
        .unwrap();
    let digest = &fingerprint.sha256;
    let asset = catalog::add_asset(&db, "original.png").unwrap();
    db.execute(
        "INSERT INTO blob VALUES (?1,?2)",
        params![digest, png.len()],
    )
    .unwrap();
    db.execute("INSERT INTO external_blob VALUES (?1)", [digest])
        .unwrap();
    db.execute(
        "INSERT INTO revision VALUES (?1,1,?2)",
        params![asset, digest],
    )
    .unwrap();
    db.execute(
        "INSERT INTO asset_reference VALUES (?1,1,?2,'original.png',?3)",
        params![asset, grant, serde_json::to_string(&fingerprint).unwrap()],
    )
    .unwrap();

    let owner = Owner {
        window: "window".into(),
        workspace: "workspace".into(),
        route: "/".into(),
    };
    let mut previews = Previews::default();
    previews
        .reference_thumbnails
        .get_or_generate(&id, digest, || Ok(cached.into()))
        .unwrap();
    let read = |previews: &mut Previews| {
        let ticket = previews.issue(&db, owner.clone(), &id, asset, 1).unwrap();
        previews.read(&db, &library, &owner, &ticket.handle)
    };
    assert_eq!(read(&mut previews).unwrap(), cached);
    fs::write(&original, b"changed bytes").unwrap();
    assert_eq!(
        read(&mut previews).unwrap_err(),
        "reference_content_changed"
    );
    fs::write(&original, &png).unwrap();
    let moved = source_dir.join("moved.png");
    fs::rename(&original, &moved).unwrap();
    assert_eq!(read(&mut previews).unwrap_err(), "reference_source_missing");
    fs::rename(&moved, &original).unwrap();
    let authorization = profile.join("visual-assets-authorizations.sqlite");
    fs::remove_file(authorization).unwrap();
    assert_eq!(read(&mut previews).unwrap_err(), "reference_not_authorized");
    drop(db);
    fs::remove_file(original).unwrap();
    fs::remove_file(library.join("catalog.sqlite")).unwrap();
    fs::remove_dir(source_dir).unwrap();
    fs::remove_dir(library).unwrap();
    fs::remove_dir(profile).unwrap();
}

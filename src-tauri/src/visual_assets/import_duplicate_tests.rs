use super::*;

#[test]
fn duplicate_candidate_is_the_first_verified_original_and_uses_the_digest_index() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("visual-assets-duplicates-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let mut db = super::super::catalog::open(&root).unwrap();
    let bytes = b"already verified managed original";
    let digest = format!("{:x}", Sha256::digest(bytes));
    let original = root.join(format!("{digest}.blob"));
    fs::write(&original, bytes).unwrap();
    db.execute(
        "INSERT INTO blob VALUES (?1,?2)",
        params![digest, bytes.len()],
    )
    .unwrap();
    db.execute_batch(
        "INSERT INTO asset VALUES (1,'earlier.png'), (2,'first.png'), (3,'later.png');",
    )
    .unwrap();
    // Only first revisions describe the current managed-import model.
    db.execute("INSERT INTO revision VALUES (1,2,?1)", [&digest])
        .unwrap();
    for id in [3, 2] {
        db.execute("INSERT INTO revision VALUES (?1,1,?2)", params![id, digest])
            .unwrap();
    }
    let tx = db.transaction().unwrap();
    let imported = import_bytes(&tx, &root, "copy.png", bytes, &|_| {}).unwrap();
    assert_eq!(imported.asset_id, 4);
    let candidate = imported.duplicate_of.unwrap();
    assert_eq!(candidate.id, 2);
    assert_eq!(candidate.name, "first.png");
    tx.commit().unwrap();
    let plan: Vec<_> = db
        .prepare(&format!("EXPLAIN QUERY PLAN {DUPLICATE_QUERY}"))
        .unwrap()
        .query_map([&digest], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<rusqlite::Result<_>>()
        .unwrap();
    assert!(
        plan.iter()
            .any(|line| line.contains("revision_first_digest")),
        "{plan:?}"
    );
    assert!(
        plan.iter()
            .all(|line| !line.contains("SCAN") && !line.contains("TEMP B-TREE")),
        "{plan:?}"
    );
    fs::write(&original, b"corrupted").unwrap();
    let tx = db.transaction().unwrap();
    assert!(import_bytes(&tx, &root, "rejected.png", bytes, &|_| {}).is_err());
    drop(tx);
    let count: i64 = db
        .query_row("SELECT count(*) FROM asset", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 4);
    drop(db);
    fs::remove_file(original).unwrap();
    fs::remove_file(root.join("catalog.sqlite")).unwrap();
    fs::remove_dir(root).unwrap();
}

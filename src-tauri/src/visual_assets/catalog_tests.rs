use super::*;

#[test]
fn library_identity_survives_an_uncommitted_import() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("visual-assets-catalog-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    let mut db = open(&root).unwrap();
    let id: String = db
        .query_row("SELECT id FROM library", [], |row| row.get(0))
        .unwrap();
    {
        let tx = db.transaction().unwrap();
        tx.execute("INSERT INTO asset(name) VALUES ('未完成')", [])
            .unwrap();
    }
    drop(db);
    let db = open(&root).unwrap();
    let reopened: String = db
        .query_row("SELECT id FROM library", [], |row| row.get(0))
        .unwrap();
    assert_eq!(id, reopened);
    assert!(page(&db, 0).unwrap().assets.is_empty());
    drop(db);
    std::fs::remove_file(root.join("catalog.sqlite")).unwrap();
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn million_metadata_rows_use_indexed_cursor_pagination() {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE asset(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         CREATE TABLE revision(asset INTEGER, version INTEGER, digest TEXT, PRIMARY KEY(asset, version));
         WITH RECURSIVE ids(id) AS (VALUES(1) UNION ALL SELECT id+1 FROM ids WHERE id<1000000)
         INSERT INTO asset SELECT id, '角色设定' FROM ids;
         INSERT INTO revision SELECT id, 1, 'metadata-only' FROM asset;",
    ).unwrap();
    let mut statement = db
        .prepare(&format!("EXPLAIN QUERY PLAN {PAGE_QUERY}"))
        .unwrap();
    let plan = statement
        .query_map([999_900], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(
        plan.iter()
            .any(|line| line.contains("SEARCH a USING INTEGER PRIMARY KEY")),
        "{plan:?}"
    );
    assert!(
        plan.iter()
            .all(|line| !line.contains("SCAN") && !line.contains("TEMP B-TREE")),
        "{plan:?}"
    );
    let started = std::time::Instant::now();
    let first = page(&db, 999_900).unwrap();
    let second = page(&db, first.next.unwrap()).unwrap();
    assert_eq!(first.assets.len(), PAGE_SIZE);
    assert_eq!(first.assets[0].id, 999_901);
    assert_eq!(first.assets[0].name, "角色设定");
    assert_eq!(second.assets.len(), PAGE_SIZE);
    assert_eq!(second.assets[0].id, 999_951);
    assert_eq!(second.assets.last().unwrap().id, 1_000_000);
    assert!(second.next.is_none());
    assert!(page(&db, 1_000_000).unwrap().assets.is_empty());
    println!(
        "million-row tail pages elapsed={:?}; plan={plan:?}",
        started.elapsed()
    );
}

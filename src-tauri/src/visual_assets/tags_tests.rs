use super::*;

fn catalog() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE asset(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         CREATE TABLE revision(asset INTEGER, version INTEGER, digest TEXT, PRIMARY KEY(asset,version));",
    )
    .unwrap();
    db.execute_batch(SCHEMA).unwrap();
    db
}

#[test]
fn edits_are_normalized_and_stale_or_invalid_updates_preserve_the_tags() {
    let mut db = catalog();
    db.execute("INSERT INTO asset VALUES (1,'月光.png')", [])
        .unwrap();
    let tx = db.transaction().unwrap();
    let requested = vec![" 主角 ".into(), "主角".into(), "月光".into()];
    let saved = replace(&tx, 1, &[], &requested).unwrap();
    assert_eq!(saved, ["主角", "月光"]);
    tx.commit().unwrap();
    let tx = db.transaction().unwrap();
    assert_eq!(replace(&tx, 1, &[], &[]), Err("visual_assets_tags_changed"));
    assert_eq!(
        replace(&tx, 1, &saved, &["长".repeat(33)]),
        Err("visual_assets_invalid_tags")
    );
    assert_eq!(
        replace(&tx, 9, &[], &[]),
        Err("visual_assets_asset_missing")
    );
    assert_eq!(read(&tx, 1).unwrap(), saved);
    assert!(replace(&tx, 1, &saved, &[]).unwrap().is_empty());
    tx.commit().unwrap();
    assert!(read(&db, 1).unwrap().is_empty());
}

#[test]
fn exact_tag_and_filename_filter_use_the_cursor_index() {
    let db = catalog();
    db.execute_batch(
        "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<53)
         INSERT INTO asset SELECT n,CASE WHEN n=53 THEN '日光.png' ELSE '月光.png' END FROM ids;
         INSERT INTO revision SELECT id,1,'digest' FROM asset;
         INSERT INTO asset_tag SELECT '主角',id FROM asset;
         INSERT INTO asset_tag VALUES ('主角候选',1);",
    )
    .unwrap();
    let mut statement = db
        .prepare(&format!("EXPLAIN QUERY PLAN {PAGE_QUERY}"))
        .unwrap();
    let plan = statement
        .query_map(params!["主角", 0, "月"], |row| row.get::<_, String>(3))
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(
        plan.iter()
            .any(|line| line.contains("SEARCH t USING PRIMARY KEY")),
        "{plan:?}"
    );
    assert!(
        plan.iter()
            .all(|line| !line.contains("SCAN ") && !line.contains("TEMP B-TREE")),
        "{plan:?}"
    );
    let mut first = page(&db, 0, "主角", "月").unwrap();
    fill_page(&db, &mut first).unwrap();
    assert_eq!(first.next, Some(50));
    assert_eq!(first.assets[0].tags, ["主角", "主角候选"]);
    let tail = page(&db, first.next.unwrap(), "主角", "月").unwrap();
    assert_eq!(
        tail.assets.iter().map(|asset| asset.id).collect::<Vec<_>>(),
        [51, 52]
    );
    assert!(tail.next.is_none());
    assert!(page(&db, 0, "主", "").unwrap().assets.is_empty());
}

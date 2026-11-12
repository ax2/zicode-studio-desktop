use super::*;

#[test]
fn duplicate_pages_include_group_originals_and_combine_cursor_and_exact_filters() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!(
            "visual-assets-duplicate-pages-{}",
            uuid::Uuid::new_v4()
        ));
    std::fs::create_dir_all(&root).unwrap();
    let db = super::super::catalog::open(&root).unwrap();
    db.execute_batch(
        "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<124)
         INSERT INTO asset SELECT n,CASE WHEN n=104 THEN '日光.png' ELSE '月光.png' END FROM ids;
         INSERT INTO blob SELECT CASE WHEN id<=104 THEN 'same'
             WHEN id IN (106,107) THEN 'another' ELSE 'unique-'||id END,1 FROM asset
             GROUP BY 1;
         INSERT INTO revision SELECT id,1,CASE WHEN id<=104 THEN 'same'
             WHEN id IN (106,107) THEN 'another' ELSE 'unique-'||id END FROM asset;
         INSERT INTO revision VALUES (108,2,'unique-105'), (105,2,'unique-105');
         INSERT INTO asset_tag SELECT '主角',id FROM asset WHERE id%2=1;
         INSERT INTO asset_collection VALUES ('one','合集');
         INSERT INTO asset_collection_member
             SELECT 'one',id FROM asset WHERE id IN (2,51,52,105,106);",
    )
    .unwrap();
    let first = page(&db, 0, "", "", None).unwrap();
    let second = page(&db, first.next.unwrap(), "", "", None).unwrap();
    let tail = page(&db, second.next.unwrap(), "", "", None).unwrap();
    assert_eq!(first.assets[0].id, 1);
    assert_eq!(first.next, Some(50));
    assert_eq!(second.assets[0].id, 51);
    assert_eq!(second.next, Some(100));
    assert_eq!(
        tail.assets.iter().map(|asset| asset.id).collect::<Vec<_>>(),
        [101, 102, 103, 104, 106, 107]
    );
    assert!(tail.next.is_none());
    let filtered = super::super::catalog::listing(&db, 0, "月", "主角", Some("one"), true).unwrap();
    assert_eq!(filtered.assets.len(), 1);
    assert_eq!(filtered.assets[0].id, 51);
    assert_eq!(filtered.assets[0].tags, ["主角"]);
    assert_eq!(filtered.assets[0].collection_ids, ["one"]);
    assert_eq!(page(&db, 0, "日", "", None).unwrap().assets[0].id, 104);
    assert!(page(&db, 0, "%", "", None).unwrap().assets.is_empty());
    assert!(page(&db, 0, "", "主", None).unwrap().assets.is_empty());
    assert!(page(&db, 0, "", "", Some("missing"))
        .unwrap()
        .assets
        .is_empty());
    let plan: Vec<_> = db
        .prepare(&format!("EXPLAIN QUERY PLAN {QUERY}"))
        .unwrap()
        .query_map(params![50, "月", "主角", "one"], |row| {
            row.get::<_, String>(3)
        })
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
            .all(|line| !line.contains("SCAN ") && !line.contains("TEMP B-TREE")),
        "{plan:?}"
    );
    drop(db);
    std::fs::remove_file(root.join("catalog.sqlite")).unwrap();
    std::fs::remove_dir(root).unwrap();
}

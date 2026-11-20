use super::*;

fn catalog() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "PRAGMA foreign_keys=ON;
         CREATE TABLE asset(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         CREATE TABLE revision(asset INTEGER, version INTEGER, digest TEXT, PRIMARY KEY(asset,version));",
    )
    .unwrap();
    db.execute_batch(super::super::tags::SCHEMA).unwrap();
    db.execute_batch(SCHEMA).unwrap();
    db
}

#[test]
fn stale_deletion_cannot_remove_a_renamed_collection_and_membership_is_idempotent() {
    let mut db = catalog();
    db.execute("INSERT INTO asset VALUES (1,'月光.png')", [])
        .unwrap();
    let tx = db.transaction().unwrap();
    let id = apply(
        &tx,
        Edit::Create {
            name: " 主角 ".into(),
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        apply(
            &tx,
            Edit::Create {
                name: "主角".into()
            }
        ),
        Err("visual_assets_collection_name_used")
    );
    for _ in 0..2 {
        apply(
            &tx,
            Edit::Membership {
                id: id.clone(),
                asset_id: 1,
                member: true,
            },
        )
        .unwrap();
    }
    apply(
        &tx,
        Edit::Rename {
            id: id.clone(),
            previous: "主角".into(),
            name: "角色".into(),
        },
    )
    .unwrap();
    assert_eq!(
        apply(
            &tx,
            Edit::Delete {
                id: id.clone(),
                previous: "主角".into()
            }
        ),
        Err("visual_assets_collection_changed")
    );
    let memberships: i64 = tx
        .query_row("SELECT count(*) FROM asset_collection_member", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(memberships, 1);
    apply(
        &tx,
        Edit::Delete {
            id,
            previous: "角色".into(),
        },
    )
    .unwrap();
    tx.commit().unwrap();
    assert!(list(&db).unwrap().is_empty());
    assert!(!db
        .prepare("SELECT 1 FROM asset_collection_member")
        .unwrap()
        .exists([])
        .unwrap());
    assert!(db
        .prepare("SELECT 1 FROM asset WHERE id=1")
        .unwrap()
        .exists([])
        .unwrap());
}

#[test]
fn collection_filter_uses_ordered_membership_and_combines_exact_tag_and_filename() {
    let db = catalog();
    db.execute_batch(
        "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<54)
         INSERT INTO asset SELECT n,CASE WHEN n=53 THEN '日光.png' ELSE '月光.png' END FROM ids;
         INSERT INTO revision SELECT id,1,'digest' FROM asset;
         INSERT INTO asset_collection VALUES ('one','合集');
         INSERT INTO asset_collection_member SELECT 'one',id FROM asset;
         INSERT INTO asset_tag SELECT CASE WHEN id=54 THEN '主角候选' ELSE '主角' END,id FROM asset;",
    ).unwrap();
    let mut statement = db
        .prepare(&format!("EXPLAIN QUERY PLAN {PAGE_QUERY}"))
        .unwrap();
    let plan = statement
        .query_map(params!["one", 0, "月", "主角"], |row| {
            row.get::<_, String>(3)
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert!(
        plan.iter()
            .any(|line| line.contains("SEARCH m USING PRIMARY KEY")),
        "{plan:?}"
    );
    assert!(
        plan.iter()
            .all(|line| !line.contains("SCAN ") && !line.contains("TEMP B-TREE")),
        "{plan:?}"
    );
    let mut first = page(&db, 0, "one", "月", "主角").unwrap();
    fill_page(&db, &mut first).unwrap();
    assert_eq!(first.next, Some(50));
    assert_eq!(first.assets[0].collection_ids, ["one"]);
    let tail = page(&db, first.next.unwrap(), "one", "月", "主角").unwrap();
    assert_eq!(
        tail.assets.iter().map(|asset| asset.id).collect::<Vec<_>>(),
        [51, 52]
    );
    assert!(tail.next.is_none());
}

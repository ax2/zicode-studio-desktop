use super::*;

fn legacy_catalog() -> Connection {
    let db = Connection::open_in_memory().unwrap();
    db.execute_batch(
        "CREATE TABLE asset(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         CREATE TABLE revision(asset INTEGER, version INTEGER, digest TEXT, PRIMARY KEY(asset,version));",
    ).unwrap();
    db
}

#[test]
fn legacy_names_are_backfilled_with_literal_chinese_and_bounded_overflow() {
    let db = legacy_catalog();
    let long = format!("{}月光", "长".repeat(256));
    for (id, name) in [
        (1, "新月光_角色.png"),
        (2, "月光_角色图.png"),
        (3, "月光动画.png"),
        (4, &long),
    ] {
        db.execute("INSERT INTO asset VALUES (?1,?2)", params![id, name])
            .unwrap();
        db.execute("INSERT INTO revision VALUES (?1,1,'digest')", [id])
            .unwrap();
    }
    ensure(&db).unwrap();
    let ids = |query| {
        page(&db, 0, query)
            .unwrap()
            .assets
            .into_iter()
            .map(|asset| asset.id)
            .collect::<Vec<_>>()
    };
    assert_eq!(ids("月"), [1, 2, 3, 4]);
    assert_eq!(ids("月光"), [1, 2, 3, 4]);
    assert_eq!(ids("月光_角色图"), [2]);
    assert_eq!(ids("_"), [1, 2]);
    assert!(ids("%").is_empty());
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM asset_name_gram WHERE asset=4",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
}

#[test]
fn chinese_results_use_ordered_index_ranges_and_exclusive_cursors() {
    let db = legacy_catalog();
    db.execute_batch(
        "WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<121)
         INSERT INTO asset SELECT n,'月光角色.png' FROM ids;
         INSERT INTO revision SELECT id,1,'digest' FROM asset;",
    )
    .unwrap();
    ensure(&db).unwrap();
    let mut statement = db.prepare(&format!("EXPLAIN QUERY PLAN {QUERY}")).unwrap();
    let plan = statement
        .query_map(params!["月光", 0, "月光"], |row| {
            row.get::<_, String>(3)
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(
        plan.iter()
            .filter(|line| line.contains("SEARCH g USING PRIMARY KEY"))
            .count(),
        2,
        "{plan:?}"
    );
    assert!(
        plan.iter()
            .all(|line| !line.contains("SCAN ") && !line.contains("TEMP B-TREE")),
        "{plan:?}"
    );
    let first = page(&db, 0, "月光").unwrap();
    let second = page(&db, first.next.unwrap(), "月光").unwrap();
    let tail = page(&db, second.next.unwrap(), "月光").unwrap();
    assert_eq!(first.next, Some(50));
    assert_eq!(second.assets[0].id, 51);
    assert_eq!(second.next, Some(100));
    assert_eq!(tail.assets.len(), 21);
    assert!(tail.next.is_none());
}

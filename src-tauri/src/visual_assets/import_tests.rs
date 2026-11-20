use super::*;
use rusqlite::TransactionBehavior;

#[test]
fn migration_reconciles_legacy_orphans_then_recovery_only_follows_the_journal() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("visual-assets-recovery-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let mut db = super::super::catalog::open(&root).unwrap();
    let digest = "a".repeat(64);
    let original = root.join(format!("{digest}.blob"));
    fs::write(&original, b"orphan").unwrap();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    recover(&tx, &root).unwrap();
    tx.commit().unwrap();
    assert!(!original.exists());

    // Unjournaled bytes are left for explicit reconciliation, never a page read.
    fs::write(&original, b"unrelated").unwrap();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    recover(&tx, &root).unwrap();
    tx.commit().unwrap();
    assert!(original.exists());

    fs::write(root.join("pending.import"), &digest).unwrap();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    recover(&tx, &root).unwrap();
    tx.commit().unwrap();
    assert!(!original.exists());
    assert!(!root.join("pending.import").exists());

    db.execute("INSERT INTO blob VALUES (?1, 9)", [&digest])
        .unwrap();
    fs::write(&original, b"committed").unwrap();
    fs::write(root.join("pending.import"), &digest).unwrap();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    recover(&tx, &root).unwrap();
    tx.commit().unwrap();
    assert_eq!(fs::read(&original).unwrap(), b"committed");
    assert!(!root.join("pending.import").exists());

    fs::write(root.join("pending.import"), "../../invalid").unwrap();
    let tx = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    assert!(recover(&tx, &root).is_err());
    drop(tx);
    assert_eq!(fs::read(&original).unwrap(), b"committed");
    drop(db);
    for name in ["pending.import", "catalog.sqlite"] {
        fs::remove_file(root.join(name)).unwrap();
    }
    fs::remove_file(original).unwrap();
    fs::remove_dir(root).unwrap();
}

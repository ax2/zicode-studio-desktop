use super::*;

fn fixture() -> (PathBuf, PathBuf, Store) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .join(format!("visual-assets-jobs-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(root.join("library")).unwrap();
    fs::create_dir(root.join("destination")).unwrap();
    let library = root.join("library");
    let store = Store::open(&root.join("jobs"), &library).unwrap();
    catalog::open(&library).unwrap();
    (root, library, store)
}

fn clean(root: PathBuf) {
    let scratch = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../.cache/task-scratch")
        .canonicalize()
        .unwrap();
    let root = root.canonicalize().unwrap();
    assert_eq!(root.parent(), Some(scratch.as_path()));
    assert!(root
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with("visual-assets-jobs-test-"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn legacy_jobs_migrate_and_restore_shares_the_active_job_limit() {
    let (root, library, _) = fixture();
    let legacy = root.join("legacy");
    fs::create_dir(&legacy).unwrap();
    let db = Connection::open(legacy.join("backups.sqlite")).unwrap();
    db.execute_batch("CREATE TABLE job (ordinal INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
        state TEXT NOT NULL, phase TEXT NOT NULL, destination TEXT NOT NULL);
        INSERT INTO job(id,state,phase,destination) VALUES ('legacy','completed','snapshot-published','old');").unwrap();
    drop(db);
    let store = Store::open(&legacy, &library).unwrap();
    assert_eq!(store.latest().unwrap().unwrap().operation, "backup");
    let job = store.begin_restore(&library).unwrap();
    assert!(store.begin(&root.join("destination"), false).is_err());
    store.cancel(&job.id).unwrap();
    assert!(store.run_restore(&job, &root, &|_| {}).is_err());
    assert_eq!(store.latest().unwrap().unwrap().state, "cancelled");
    assert!(library.join("catalog.sqlite").exists());
    clean(root);
}

#[test]
fn cancelled_queued_job_creates_no_backup_and_preserves_its_terminal_status() {
    let (root, library, store) = fixture();
    let job = store.begin(&root.join("destination"), false).unwrap();
    assert!(store.begin(&root.join("destination"), false).is_err());
    assert!(store.cancel("another-job").is_err());
    store.cancel(&job.id).unwrap();
    assert!(store.run(&job, &library, &|_| {}).is_err());
    assert!(!job.destination.exists());
    assert_eq!(store.latest().unwrap().unwrap().state, "cancelled");
    let restarted = Store::open(&root.join("jobs"), &library).unwrap();
    assert_eq!(restarted.latest().unwrap().unwrap().state, "cancelled");
    clean(root);
}

#[test]
fn completed_backup_is_durable_and_restart_never_resubmits_unfinished_work() {
    let (root, library, store) = fixture();
    let job = store.begin(&root.join("destination"), false).unwrap();
    store.run(&job, &library, &|_| {}).unwrap();
    assert!(job.destination.join("snapshot/manifest.json").exists());
    assert_eq!(
        Store::open(&root.join("jobs"), &library)
            .unwrap()
            .latest()
            .unwrap()
            .unwrap()
            .state,
        "completed"
    );
    assert!(store.cancel(&job.id).is_err());
    let queued = store.begin(&root.join("destination"), false).unwrap();
    store.checkpoint(&queued.id, "copying-originals").unwrap();
    let restarted = Store::open(&root.join("jobs"), &library).unwrap();
    assert_eq!(restarted.latest().unwrap().unwrap().state, "interrupted");
    assert!(!queued.destination.exists());
    let next = restarted.begin(&root.join("destination"), false).unwrap();
    assert_ne!(next.id, queued.id);
    restarted.interrupted(&next.id).unwrap();
    clean(root);
}

#[test]
fn restart_does_not_claim_publication_for_a_different_catalog() {
    let (root, library, store) = fixture();
    let job = store.begin_restore(&library).unwrap();
    store.checkpoint(&job.id, "preparing").unwrap();
    store.prepare_restore(&job.id, &"0".repeat(64)).unwrap();
    assert!(store.cancel(&job.id).is_err());
    let catalog = library.join("catalog.sqlite");
    let before = snapshot::hash(&catalog).unwrap();
    let reopened = Store::open(&root.join("jobs"), &library).unwrap();
    assert_eq!(reopened.latest().unwrap().unwrap().state, "interrupted");
    assert_eq!(snapshot::hash(&catalog).unwrap(), before);
    clean(root);
}

#[test]
fn publishing_is_a_cancellation_boundary_and_failed_sources_remain_failed() {
    let (root, library, store) = fixture();
    let job = store.begin(&root.join("destination"), false).unwrap();
    store.checkpoint(&job.id, "preparing").unwrap();
    store.prepare_backup(&job.id, &"0".repeat(64)).unwrap();
    assert!(store.cancel(&job.id).is_err());
    store.interrupted(&job.id).unwrap();
    let job = store.begin(&root.join("destination"), false).unwrap();
    let db = catalog::open(&library).unwrap();
    db.execute("INSERT INTO blob VALUES (?1,1)", ["a".repeat(64)])
        .unwrap();
    drop(db);
    assert!(store.run(&job, &library, &|_| {}).is_err());
    assert_eq!(store.latest().unwrap().unwrap().state, "failed");
    assert!(!job.destination.join("snapshot").exists());
    clean(root);
}

#[test]
fn selected_directory_cannot_be_replaced_while_work_is_queued() {
    let (root, _, _) = fixture();
    let selected = root.join("destination");
    let (_, handles) = super::super::backup_destination::hold(&selected).unwrap();
    assert!(fs::rename(&selected, root.join("replaced")).is_err());
    drop(handles);
    fs::rename(&selected, root.join("replaced")).unwrap();
    clean(root);
}

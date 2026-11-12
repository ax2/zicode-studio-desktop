use super::*;
use crate::visual_assets::catalog;
use std::os::windows::process::CommandExt;

const CHILD: &str =
    "visual_assets::novel_draft_commands::watch::store::crash_tests::watch_crash_child";

#[test]
fn watch_crash_child() {
    let Some(root) = std::env::var_os("ZICODE_WATCH_CRASH_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let fixture: Value =
        serde_json::from_slice(&std::fs::read(root.join("fixture.json")).unwrap()).unwrap();
    let workspace = fixture["workspace"].as_str().unwrap();
    let scope: Scope = serde_json::from_value(fixture["scope"].clone()).unwrap();
    let notes = NotesVault::new(root.join("plugins"))
        .unwrap()
        .scoped(workspace)
        .unwrap();
    let catalog = catalog::open(&root.join("library")).unwrap();
    let store = Store::open(&root.join("jobs"), "library", workspace).unwrap();
    let phase = std::env::var("ZICODE_WATCH_CRASH_PHASE").unwrap();
    let lease = store
        .lease(&store.get(&scope).unwrap().unwrap().id)
        .unwrap();
    if phase == "busy" {
        assert!(lease.is_none());
        std::process::exit(88);
    }
    let _lease = lease.unwrap();
    if phase == "before" {
        store
            .tick_with(&catalog, &notes, &scope, 0, &|| std::process::exit(86))
            .unwrap();
    } else {
        assert!(store.tick(&catalog, &notes, &scope, 0).unwrap());
        std::process::exit(87);
    }
    panic!("Crash hook was not reached");
}

#[test]
fn recovers_real_process_exits_before_and_after_checkpoint_commit() {
    let root = std::env::temp_dir().join(format!("zicode-watch-crash-{}", Uuid::new_v4()));
    let workspace = Uuid::new_v4().to_string();
    let notes = NotesVault::new(root.join("plugins"))
        .unwrap()
        .scoped(&workspace)
        .unwrap();
    let book = notes.create_notebook("小说", None, None).unwrap();
    for index in 0..25 {
        notes
            .create_note(
                &book.id,
                &format!("章节{index}"),
                "绘光守桥。",
                vec![],
                None,
                None,
            )
            .unwrap();
    }
    std::fs::create_dir(root.join("library")).unwrap();
    let mut db = catalog::open(&root.join("library")).unwrap();
    let tx = db.transaction().unwrap();
    let character = characters::create(&tx, "绘光", "人工设定").unwrap();
    tx.commit().unwrap();
    let scope = Scope {
        character_id: character,
        notebook_id: book.id,
        facet: Facet::Identity,
    };
    let store = Store::open(&root.join("jobs"), "library", &workspace).unwrap();
    store.start(&db, &scope).unwrap();
    std::fs::write(root.join("fixture.json"),serde_json::to_vec(&json!({"workspace":workspace,
        "scope":{"characterId":scope.character_id,"notebookId":scope.notebook_id,"facet":"identity"}})).unwrap()).unwrap();
    drop(notes);
    drop(db);

    let held = store
        .lease(&store.get(&scope).unwrap().unwrap().id)
        .unwrap()
        .unwrap();
    let busy = crate::process_command::new_command(std::env::current_exe().unwrap())
        .creation_flags(0x08000000)
        .args(["--exact", CHILD, "--nocapture"])
        .env("ZICODE_WATCH_CRASH_ROOT", &root)
        .env("ZICODE_WATCH_CRASH_PHASE", "busy")
        .output()
        .unwrap();
    assert_eq!(busy.status.code(), Some(88));
    drop(held);
    for (phase, code, count) in [("before", 86, 0), ("after", 87, 20)] {
        let output = crate::process_command::new_command(std::env::current_exe().unwrap())
            .creation_flags(0x08000000)
            .args(["--exact", CHILD, "--nocapture"])
            .env("ZICODE_WATCH_CRASH_ROOT", &root)
            .env("ZICODE_WATCH_CRASH_PHASE", phase)
            .output()
            .unwrap();
        assert_eq!(
            output.status.code(),
            Some(code),
            "child output: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let recovered = store.get(&scope).unwrap().unwrap();
        assert!(store.lease(&recovered.id).unwrap().is_some());
        assert_eq!(recovered.pending, count);
        assert_eq!(recovered.completed_passes, 0);
        assert_eq!(recovered.after.is_some(), count > 0);
    }
    let notes = NotesVault::new(root.join("plugins"))
        .unwrap()
        .scoped(&workspace)
        .unwrap();
    let db = catalog::open(&root.join("library")).unwrap();
    assert!(store.tick(&db, &notes, &scope, 1000).unwrap());
    let complete = store.get(&scope).unwrap().unwrap();
    assert_eq!((complete.pending, complete.completed_passes), (25, 1));
    assert!(complete.after.is_none());
    assert_eq!(
        characters::latest(&db, &scope.character_id, Facet::Identity).unwrap(),
        Some(1)
    );
    drop(db);
    drop(notes);
    std::fs::remove_dir_all(root).unwrap();
}

use super::*;
use crate::visual_assets::{
    catalog,
    novel_draft_commands::{chapter, with_notes, Action},
    novel_drafts::Proposal,
};

#[test]
fn resumes_batches_atomically_and_tracks_edits_deletions_and_author_approval() {
    let root = std::env::temp_dir().join(format!("zicode-chapter-watch-{}", Uuid::new_v4()));
    let workspace = Uuid::new_v4().to_string();
    let notes = NotesVault::new(root.join("plugins"))
        .unwrap()
        .scoped(&workspace)
        .unwrap();
    let book = notes.create_notebook("小说", None, None).unwrap();
    let chapters: Vec<_> = (0..25)
        .map(|index| {
            notes
                .create_note(
                    &book.id,
                    &format!("章节{index}"),
                    "绘光守桥。",
                    vec![],
                    None,
                    None,
                )
                .unwrap()
        })
        .collect();
    let library_path = root.join("library");
    std::fs::create_dir(&library_path).unwrap();
    let mut catalog = catalog::open(&library_path).unwrap();
    let tx = catalog.transaction().unwrap();
    let character = characters::create(&tx, "绘光", "人工设定").unwrap();
    tx.commit().unwrap();
    let scope = Scope {
        character_id: character.clone(),
        notebook_id: book.id.clone(),
        facet: Facet::Identity,
    };
    let jobs = root.join("jobs");
    let store = Store::open(&jobs, "library", &workspace).unwrap();
    assert!(store.get(&scope).unwrap().is_none());
    let id = store.start(&catalog, &scope).unwrap().id;
    assert!(store.tick(&catalog, &notes, &scope, 0).unwrap());
    let partial = store.get(&scope).unwrap().unwrap();
    assert_eq!(partial.pending, 20);
    assert_eq!(partial.completed_passes, 0);
    assert!(partial.after.is_some());
    drop(store);

    // A fresh connection recovers the exact checkpoint. Failure before commit cannot advance it.
    let store = Store::open(&jobs, "library", &workspace).unwrap();
    assert_eq!(store.get(&scope).unwrap().unwrap().id, id);
    assert!(store
        .tick_with(&catalog, &notes, &scope, 1_000, &|| Err(
            "injected interruption".into()
        ))
        .is_err());
    let failed = store.get(&scope).unwrap().unwrap();
    assert_eq!(failed.pending, 20);
    assert_eq!(failed.after, partial.after);
    assert!(store.tick(&catalog, &notes, &scope, 1_000).unwrap());
    let ready = store.get(&scope).unwrap().unwrap();
    assert_eq!((ready.pending, ready.completed_passes), (25, 1));
    assert!(ready.checked_at.is_some());
    let first = store.page(&scope, None).unwrap();
    assert_eq!(first["entries"].as_array().unwrap().len(), 20);
    let last = store.page(&scope, first["next"].as_str()).unwrap();
    assert_eq!(last["entries"].as_array().unwrap().len(), 5);
    assert!(last["next"].is_null());

    // Catalog/role versions only change through the explicit author actions below.
    assert_eq!(
        characters::latest(&catalog, &character, Facet::Identity).unwrap(),
        Some(1)
    );
    let source = chapter(&chapters[0], &workspace);
    let draft_id = Uuid::new_v4();
    let proposal = Proposal {
        draft_id,
        character_id: character.clone(),
        facet: Facet::Identity,
        base_version: Some(1),
        evidence: source.excerpts("绘光").unwrap().remove(0),
        text: "守桥人".into(),
    };
    with_notes(
        &mut catalog,
        &library_path,
        &notes,
        &workspace,
        Action::Save { proposal },
    )
    .unwrap();
    with_notes(
        &mut catalog,
        &library_path,
        &notes,
        &workspace,
        Action::Approve { id: draft_id },
    )
    .unwrap();
    let edited = notes
        .save_note(
            &book.id,
            &chapters[0].summary.id,
            "章节改稿",
            "绘光等雨停。",
            vec![],
            None,
            &chapters[0].summary.version,
        )
        .unwrap();
    notes
        .delete_note(
            &book.id,
            &chapters[1].summary.id,
            &chapters[1].summary.version,
        )
        .unwrap();
    let added = notes
        .create_note(&book.id, "新增章节", "绘光归来。", vec![], None, None)
        .unwrap();
    assert!(!store.tick(&catalog, &notes, &scope, 2_000).unwrap());
    store.tick(&catalog, &notes, &scope, 31_000).unwrap();
    store.tick(&catalog, &notes, &scope, 32_000).unwrap();
    let page1 = store.page(&scope, None).unwrap();
    let page2 = store.page(&scope, page1["next"].as_str()).unwrap();
    let entries: Vec<_> = page1["entries"]
        .as_array()
        .unwrap()
        .iter()
        .chain(page2["entries"].as_array().unwrap())
        .collect();
    assert_eq!(entries.len(), 25);
    assert!(entries.iter().any(|entry| entry["id"] == edited.summary.id
        && entry["revision"] == edited.summary.version
        && entry["status"] == "chapterChanged"));
    assert!(entries.iter().any(|entry| entry["id"] == added.summary.id));
    assert!(!entries
        .iter()
        .any(|entry| entry["id"] == chapters[1].summary.id));
    assert_eq!(
        characters::latest(&catalog, &character, Facet::Identity).unwrap(),
        Some(2)
    );
    store.pause(&scope, None).unwrap();
    assert!(!store.tick(&catalog, &notes, &scope, 100_000).unwrap());
    assert_eq!(store.get(&scope).unwrap().unwrap().state, "paused");
    assert_eq!(store.start(&catalog, &scope).unwrap().id, id);
    assert!(store.tick(&catalog, &notes, &scope, 100_000).unwrap());

    let source = chapter(&edited, &workspace);
    let pending_id = Uuid::new_v4();
    let proposal = Proposal {
        draft_id: pending_id,
        character_id: character.clone(),
        facet: Facet::Identity,
        base_version: Some(2),
        evidence: source.excerpts("绘光").unwrap().remove(0),
        text: "雨中的守桥人".into(),
    };
    with_notes(
        &mut catalog,
        &library_path,
        &notes,
        &workspace,
        Action::Save { proposal },
    )
    .unwrap();
    for now in [101_000, 132_000, 133_000] {
        store.tick(&catalog, &notes, &scope, now).unwrap();
    }
    assert_eq!(store.get(&scope).unwrap().unwrap().pending, 24);
    assert_eq!(
        characters::latest(&catalog, &character, Facet::Identity).unwrap(),
        Some(2)
    );
    let tx = catalog.transaction().unwrap();
    characters::append(&tx, &character, Facet::Identity, Some(2), "作者再次更新").unwrap();
    tx.commit().unwrap();
    for now in [163_000, 164_000] {
        store.tick(&catalog, &notes, &scope, now).unwrap();
    }
    assert_eq!(store.get(&scope).unwrap().unwrap().pending, 25);
    let first = store.page(&scope, None).unwrap();
    let second = store.page(&scope, first["next"].as_str()).unwrap();
    assert!(first["entries"]
        .as_array()
        .unwrap()
        .iter()
        .chain(second["entries"].as_array().unwrap())
        .any(|entry| entry["id"] == edited.summary.id && entry["status"] == "baseChanged"));
    assert!(with_notes(
        &mut catalog,
        &library_path,
        &notes,
        &workspace,
        Action::Approve { id: pending_id }
    )
    .is_err());
    assert_eq!(
        characters::latest(&catalog, &character, Facet::Identity).unwrap(),
        Some(3)
    );

    // Neither another workspace/library nor another character facet can read the queue.
    assert!(Store::open(&jobs, "library", &Uuid::new_v4().to_string())
        .unwrap()
        .get(&scope)
        .unwrap()
        .is_none());
    assert!(Store::open(&jobs, "other-library", &workspace)
        .unwrap()
        .get(&scope)
        .unwrap()
        .is_none());
    let appearance = Scope {
        facet: Facet::Appearance,
        ..scope.clone()
    };
    assert!(store.get(&appearance).unwrap().is_none());
    notes.delete_notebook(&book.id).unwrap();
    assert!(store.tick(&catalog, &notes, &scope, 200_000).is_err());
    let checkpoint = store.get(&scope).unwrap().unwrap();
    assert_eq!(checkpoint.completed_passes, 5);
    drop(catalog);
    drop(notes);
    std::fs::remove_dir_all(root).unwrap();
}

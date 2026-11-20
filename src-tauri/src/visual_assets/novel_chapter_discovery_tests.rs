use super::*;

#[test]
fn discovers_new_and_changed_chapters_across_pages_and_persisted_scoped_history() {
    let root = std::env::temp_dir().join(format!("zicode-chapter-discovery-{}", Uuid::new_v4()));
    let workspace = Uuid::new_v4().to_string();
    let vault = NotesVault::new(root.join("plugins")).unwrap();
    let notes = vault.scoped(&workspace).unwrap();
    let book = notes.create_notebook("小说", None, None).unwrap();
    let other_book = notes.create_notebook("另一小说", None, None).unwrap();
    notes
        .create_note(&other_book.id, "不可混入", "绘光", vec![], None, None)
        .unwrap();
    let library = root.join("library");
    std::fs::create_dir(&library).unwrap();
    let mut db = catalog::open(&library).unwrap();
    let tx = db.transaction().unwrap();
    let character = characters::create(&tx, "绘光", "作者设定").unwrap();
    let chapters: Vec<_> = (0..24)
        .map(|index| {
            notes
                .create_note(
                    &book.id,
                    &format!("章节{index:02}"),
                    "绘光守桥。",
                    vec![],
                    None,
                    None,
                )
                .unwrap()
        })
        .collect();
    // All saved history is relevant, including entries outside the first UI page.
    for note in chapters.iter().take(23) {
        let source = chapter(note, &workspace);
        let proposal = Proposal {
            draft_id: Uuid::new_v4(),
            character_id: character.clone(),
            facet: Facet::Identity,
            base_version: Some(1),
            evidence: source.excerpts("绘光").unwrap().remove(0),
            text: "旧草案".into(),
        };
        novel_drafts::create(&tx, &proposal, source).unwrap();
    }
    tx.commit().unwrap();
    drop(db);
    let mut db = catalog::open(&library).unwrap();
    let changed = notes
        .save_note(
            &book.id,
            &chapters[0].summary.id,
            "章节00改稿",
            "绘光等雨停。",
            vec![],
            None,
            &chapters[0].summary.version,
        )
        .unwrap();

    let scan = |db: &mut Connection, scope: &str, facet: &str, only: bool, title: &str| {
        let mut after = Value::Null;
        let mut found = Vec::new();
        let mut pages = 0;
        loop {
            let action: Action = serde_json::from_value(json!({"kind":"discover","query":{
                "characterId":character,"notebookId":book.id,"facet":facet,
                "title":title,"after":after,"needsWorkOnly":only
            }}))
            .unwrap();
            let page = with_notes(db, &library, &notes, scope, action).unwrap();
            let entries = page["entries"].as_array().unwrap();
            assert!(entries.len() <= 20);
            assert!(entries
                .iter()
                .all(|entry| entry.get("body").is_none() && entry.get("quote").is_none()));
            found.extend(entries.clone());
            after = page["next"].clone();
            pages += 1;
            assert!(pages < 4);
            if after.is_null() {
                break;
            }
        }
        (found, pages)
    };
    let (all, pages) = scan(&mut db, &workspace, "identity", false, "");
    assert_eq!((all.len(), pages), (24, 2));
    let ids: std::collections::HashSet<_> = all
        .iter()
        .map(|entry| entry["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 24);
    let (pending, _) = scan(&mut db, &workspace, "identity", true, "");
    assert_eq!(pending.len(), 2);
    assert!(pending.iter().any(|entry| entry["id"] == changed.summary.id
        && entry["status"] == "chapterChanged"
        && entry["revision"] == changed.summary.version));
    assert!(pending
        .iter()
        .any(|entry| entry["id"] == chapters[23].summary.id && entry["status"] == "new"));
    assert_eq!(
        scan(&mut db, &workspace, "identity", true, "00改稿")
            .0
            .len(),
        1
    );
    assert_eq!(
        scan(&mut db, &workspace, "appearance", true, "").0.len(),
        24
    );
    assert_eq!(
        scan(&mut db, &Uuid::new_v4().to_string(), "identity", true, "")
            .0
            .len(),
        24
    );

    let tx = db.transaction().unwrap();
    characters::append(&tx, &character, Facet::Identity, Some(1), "人工更新").unwrap();
    tx.commit().unwrap();
    let pending = scan(&mut db, &workspace, "identity", true, "").0;
    assert_eq!(
        pending
            .iter()
            .filter(|entry| entry["status"] == "baseChanged")
            .count(),
        22
    );
    let source = chapter(&changed, &workspace);
    let proposal = Proposal {
        draft_id: Uuid::new_v4(),
        character_id: character.clone(),
        facet: Facet::Identity,
        base_version: Some(2),
        evidence: source.excerpts("绘光").unwrap().remove(0),
        text: "新草案".into(),
    };
    let id = proposal.draft_id;
    with_notes(
        &mut db,
        &library,
        &notes,
        &workspace,
        Action::Save { proposal },
    )
    .unwrap();
    assert!(scan(&mut db, &workspace, "identity", true, "00改稿")
        .0
        .is_empty());
    with_notes(
        &mut db,
        &library,
        &notes,
        &workspace,
        Action::Approve { id },
    )
    .unwrap();
    assert!(scan(&mut db, &workspace, "identity", true, "00改稿")
        .0
        .is_empty());
    // Discovery never creates or approves records itself.
    assert_eq!(
        characters::latest(&db, &character, Facet::Identity).unwrap(),
        Some(3)
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM novel_character_draft", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        24
    );

    let foreign = vault.scoped(&Uuid::new_v4().to_string()).unwrap();
    assert!(foreign.chapter_page(&book.id, None).is_err());
    assert!(notes.chapter_page(&book.id, Some("../bad")).is_err());
    notes
        .delete_note(
            &book.id,
            &chapters[23].summary.id,
            &chapters[23].summary.version,
        )
        .unwrap();
    assert_eq!(scan(&mut db, &workspace, "identity", false, "").0.len(), 23);
    drop(db);
    drop(notes);
    drop(vault);
    std::fs::remove_dir_all(root).unwrap();
}

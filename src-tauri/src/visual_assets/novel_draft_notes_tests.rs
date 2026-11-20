use super::*;

#[test]
fn reads_scoped_notes_and_rejects_a_draft_after_the_note_changes() {
    let root = std::env::temp_dir().join(format!("zicode-novel-notes-{}", Uuid::new_v4()));
    let notes = NotesVault::new(root.join("plugins")).unwrap();
    let workspace_id = Uuid::new_v4().to_string();
    let workspace = workspace_id.as_str();
    let notes = notes.scoped(workspace).unwrap();
    let book = notes.create_notebook("小说", None, None).unwrap();
    let first = notes
        .create_note(
            &book.id,
            "章节一",
            "# 开场\n绘光守在桥头。\n",
            vec![],
            None,
            None,
        )
        .unwrap();
    let library = root.join("library");
    std::fs::create_dir(&library).unwrap();
    let mut db = catalog::open(&library).unwrap();
    let tx = db.transaction().unwrap();
    let character = characters::create(&tx, "绘光", "作者设定").unwrap();
    tx.commit().unwrap();
    let preview = with_notes(
        &mut db,
        &library,
        &notes,
        workspace,
        Action::Preview {
            character_id: character.clone(),
            facet: Facet::Identity,
            notebook_id: book.id.clone(),
            chapter_id: first.summary.id.clone(),
            revision: first.summary.version.clone(),
            phrase: "绘光".into(),
        },
    )
    .unwrap();
    assert_eq!(preview["baseVersion"], 1);
    assert_eq!(preview["excerpts"][0]["line"], 2);
    assert_eq!(preview["excerpts"][0]["revision"], first.summary.version);
    let id = Uuid::new_v4();
    let proposal = serde_json::from_value(
        json!({"draftId":id,"characterId":character,"facet":"identity",
        "baseVersion":1,"evidence":preview["excerpts"][0],"text":"守在桥头的绘光"}),
    )
    .unwrap();
    with_notes(
        &mut db,
        &library,
        &notes,
        workspace,
        Action::Save { proposal },
    )
    .unwrap();
    let edited = notes
        .save_note(
            &book.id,
            &first.summary.id,
            "章节一",
            "# 改稿\n绘光守在桥头。\n",
            vec![],
            None,
            &first.summary.version,
        )
        .unwrap();
    assert_ne!(edited.summary.version, first.summary.version);
    assert_eq!(
        with_notes(&mut db, &library, &notes, workspace, Action::Approve { id })
            .unwrap_err()
            .to_string(),
        "visual_assets_chapter_changed"
    );
    assert_eq!(
        characters::latest(&db, &character, Facet::Identity).unwrap(),
        Some(1)
    );
    drop(db);
    drop(notes);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn reviews_changed_current_and_unavailable_chapters_before_preparing_a_new_draft() {
    let root = std::env::temp_dir().join(format!("zicode-novel-review-{}", Uuid::new_v4()));
    let notes = NotesVault::new(root.join("plugins")).unwrap();
    let workspace = Uuid::new_v4().to_string();
    let notes = notes.scoped(&workspace).unwrap();
    let book = notes.create_notebook("小说", None, None).unwrap();
    let library = root.join("library");
    std::fs::create_dir(&library).unwrap();
    let mut db = catalog::open(&library).unwrap();
    let tx = db.transaction().unwrap();
    let character = characters::create(&tx, "绘光", "原有设定").unwrap();
    let chapters: Vec<_> = [
        ("桥头", Facet::Identity),
        ("山上", Facet::Appearance),
        ("市集", Facet::Style),
    ]
    .into_iter()
    .map(|(title, facet)| {
        let note = notes
            .create_note(&book.id, title, "绘光出场。", vec![], None, None)
            .unwrap();
        let current = chapter(&note, &workspace);
        let id = Uuid::new_v4();
        let proposal = Proposal {
            draft_id: id,
            character_id: character.clone(),
            facet,
            base_version: characters::latest(&tx, &character, facet).unwrap(),
            evidence: current.excerpts("绘光").unwrap().remove(0),
            text: "旧草案".into(),
        };
        novel_drafts::create(&tx, &proposal, current).unwrap();
        (note, id)
    })
    .collect();
    assert_eq!(
        characters::append(&tx, &character, Facet::Identity, Some(1), "作者改稿").unwrap(),
        2
    );
    tx.commit().unwrap();

    let changed = &chapters[0].0.summary;
    let current = notes
        .save_note(
            &book.id,
            &changed.id,
            "雨中的桥头",
            "绘光在桥头等雨停。",
            vec![],
            None,
            &changed.version,
        )
        .unwrap();
    let removed = &chapters[2].0.summary;
    notes
        .delete_note(&book.id, &removed.id, &removed.version)
        .unwrap();
    let draft_ids: Vec<_> = chapters.iter().map(|(_, id)| *id).collect();
    let report = with_notes(
        &mut db,
        &library,
        &notes,
        &workspace,
        Action::Review {
            character_id: character.clone(),
            draft_ids: draft_ids.clone(),
        },
    )
    .unwrap();
    assert_eq!(
        report["entries"],
        json!([
            {"id":draft_ids[0],"latest":{"id":current.summary.id,"title":"雨中的桥头","revision":current.summary.version},
             "chapterChanged":true,"baseChanged":true},
            {"id":draft_ids[1],"latest":{"id":chapters[1].0.summary.id,"title":"山上","revision":chapters[1].0.summary.version},
             "chapterChanged":false,"baseChanged":false},
            {"id":draft_ids[2],"latest":null,"chapterChanged":false,"baseChanged":false}
        ])
    );
    let foreign_workspace = Uuid::new_v4().to_string();
    assert_eq!(
        json!(review::check(&db, &notes, &foreign_workspace, &character, &draft_ids).unwrap())[0]
            ["latest"],
        Value::Null
    );
    assert_eq!(
        review::check(&db, &notes, &workspace, "another character", &draft_ids)
            .err()
            .unwrap()
            .to_string(),
        "visual_assets_draft_missing"
    );
    assert_eq!(
        review::check(&db, &notes, &workspace, &character, &[draft_ids[0]; 11])
            .err()
            .unwrap()
            .to_string(),
        "visual_assets_draft_review_size"
    );
    assert_eq!(
        characters::latest(&db, &character, Facet::Identity).unwrap(),
        Some(2)
    );
    let recheck = with_notes(
        &mut db,
        &library,
        &notes,
        &workspace,
        Action::Preview {
            character_id: character.clone(),
            facet: Facet::Identity,
            notebook_id: book.id,
            chapter_id: current.summary.id,
            revision: current.summary.version,
            phrase: "绘光".into(),
        },
    )
    .unwrap();
    assert_eq!(recheck["baseVersion"], 2);
    assert_eq!(recheck["excerpts"][0]["quote"], "绘光在桥头等雨停。");
    assert_eq!(
        novel_drafts::list(&db, &character, None).unwrap().0.len(),
        3
    );
    drop(db);
    drop(notes);
    std::fs::remove_dir_all(root).unwrap();
}

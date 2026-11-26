use super::*;
fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("browser-bookmarks-{}", uuid::Uuid::new_v4()))
}
fn folder(title: &str, parent_id: Option<String>) -> Folder {
    Folder {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.into(),
        parent_id,
        position: None,
    }
}
fn bookmark(folder_id: Option<String>) -> Bookmark {
    Bookmark {
        id: uuid::Uuid::new_v4().to_string(),
        title: "开发资料".into(),
        url: "https://example.org/".into(),
        folder_id,
        position: None,
        shortcut: false,
    }
}
fn save(rev: i64, folders: Vec<Folder>, bookmarks: Vec<Bookmark>) -> Request {
    Request::Save {
        expected_revision: rev,
        folders,
        bookmarks,
    }
}
#[test]
fn nested_folders_edits_and_moves_survive_reopen_without_crossing_owners() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let parent = folder("资料", None);
    let child = folder("Rust", Some(parent.id.clone()));
    let mut b = bookmark(Some(child.id.clone()));
    store
        .bookmarks(
            "a",
            save(0, vec![parent.clone(), child.clone()], vec![b.clone()]),
        )
        .unwrap();
    b.title = "New title".into();
    b.shortcut = true;
    b.folder_id = Some(parent.id.clone());
    let saved = store
        .bookmarks("a", save(1, vec![parent, child], vec![b]))
        .unwrap();
    drop(store);
    let mut reopened = Store::open(&root).unwrap();
    assert_eq!(reopened.bookmarks("a", Request::List).unwrap(), saved);
    assert_eq!(
        reopened.bookmarks("b", Request::List).unwrap(),
        Library::default()
    );
}
#[test]
fn conflict_and_invalid_mutations_leave_saved_library_unchanged() {
    let root = root();
    let mut a = Store::open(&root).unwrap();
    let mut peer = Store::open(&root).unwrap();
    let f = folder("One", None);
    let b = bookmark(Some(f.id.clone()));
    let saved = a
        .bookmarks("a", save(0, vec![f.clone()], vec![b.clone()]))
        .unwrap();
    assert!(peer.bookmarks("a", save(0, vec![], vec![])).is_err());
    let mut cycle = f.clone();
    cycle.parent_id = Some(f.id.clone());
    assert!(a
        .bookmarks("a", save(1, vec![cycle], vec![b.clone()]))
        .is_err());
    assert!(a.bookmarks("a", save(1, vec![], vec![b.clone()])).is_err());
    for url in [
        "file:///D:/notes",
        "javascript:alert(1)",
        "https://name:secret@example.org/",
    ] {
        let mut bad = b.clone();
        bad.url = url.into();
        assert!(a
            .bookmarks("a", save(1, vec![f.clone()], vec![bad]))
            .is_err());
    }
    assert_eq!(a.bookmarks("a", Request::List).unwrap(), saved);
}
#[test]
fn folder_removal_reparents_contents_atomically_and_bookmarks_can_be_deleted() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let parent = folder("Parent", None);
    let mut child = folder("Child", Some(parent.id.clone()));
    let mut b = bookmark(Some(parent.id.clone()));
    store
        .bookmarks("a", save(0, vec![parent, child.clone()], vec![b.clone()]))
        .unwrap();
    child.parent_id = None;
    b.folder_id = None;
    let moved = store
        .bookmarks("a", save(1, vec![child], vec![b.clone()]))
        .unwrap();
    assert_eq!(moved.bookmarks, vec![b]);
    let empty = store
        .bookmarks("a", save(2, moved.folders, vec![]))
        .unwrap();
    assert!(empty.bookmarks.is_empty());
}

#[test]
fn older_bookmark_reader_can_edit_after_import_without_losing_records_or_restoring_deletions() {
    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct LegacyLibrary {
        revision: i64,
        folders: Vec<LegacyFolder>,
        bookmarks: Vec<LegacyBookmark>,
    }
    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct LegacyFolder {
        id: String,
        title: String,
        parent_id: Option<String>,
    }
    #[derive(Deserialize, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct LegacyBookmark {
        id: String,
        title: String,
        url: String,
        folder_id: Option<String>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        shortcut: bool,
    }

    let root = root();
    let mut store = Store::open(&root).unwrap();
    let mut folder_moved = folder("Move after downgrade", None);
    folder_moved.position = Some(1);
    let mut kept_folder = folder("Keep in place", None);
    kept_folder.position = Some(2);
    let mut earlier = bookmark(None);
    earlier.title = "Earlier".into();
    earlier.position = Some(0);
    let mut deleted = bookmark(None);
    deleted.position = Some(3);
    let mut external = bookmark(None);
    external.title = "Second owner".into();
    external.position = Some(0);
    let independent = store
        .bookmarks("b", save(0, vec![], vec![external]))
        .unwrap();
    store
        .bookmarks(
            "a",
            save(
                0,
                vec![folder_moved.clone(), kept_folder.clone()],
                vec![earlier.clone(), deleted.clone()],
            ),
        )
        .unwrap();
    drop(store);

    let old = rusqlite::Connection::open(root.join("metadata.sqlite3")).unwrap();
    let version: i64 = old
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 6);
    let payload: String = old
        .query_row(
            "SELECT payload FROM browser_bookmarks WHERE owner='a'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let mut library: LegacyLibrary = serde_json::from_str(&payload).unwrap();
    assert_eq!(library.folders.len(), 2);
    assert_eq!(library.bookmarks.len(), 2);
    let moved = library
        .folders
        .iter_mut()
        .find(|entry| entry.id == folder_moved.id)
        .unwrap();
    moved.parent_id = Some(kept_folder.id.clone());
    let archived_parent = library
        .bookmarks
        .iter_mut()
        .find(|entry| entry.id == earlier.id)
        .unwrap();
    archived_parent.title = "Renamed with the older build".into();
    library.bookmarks.retain(|entry| entry.id != deleted.id);
    let added = bookmark(None);
    library.bookmarks.push(LegacyBookmark {
        id: added.id.clone(),
        title: "Added with the older build".into(),
        url: added.url,
        folder_id: None,
        shortcut: true,
    });
    library.revision += 1;
    old.execute(
        "UPDATE browser_bookmarks SET revision=?1,payload=?2 WHERE owner='a'",
        params![library.revision, serde_json::to_string(&library).unwrap()],
    )
    .unwrap();
    drop(old);

    let mut current = Store::open(&root).unwrap();
    let reopened = current.bookmarks("a", Request::List).unwrap();
    assert_eq!(reopened.revision, 2);
    assert_eq!(reopened.bookmarks.len(), 2);
    assert_eq!(reopened.bookmarks[0].title, "Renamed with the older build");
    assert_eq!(reopened.bookmarks[0].position, earlier.position);
    assert_eq!(reopened.folders[1].position, kept_folder.position);
    assert_eq!(
        reopened.folders[0].parent_id.as_deref(),
        Some(kept_folder.id.as_str())
    );
    assert!(reopened.folders[0].position > deleted.position);
    assert_eq!(reopened.bookmarks[1].id, added.id);
    assert!(reopened.bookmarks[1].shortcut);
    assert!(reopened.bookmarks[1].position > kept_folder.position);
    assert!(!reopened
        .bookmarks
        .iter()
        .any(|entry| entry.id == deleted.id));
    assert_eq!(current.bookmarks("b", Request::List).unwrap(), independent);

    // Damaged optional ordering allows the sessions' bookmark content to still open.
    current
        .0
        .execute(
            "UPDATE browser_bookmark_order SET payload='invalid' WHERE owner='a'",
            [],
        )
        .unwrap();
    let fallback = current.bookmarks("a", Request::List).unwrap();
    assert_eq!(fallback.revision, reopened.revision);
    assert_eq!(fallback.bookmarks[0].title, reopened.bookmarks[0].title);
    assert_eq!(fallback.bookmarks[1].id, added.id);
    assert_eq!(fallback.bookmarks[0].position, None);
    drop(current);
    std::fs::remove_dir_all(root).unwrap();
}

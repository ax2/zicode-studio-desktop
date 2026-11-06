use super::*;
fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("browser-bookmarks-{}", uuid::Uuid::new_v4()))
}
fn folder(title: &str, parent_id: Option<String>) -> Folder {
    Folder {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.into(),
        parent_id,
    }
}
fn bookmark(folder_id: Option<String>) -> Bookmark {
    Bookmark {
        id: uuid::Uuid::new_v4().to_string(),
        title: "开发资料".into(),
        url: "https://example.org/".into(),
        folder_id,
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

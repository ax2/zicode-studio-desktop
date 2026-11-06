use super::*;
fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("browser-history-{}", uuid::Uuid::new_v4()))
}
fn list(store: &mut Store, owner: &str, query: &str, before: Option<i64>) -> Page {
    store
        .history(
            owner,
            Request::List {
                query: query.into(),
                before,
            },
        )
        .unwrap()
}
fn add(store: &mut Store, owner: &str, title: &str) {
    store
        .record_visit(
            owner,
            "https://example.org/docs",
            title,
            "2026-11-05T01:00:00Z",
        )
        .unwrap();
}
#[test]
fn restart_search_pagination_and_owner_isolation() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    for i in 0..53 {
        add(&mut store, "a", &format!("资料 {i}"));
    }
    add(&mut store, "b", "private");
    add(&mut store, "a", "literal %_\\ <script>");
    drop(store);
    let mut store = Store::open(&root).unwrap();
    let page = list(&mut store, "a", "", None);
    assert_eq!(page.entries.len(), 50);
    assert_eq!(page.entries[0].title, "literal %_\\ <script>");
    let rest = list(&mut store, "a", "", page.next_before);
    assert_eq!(rest.entries.len(), 4);
    assert!(rest.next_before.is_none());
    assert!(page
        .entries
        .iter()
        .all(|a| rest.entries.iter().all(|b| a.id != b.id)));
    assert_eq!(list(&mut store, "a", "%_\\", None).entries.len(), 1);
    assert_eq!(list(&mut store, "a", "资料", None).entries.len(), 50);
    assert_eq!(list(&mut store, "b", "", None).entries.len(), 1);
}
#[test]
fn clear_watermark_preserves_new_visits_other_owner_and_session() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    add(&mut store, "a", "old");
    add(&mut store, "b", "other");
    let watermark = list(&mut store, "a", "", None).latest_id;
    let initial = store.state("a").unwrap();
    add(&mut store, "a", "new");
    store
        .history(
            "a",
            Request::Clear {
                through_id: watermark,
            },
        )
        .unwrap();
    let remaining = list(&mut store, "a", "", None);
    assert_eq!(remaining.entries.len(), 1);
    assert_eq!(remaining.entries[0].title, "new");
    store
        .history(
            "b",
            Request::Remove {
                id: remaining.entries[0].id,
            },
        )
        .unwrap();
    assert_eq!(list(&mut store, "a", "", None).entries.len(), 1);
    store
        .history(
            "a",
            Request::Remove {
                id: remaining.entries[0].id,
            },
        )
        .unwrap();
    assert!(list(&mut store, "a", "", None).entries.is_empty());
    assert_eq!(list(&mut store, "b", "", None).entries.len(), 1);
    assert_eq!(store.state("a").unwrap().profile_id, initial.profile_id);
    assert_eq!(store.state("a").unwrap().session, initial.session);
}
#[test]
fn invalid_urls_and_requests_never_mutate_history() {
    let mut store = Store::open(&root()).unwrap();
    add(&mut store, "a", "baseline");
    for url in [
        "about:blank",
        "file:///C:/private",
        "javascript:alert(1)",
        "https://a:secret@example.org/",
    ] {
        assert!(store
            .record_visit("a", url, "bad", "2026-11-05T00:00:00Z")
            .is_err());
    }
    assert!(store
        .history("a", Request::Clear { through_id: -1 })
        .is_err());
    assert!(store
        .history(
            "a",
            Request::List {
                query: "x".repeat(1025),
                before: None
            }
        )
        .is_err());
    assert_eq!(list(&mut store, "a", "", None).entries.len(), 1);
}

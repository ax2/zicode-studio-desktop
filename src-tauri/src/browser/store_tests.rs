use super::*;
fn root() -> std::path::PathBuf {
    std::env::temp_dir().join(format!("browser-store-{}", uuid::Uuid::new_v4()))
}
fn tab() -> SavedTab {
    SavedTab {
        id: uuid::Uuid::new_v4().to_string(),
        url: "https://example.com/docs".into(),
        title: "资料".into(),
        zoom: 1.0, muted: false,
    }
}
#[test]
fn restart_preserves_preference_profile_order_active_and_unicode() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let original = store.state("window-a").unwrap();
    assert_eq!(original.startup_mode, StartupMode::Browser);
    store.set_startup(StartupMode::Workspace).unwrap();
    let tabs = vec![tab(), tab()];
    let active = Some(tabs[1].id.clone());
    let saved = store.save("window-a", 0, tabs, active).unwrap();
    drop(store);
    let reopened = Store::open(&root).unwrap();
    let state = reopened.state("window-a").unwrap();
    assert_eq!(state.session, saved);
    assert_eq!(state.profile_id, original.profile_id);
    assert_eq!(state.startup_mode, StartupMode::Workspace);
    assert_eq!(
        reopened.state("window-b").unwrap().session,
        Session::default()
    );
}
#[test]
fn competing_connection_cannot_overwrite_newer_session() {
    let root = root();
    let mut a = Store::open(&root).unwrap();
    let mut b = Store::open(&root).unwrap();
    let tab = tab();
    let saved = a.save("owner", 0, vec![tab.clone()], Some(tab.id)).unwrap();
    assert!(b.save("owner", 0, vec![], None).is_err());
    assert_eq!(b.state("owner").unwrap().session, saved);
    assert_eq!(b.save("owner", 1, vec![], None).unwrap().revision, 2);
}
#[test]
fn rejected_input_leaves_saved_session_unchanged() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let first = tab();
    let saved = store
        .save("owner", 0, vec![first.clone()], Some(first.id.clone()))
        .unwrap();
    for url in [
        "https://alice:secret@example.com/",
        "file:///D:/notes",
        "javascript:alert(1)",
    ] {
        let mut bad = first.clone();
        bad.url = url.into();
        assert!(store
            .save("owner", 1, vec![bad], Some(first.id.clone()))
            .is_err());
    }
    assert!(store
        .save(
            "owner",
            1,
            vec![first.clone(), first.clone()],
            Some(first.id.clone())
        )
        .is_err());
    assert!(store
        .save(
            "owner",
            1,
            vec![first],
            Some(uuid::Uuid::new_v4().to_string())
        )
        .is_err());
    assert_eq!(store.state("owner").unwrap().session, saved);
}
#[test]
fn future_schema_is_preserved_and_rejected() {
    let root = root();
    let store = Store::open(&root).unwrap();
    store.0.pragma_update(None, "user_version", 6).unwrap();
    drop(store);
    assert!(Store::open(&root).is_err());
    let db = Connection::open(root.join("metadata.sqlite3")).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        6
    );
}
#[test]
fn corrupt_session_is_reported_without_resetting_data() {
    let root = root();
    let store = Store::open(&root).unwrap();
    store
        .0
        .execute(
            "INSERT INTO browser_sessions VALUES('owner',1,'broken')",
            [],
        )
        .unwrap();
    assert!(store.state("owner").is_err());
    assert_eq!(
        store
            .0
            .query_row(
                "SELECT payload FROM browser_sessions WHERE owner='owner'",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
        "broken"
    );
}

#[test]
fn closed_tab_survives_restart_and_is_consumed_atomically_when_reopened() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let tabs = vec![tab(), tab(), tab()];
    store
        .save("owner", 0, tabs.clone(), Some(tabs[1].id.clone()))
        .unwrap();
    let remaining = vec![tabs[0].clone(), tabs[2].clone()];
    let closed = store
        .save("owner", 1, remaining.clone(), Some(tabs[2].id.clone()))
        .unwrap();
    assert_eq!(closed.closed_tabs[0].tab, tabs[1]);
    assert_eq!(closed.closed_tabs[0].index, 1);
    drop(store);
    let mut store = Store::open(&root).unwrap();
    assert_eq!(store.state("owner").unwrap().session, closed);
    assert!(store
        .save("owner", 1, tabs.clone(), Some(tabs[1].id.clone()))
        .is_err());
    assert_eq!(store.state("owner").unwrap().session, closed);
    let restored = store
        .save("owner", 2, tabs.clone(), Some(tabs[1].id.clone()))
        .unwrap();
    assert!(restored.closed_tabs.is_empty());
    assert_eq!(restored.tabs, tabs);
    assert!(store.state("peer").unwrap().session.closed_tabs.is_empty());
}
#[test]
fn only_latest_fifty_closed_tabs_are_retained() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let mut latest = None;
    for n in 0..55 {
        let next = tab();
        store
            .save("owner", n * 2, vec![next.clone()], Some(next.id.clone()))
            .unwrap();
        latest = Some(next);
        store.save("owner", n * 2 + 1, vec![], None).unwrap();
    }
    let history = store.state("owner").unwrap().session.closed_tabs;
    assert_eq!(history.len(), 50);
    assert_eq!(history.last().unwrap().tab, latest.unwrap());
}
#[test]
fn version_one_sessions_upgrade_without_losing_tabs_or_preferences() {
    let root = root();
    let store = Store::open(&root).unwrap();
    let saved = tab();
    let old = serde_json::json!({"revision":7,"tabs":[saved.clone()],"activeTab":saved.id});
    store
        .0
        .execute(
            "INSERT INTO browser_sessions VALUES('owner',7,?1)",
            [old.to_string()],
        )
        .unwrap();
    store.0.pragma_update(None, "user_version", 1).unwrap();
    store.set_startup(StartupMode::Workspace).unwrap();
    drop(store);
    let upgraded = Store::open(&root).unwrap().state("owner").unwrap();
    assert_eq!(upgraded.startup_mode, StartupMode::Workspace);
    assert_eq!(upgraded.session.tabs, vec![saved]);
    assert_eq!(upgraded.session.revision, 7);
    assert!(upgraded.session.closed_tabs.is_empty());
}

#[path = "store_page_controls_tests.rs"]
mod page_controls;

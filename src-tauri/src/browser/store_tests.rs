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
        pinned: false,
        group: None,
    }
}
#[test]
fn named_profiles_do_not_replace_the_legacy_profile_or_cross_persistent_windows(){
    let path=root(); let store=Store::open(&path).unwrap();
    let default=store.state("primary").unwrap().profile_id;
    let id=store.add_profile("  研究用  ").unwrap();
    assert_ne!(id,default);
    store.bind_profile("new-window",&id).unwrap();
    assert!(store.bind_profile("other","../invalid").is_err());
    assert!(store.add_profile("研究用").is_err());
    store.insert_browser_window("primary","already-open").unwrap();
    assert!(store.register_profile_window("primary","already-open",None,Some("rollback")).is_err());
    assert_eq!(store.profiles().unwrap().len(),1);
    assert!(store.profile_for_window("already-open").unwrap().is_none());
    drop(store); let store=Store::open(&path).unwrap();
    assert_eq!(store.state("primary").unwrap().profile_id,default);
    let named=store.state("new-window").unwrap();
    assert_eq!(named.profile_name.as_deref(),Some("研究用"));
    assert_eq!(named.profile_id,id);
    assert_eq!(store.state("other").unwrap().profile_id,default);
}
#[test]
fn additional_windows_keep_sessions_and_closed_order_within_their_parent() {
    let temp=root();
    let mut store=Store::open(&temp).unwrap();
    store.insert_browser_window("main","one").unwrap();
    store.insert_browser_window("main","two").unwrap();
    store.insert_browser_window("different","other").unwrap();
    let a=tab();let b=tab();
    store.save("one",0,vec![a.clone()],Some(a.id.clone())).unwrap();
    store.save("two",0,vec![b.clone()],Some(b.id.clone())).unwrap();
    store.mark_browser_window("two",false).unwrap();
    store.mark_browser_window("other",false).unwrap();
    drop(store);
    let store=Store::open(&temp).unwrap();
    assert_eq!(store.open_browser_windows("main").unwrap(),vec!["one"]);
    assert_eq!(store.last_closed_window("main").unwrap().as_deref(),Some("two"));
    assert_eq!(store.last_closed_window("different").unwrap().as_deref(),Some("other"));
    assert_eq!(store.browser_parent("one").unwrap(),"main");
    assert_eq!(store.state("one").unwrap().session.tabs,vec![a]);
    assert_eq!(store.state("two").unwrap().session.tabs,vec![b]);
    store.mark_browser_window("two",true).unwrap();
    assert_eq!(store.open_browser_windows("main").unwrap(),vec!["one","two"]);
}
#[test]
fn named_groups_survive_close_rename_restart_and_legacy_sessions() {
    let temp=root();
    let mut store=Store::open(&temp).unwrap();
    let mut first=tab();
    let mut second=tab();
    let id=uuid::Uuid::new_v4().to_string();
    let group=groups::TabGroup{id:id.clone(),name:"阅读".into()};
    store.save("main",0,vec![first.clone(),second.clone()],Some(first.id.clone())).unwrap();
    assert!(store.state("main").unwrap().session.tabs.iter().all(|tab|tab.group.is_none()));
    first.group=Some(group.clone()); second.group=Some(group);
    store.save("main",1,vec![second.clone(),first.clone()],Some(first.id.clone())).unwrap();
    first.group.as_mut().unwrap().name="参考资料".into();
    store.save("main",2,vec![first.clone()],Some(first.id.clone())).unwrap();
    drop(store);
    let mut store=Store::open(&temp).unwrap();
    let state=store.state("main").unwrap().session;
    assert_eq!(state.tabs[0].group,first.group);
    assert_eq!(state.closed_tabs[0].tab.group,first.group);
    second=state.closed_tabs[0].tab.clone();
    store.save("main",3,vec![second.clone(),first.clone()],Some(first.id.clone())).unwrap();
    let raw:String=store.0.query_row("SELECT payload FROM browser_sessions WHERE owner='main'",[],|r|r.get(0)).unwrap();
    assert!(!raw.contains("\"group\""));
    assert_eq!(store.state("main").unwrap().session.tabs,vec![second,first.clone()]);
    assert!(store.state("other").unwrap().session.tabs.is_empty());
    first.pinned=true;
    assert!(store.save("main",4,vec![first.clone()],Some(first.id)).is_err());
}
#[test]
fn restart_preserves_preference_profile_order_active_and_unicode() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let original = store.state("window-a").unwrap();
    assert_eq!(original.startup_mode, StartupMode::Browser);
    assert!(!original.vertical_tabs);
    store.set_vertical_tabs(true).unwrap();
    store.set_startup(StartupMode::Workspace).unwrap();
    let tabs = vec![tab(), tab()];
    let active = Some(tabs[1].id.clone());
    let saved = store.save("window-a", 0, tabs, active).unwrap();
    drop(store);
    let reopened = Store::open(&root).unwrap();
    let state = reopened.state("window-a").unwrap();
    assert_eq!(state.session, saved);
    assert!(state.vertical_tabs);
    reopened.set_vertical_tabs(false).unwrap();
    assert!(!reopened.state("window-a").unwrap().vertical_tabs);
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
    store.0.pragma_update(None, "user_version", 7).unwrap();
    drop(store);
    assert!(Store::open(&root).is_err());
    let db = Connection::open(root.join("metadata.sqlite3")).unwrap();
    assert_eq!(
        db.pragma_query_value(None, "user_version", |r| r.get::<_, i64>(0))
            .unwrap(),
        7
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

#[test]
fn pins_round_trip_without_changing_legacy_session_payloads() {
    let temp = root();
    let mut store = Store::open(&temp).unwrap();
    let mut pinned = tab();
    pinned.pinned = true;
    let id = pinned.id.clone();
    store.save("one", 0, vec![pinned.clone()], Some(id.clone())).unwrap();
    let stored: String = store.0.query_row(
        "SELECT payload FROM browser_sessions WHERE owner='one'", [], |row| row.get(0)
    ).unwrap();
    assert!(!stored.contains("pinned"));
    assert!(store.state("one").unwrap().session.tabs[0].pinned);
    assert!(store.state("other").unwrap().session.tabs.is_empty());
    store.save("one", 1, Vec::new(), None).unwrap();
    drop(store);
    let mut store = Store::open(&temp).unwrap();
    assert!(store.state("one").unwrap().session.closed_tabs[0].tab.pinned);
    store.save("one", 2, vec![pinned], Some(id)).unwrap();
    assert!(store.state("one").unwrap().session.closed_tabs.is_empty());
}

#[test]
fn custom_user_agent_is_validated_persistent_and_profile_scoped() {
    let path = root();
    let db = Store::open(&path).unwrap();
    let regular = db.state("main").unwrap().profile_id;
    let other = db.add_profile("Other").unwrap();
    let valid = "UA Fixture/1.0";
    db.set_user_agent(&regular, Some(valid)).unwrap();
    for invalid in ["", " leading", "trailing ", "a\tb", "a\r\nb", "☃", &"x".repeat(513)] {
        assert!(db.set_user_agent(&regular, Some(invalid)).is_err());
    }
    assert_eq!(db.user_agent(&other).unwrap(), None);
    drop(db);
    let reopened = Store::open(&path).unwrap();
    assert_eq!(reopened.user_agent(&regular).unwrap().as_deref(), Some(valid));
    reopened.set_user_agent(&regular, None).unwrap();
    assert_eq!(reopened.user_agent(&regular).unwrap(), None);
}
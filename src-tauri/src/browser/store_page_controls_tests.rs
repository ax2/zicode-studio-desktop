use super::*;
#[test]
fn version_four_tabs_and_closed_tabs_default_without_resetting_existing_content() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let tab = tab();
    let original = store.state("owner").unwrap();
    store
        .save("owner", 0, vec![tab.clone()], Some(tab.id))
        .unwrap();
    store.save("owner", 1, vec![], None).unwrap();
    let payload: String = store
        .0
        .query_row(
            "SELECT payload FROM browser_sessions WHERE owner='owner'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let mut legacy: serde_json::Value = serde_json::from_str(&payload).unwrap();
    legacy["closedTabs"][0]["tab"]
        .as_object_mut()
        .unwrap()
        .remove("zoom");
    legacy["closedTabs"][0]["tab"]
        .as_object_mut()
        .unwrap()
        .remove("muted");
    store
        .0
        .execute(
            "UPDATE browser_sessions SET payload=?1 WHERE owner='owner'",
            [legacy.to_string()],
        )
        .unwrap();
    store.0.pragma_update(None, "user_version", 4).unwrap();
    drop(store);
    let store = Store::open(&root).unwrap();
    let restored = store.state("owner").unwrap();
    assert_eq!(restored.profile_id, original.profile_id);
    assert_eq!(restored.session.closed_tabs[0].tab.zoom, 1.0);
    assert!(!restored.session.closed_tabs[0].tab.muted);
    assert_eq!(restored.session.closed_tabs[0].tab.title, "资料");
}
#[test]
fn page_controls_survive_close_reopen_and_invalid_zoom_cannot_overwrite_saved_tabs() {
    let root = root();
    let mut store = Store::open(&root).unwrap();
    let mut tab = tab();
    tab.zoom = 1.5;
    tab.muted = true;
    let saved = store
        .save("owner", 0, vec![tab.clone()], Some(tab.id.clone()))
        .unwrap();
    for zoom in [0.0, 0.24, 5.01, f64::NAN, f64::INFINITY] {
        let mut bad = tab.clone();
        bad.zoom = zoom;
        assert!(store
            .save("owner", 1, vec![bad], Some(tab.id.clone()))
            .is_err());
    }
    assert_eq!(store.state("owner").unwrap().session, saved);
    let closed = store.save("owner", 1, vec![], None).unwrap();
    assert_eq!(closed.closed_tabs[0].tab, tab);
    drop(store);
    let mut store = Store::open(&root).unwrap();
    let restored = store
        .state("owner")
        .unwrap()
        .session
        .closed_tabs
        .remove(0)
        .tab;
    store
        .save(
            "owner",
            2,
            vec![restored.clone()],
            Some(restored.id.clone()),
        )
        .unwrap();
    assert_eq!(store.state("owner").unwrap().session.tabs[0], tab);
}

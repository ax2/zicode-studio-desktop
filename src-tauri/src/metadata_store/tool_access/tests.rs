use super::*;
use std::path::PathBuf;

fn fixture() -> PathBuf {
    let root = std::env::temp_dir().join(format!("zicode-tool-access-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&root).unwrap();
    root
}

#[test]
fn persists_ids_across_connections_and_keeps_scopes_distinct() {
    let root = fixture();
    let path = root.join("metadata.sqlite3");
    {
        let mut first = MetadataStore::open(&path).unwrap();
        let mut second = MetadataStore::open(&path).unwrap();
        first
            .mutate_tool_access(
                "programming",
                "workspace",
                Mutation::FavoriteSet {
                    id: "plugin:open".into(),
                    enabled: true,
                },
            )
            .unwrap();
        second
            .mutate_tool_access(
                "programming",
                "workspace",
                Mutation::FavoriteSet {
                    id: "other:open".into(),
                    enabled: true,
                },
            )
            .unwrap();
        first
            .mutate_tool_access(
                "programming",
                "workspace",
                Mutation::RecentRecord {
                    id: "plugin:open".into(),
                },
            )
            .unwrap();
        first
            .mutate_tool_access(
                "programming",
                "workspace",
                Mutation::RecentRecord {
                    id: "plugin:open".into(),
                },
            )
            .unwrap();
    }
    let reopened = MetadataStore::open(&path).unwrap();
    let state = reopened
        .read_tool_access("programming", "workspace")
        .unwrap();
    assert_eq!(state.favorites, ["plugin:open", "other:open"]);
    assert_eq!(state.recent.len(), 1);
    assert!(state.recent[0].used_at > 0);
    assert_eq!(state.revision, 4);
    assert_eq!(
        reopened.read_tool_access("finance", "workspace").unwrap(),
        ToolAccess::default()
    );
    assert_eq!(
        reopened
            .read_tool_access("programming", "workspace-b")
            .unwrap(),
        ToolAccess::default()
    );
    drop(reopened);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn bounds_recent_history_and_clear_preserves_favorites() {
    let root = fixture();
    let mut store = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    store
        .mutate_tool_access(
            "s",
            "w",
            Mutation::FavoriteSet {
                id: "removed-plugin:open".into(),
                enabled: true,
            },
        )
        .unwrap();
    for index in 0..50 {
        store
            .mutate_tool_access(
                "s",
                "w",
                Mutation::RecentRecord {
                    id: format!("tool-{index}"),
                },
            )
            .unwrap();
    }
    let state = store.read_tool_access("s", "w").unwrap();
    assert_eq!(state.recent.len(), MAX_RECENT);
    assert_eq!(state.recent[0].id, "tool-49");
    let cleared = store
        .mutate_tool_access("s", "w", Mutation::RecentClear)
        .unwrap();
    assert!(cleared.recent.is_empty());
    assert_eq!(cleared.favorites, ["removed-plugin:open"]);
    assert!(store
        .mutate_tool_access(
            "s",
            "w",
            Mutation::FavoriteSet {
                id: "x\n".into(),
                enabled: true
            }
        )
        .is_err());
    assert_eq!(store.read_tool_access("s", "w").unwrap(), cleared);
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejects_corruption_without_overwriting_it_or_accepting_payload_fields() {
    let root = fixture();
    let mut store = MetadataStore::open(&root.join("metadata.sqlite3")).unwrap();
    let key = scope_key("s", "w").unwrap();
    store
        .connection
        .execute(
            "INSERT INTO preferences(key,value_json) VALUES (?1,?2)",
            params![key, "invalid"],
        )
        .unwrap();
    assert!(store
        .mutate_tool_access("s", "w", Mutation::RecentClear)
        .is_err());
    let raw: String = store
        .connection
        .query_row(
            "SELECT value_json FROM preferences WHERE key=?1",
            [&key],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(raw, "invalid");
    assert!(serde_json::from_str::<Mutation>(
        r#"{"kind":"recentRecord","id":"tool","input":"private"}"#
    )
    .is_err());
    assert_ne!(
        scope_key("a:b", "c").unwrap(),
        scope_key("a", "b:c").unwrap()
    );
    drop(store);
    std::fs::remove_dir_all(root).unwrap();
}

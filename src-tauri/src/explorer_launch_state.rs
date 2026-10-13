//! Explorer launch data belongs to a native window and one Host session.
//! This is a hint for discovery, never a grant to read or write the path.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EntryIntent {
    File(PathBuf),
    Selection(Vec<PathBuf>),
    Folder(PathBuf),
    Drive,
    Tools,
}

impl EntryIntent {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::File(_) => "file",
            Self::Selection(_) => "selection",
            Self::Folder(_) => "folder",
            Self::Drive => "drive",
            Self::Tools => "tools",
        }
    }
}

struct BoundIntent {
    route: String,
    intent: EntryIntent,
}

fn promoted_folder_route(previous: &str, current: &str, intent: &EntryIntent) -> bool {
    if !matches!(intent, EntryIntent::Folder(_)) {
        return false;
    }
    let Some((prior_workspace, prior_session)) = previous
        .strip_prefix("/app/workspaces/")
        .and_then(|path| path.split_once("/sessions/"))
    else {
        return false;
    };
    let Some((workspace, session)) = current
        .strip_prefix("/app/workspaces/")
        .and_then(|path| path.split_once("/sessions/"))
    else {
        return false;
    };
    prior_workspace == workspace
        && prior_session.starts_with("temporary-")
        && !session.is_empty()
        && !session.starts_with("temporary-")
        && !session.contains('/')
}

#[derive(Default)]
pub struct ExplorerLaunchState(Mutex<HashMap<String, BoundIntent>>);

impl ExplorerLaunchState {
    pub fn bind(
        &self,
        label: &str,
        workspace_id: &str,
        session_id: &str,
        intent: EntryIntent,
    ) -> Result<(), String> {
        if !label.starts_with("native-workspace-")
            || workspace_id.is_empty()
            || session_id.is_empty()
            || workspace_id.contains('/')
            || session_id.contains('/')
        {
            return Err("Invalid Explorer launch target".into());
        }
        let route = format!("/app/workspaces/{workspace_id}/sessions/{session_id}");
        self.0
            .lock()
            .map_err(|_| "Explorer launch state is unavailable".to_string())?
            .insert(label.to_string(), BoundIntent { route, intent });
        Ok(())
    }

    pub fn intent(&self, label: &str, route: &str) -> Result<Option<EntryIntent>, String> {
        let mut entries = self
            .0
            .lock()
            .map_err(|_| "Explorer launch state is unavailable".to_string())?;
        let Some(bound) = entries.get_mut(label) else {
            return Ok(None);
        };
        if bound.route != route && promoted_folder_route(&bound.route, route, &bound.intent) {
            // Host replaces a newly created temporary Pi session with its
            // formal ID. A later navigation cannot promote this hint again.
            bound.route = route.to_string();
        }
        Ok((bound.route == route).then(|| bound.intent.clone()))
    }

    pub fn forget(&self, label: &str) {
        if let Ok(mut entries) = self.0.lock() {
            entries.remove(label);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_intents_follow_window_and_session() {
        let state = ExplorerLaunchState::default();
        let first = EntryIntent::File(PathBuf::from("first.zip"));
        state
            .bind("native-workspace-a", "a", "one", first.clone())
            .unwrap();
        assert_eq!(
            state
                .intent("native-workspace-a", "/app/workspaces/a/sessions/one")
                .unwrap(),
            Some(first)
        );
        assert_eq!(
            state
                .intent("native-workspace-b", "/app/workspaces/a/sessions/one")
                .unwrap(),
            None
        );
        assert_eq!(
            state
                .intent("native-workspace-a", "/app/workspaces/a/sessions/two")
                .unwrap(),
            None
        );
        state
            .bind(
                "native-workspace-b",
                "b",
                "two",
                EntryIntent::Folder(PathBuf::from("project")),
            )
            .unwrap();
        assert_eq!(
            state
                .intent("native-workspace-b", "/app/workspaces/b/sessions/two")
                .unwrap()
                .unwrap()
                .mode(),
            "folder"
        );
        state
            .bind(
                "native-workspace-b",
                "b",
                "three",
                EntryIntent::File(PathBuf::from("next.zip")),
            )
            .unwrap();
        assert_eq!(
            state
                .intent("native-workspace-b", "/app/workspaces/b/sessions/two")
                .unwrap(),
            None
        );
        assert_eq!(
            state
                .intent("native-workspace-b", "/app/workspaces/b/sessions/three")
                .unwrap()
                .unwrap()
                .mode(),
            "file"
        );
        state.forget("native-workspace-a");
        assert_eq!(
            state
                .intent("native-workspace-a", "/app/workspaces/a/sessions/one")
                .unwrap(),
            None
        );
        assert!(state
            .bind("plugin-popup", "a", "one", EntryIntent::Tools)
            .is_err());
    }

    #[test]
    fn folder_hint_survives_only_the_first_formal_session_binding() {
        let state = ExplorerLaunchState::default();
        let folder = EntryIntent::Folder(PathBuf::from("project"));
        state
            .bind(
                "native-workspace-explorer-a",
                "a",
                "temporary-one",
                folder.clone(),
            )
            .unwrap();
        assert_eq!(
            state
                .intent(
                    "native-workspace-explorer-a",
                    "/app/workspaces/a/sessions/formal-one"
                )
                .unwrap(),
            Some(folder)
        );
        assert_eq!(
            state
                .intent(
                    "native-workspace-explorer-a",
                    "/app/workspaces/a/sessions/formal-two"
                )
                .unwrap(),
            None
        );
        assert_eq!(
            state
                .intent(
                    "native-workspace-explorer-a",
                    "/app/workspaces/b/sessions/formal-one"
                )
                .unwrap(),
            None
        );
        let file = EntryIntent::File(PathBuf::from("archive.zip"));
        state
            .bind("native-workspace-file-a", "a", "temporary-two", file)
            .unwrap();
        assert_eq!(
            state
                .intent(
                    "native-workspace-file-a",
                    "/app/workspaces/a/sessions/formal-three"
                )
                .unwrap(),
            None
        );
    }
}

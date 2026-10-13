//! Explorer launch data belongs to a native window and one Host session.
//! This is a hint for discovery, never a grant to read or write the path.
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EntryIntent {
    File(PathBuf),
    Folder(PathBuf),
    Drive,
    Tools,
}

impl EntryIntent {
    pub fn mode(&self) -> &'static str {
        match self {
            Self::File(_) => "file",
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
        Ok(self
            .0
            .lock()
            .map_err(|_| "Explorer launch state is unavailable".to_string())?
            .get(label)
            .filter(|bound| bound.route == route)
            .map(|bound| bound.intent.clone()))
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
}

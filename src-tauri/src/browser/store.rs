//! Browser metadata only. Native engine profiles own cookies and site storage.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path, time::Duration};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum StartupMode {
    Browser,
    Workspace,
}
pub fn default_zoom() -> f64 { 1.0 }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedTab {
    pub id: String,
    pub url: String,
    pub title: String,
    #[serde(default = "default_zoom")]
    pub zoom: f64,
    #[serde(default)]
    pub muted: bool,
}
#[derive(Debug, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Session {
    #[serde(default)]
    pub closed_tabs: Vec<ClosedTab>,
    pub revision: i64,
    pub tabs: Vec<SavedTab>,
    pub active_tab: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub startup_mode: StartupMode,
    pub profile_id: String,
    pub session: Session,
}
#[path = "store_closed.rs"]
mod closed;
pub use closed::ClosedTab;
#[path = "bookmarks.rs"]
pub mod bookmarks;
#[path = "history.rs"]
pub mod history;
pub struct Store(Connection);
impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let mut db = Connection::open(root.join("metadata.sqlite3")).map_err(|e| e.to_string())?;
        db.busy_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.pragma_update(None, "synchronous", "FULL")
            .map_err(|e| e.to_string())?;
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let version: i64 = tx
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 5 {
            return Err("Browser metadata requires a newer Studio version".into());
        }
        if version == 0 {
            tx.execute_batch("CREATE TABLE browser_preferences (id INTEGER PRIMARY KEY CHECK(id=1), startup TEXT NOT NULL CHECK(startup IN ('browser','workspace')), profile TEXT NOT NULL);
                CREATE TABLE browser_sessions (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL);
                PRAGMA user_version=1;").map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT INTO browser_preferences VALUES(1,'browser',?1)",
                [uuid::Uuid::new_v4().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        if version < 2 {
            // Version 2 adds closedTabs to session JSON; old payloads default empty.
            tx.pragma_update(None, "user_version", 2)
                .map_err(|e| e.to_string())?;
        }
        if version < 3 {
            tx.execute_batch("CREATE TABLE IF NOT EXISTS browser_bookmarks (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL); PRAGMA user_version=3;")
                .map_err(|e| e.to_string())?;
        }
        if version < 4 {
            tx.execute_batch("CREATE TABLE IF NOT EXISTS browser_history (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, visited_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS browser_history_owner ON browser_history(owner,id DESC); PRAGMA user_version=4;")
                .map_err(|e|e.to_string())?;
        }
        if version < 5 { tx.pragma_update(None, "user_version", 5).map_err(|e|e.to_string())?; }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(Self(db))
    }
    pub fn state(&self, owner: &str) -> Result<State, String> {
        let (mode, profile_id): (String, String) = self
            .0
            .query_row(
                "SELECT startup,profile FROM browser_preferences WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        uuid::Uuid::parse_str(&profile_id).map_err(|_| "Invalid browser profile identity")?;
        let startup_mode = match mode.as_str() {
            "browser" => StartupMode::Browser,
            "workspace" => StartupMode::Workspace,
            _ => return Err("Invalid browser startup preference".into()),
        };
        let saved: Option<(i64, String)> = self
            .0
            .query_row(
                "SELECT revision,payload FROM browser_sessions WHERE owner=?1",
                [owner],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let session = if let Some((revision, payload)) = saved {
            decode_session(revision, &payload)?
        } else {
            Session::default()
        };
        Ok(State {
            startup_mode,
            profile_id,
            session,
        })
    }
    pub fn set_startup(&self, mode: StartupMode) -> Result<(), String> {
        let value = match mode {
            StartupMode::Browser => "browser",
            StartupMode::Workspace => "workspace",
        };
        self.0
            .execute(
                "UPDATE browser_preferences SET startup=?1 WHERE id=1",
                [value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn save(
        &mut self,
        owner: &str,
        expected: i64,
        tabs: Vec<SavedTab>,
        active_tab: Option<String>,
    ) -> Result<Session, String> {
        validate(&tabs, active_tab.as_deref())?;
        let revision = expected
            .checked_add(1)
            .filter(|_| expected >= 0)
            .ok_or("Invalid browser revision")?;
        let tx = self
            .0
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|e| e.to_string())?;
        let current: Option<(i64, String)> = tx
            .query_row(
                "SELECT revision,payload FROM browser_sessions WHERE owner=?1",
                [owner],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if current.as_ref().map_or(0, |row| row.0) != expected {
            return Err("Browser session changed; reload before saving".into());
        }
        let previous = current
            .map(|(revision, payload)| decode_session(revision, &payload))
            .transpose()?
            .unwrap_or_default();
        let closed_tabs = closed::transition(previous, &tabs);
        let next = Session {
            revision,
            tabs,
            active_tab,
            closed_tabs,
        };
        closed::validate(&next)?;
        let payload = serde_json::to_string(&next).map_err(|e| e.to_string())?;
        if payload.len() > 4 * 1024 * 1024 {
            return Err("Browser session exceeds storage limit".into());
        }
        tx.execute("INSERT INTO browser_sessions(owner,revision,payload) VALUES(?1,?2,?3) ON CONFLICT(owner) DO UPDATE SET revision=excluded.revision,payload=excluded.payload", params![owner, revision, payload]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(next)
    }
}
fn decode_session(revision: i64, payload: &str) -> Result<Session, String> {
    let session: Session = serde_json::from_str(payload)
        .map_err(|_| "Browser session is damaged; existing data retained")?;
    if session.revision != revision {
        return Err("Browser session revision mismatch".into());
    }
    validate(&session.tabs, session.active_tab.as_deref())?;
    closed::validate(&session)?;
    Ok(session)
}
fn validate(tabs: &[SavedTab], active: Option<&str>) -> Result<(), String> {
    let mut ids = HashSet::new();
    for tab in tabs {
        if uuid::Uuid::parse_str(&tab.id).is_err()
            || !ids.insert(tab.id.as_str())
            || tab.title.len() > 4096
            || tab.url.len() > 16384
            || !tab.zoom.is_finite() || !(0.25..=5.0).contains(&tab.zoom)
        {
            return Err("Invalid saved browser tab".into());
        }
        if tab.url == "about:blank" {
            continue;
        }
        let url = reqwest::Url::parse(&tab.url).map_err(|_| "Invalid saved browser URL")?;
        if !matches!(url.scheme(), "https" | "http")
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return Err("Unsupported or credential-bearing saved browser URL".into());
        }
    }
    if active.is_some_and(|id| !ids.contains(id)) || (active.is_none() && !tabs.is_empty()) {
        return Err("Active browser tab does not match saved tabs".into());
    }
    Ok(())
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;

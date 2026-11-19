use super::Store;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
#[derive(Serialize)]
pub(crate) struct Profile {
    pub id: String,
    pub name: String,
}
pub(super) fn create(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS browser_named_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE);CREATE TABLE IF NOT EXISTS browser_window_profiles(owner TEXT PRIMARY KEY,profile TEXT NOT NULL);").map_err(|e|e.to_string())
}
impl Store {
    pub(crate) fn register_profile_window(
        &self,
        parent: &str,
        owner: &str,
        existing: Option<&str>,
        new_name: Option<&str>,
    ) -> Result<(), String> {
        let transaction = self.0.unchecked_transaction().map_err(|e| e.to_string())?;
        let created = new_name.map(|name| self.add_profile(name)).transpose()?;
        if let Some(id) = created.as_deref().or(existing) {
            self.bind_profile(owner, id)?;
        }
        self.insert_browser_window(parent, owner)?;
        transaction.commit().map_err(|e| e.to_string())
    }
    pub(crate) fn profile_for_window(&self, owner: &str) -> Result<Option<Profile>, String> {
        self.0.query_row("SELECT p.id,p.name FROM browser_window_profiles w JOIN browser_named_profiles p ON p.id=w.profile WHERE w.owner=?1",[owner],|r|Ok(Profile{id:r.get(0)?,name:r.get(1)?})).optional().map_err(|e|e.to_string())
    }
    pub(crate) fn profiles(&self) -> Result<Vec<Profile>, String> {
        let mut q = self
            .0
            .prepare("SELECT id,name FROM browser_named_profiles ORDER BY name COLLATE NOCASE,id")
            .map_err(|e| e.to_string())?;
        let rows = q
            .query_map([], |r| {
                Ok(Profile {
                    id: r.get(0)?,
                    name: r.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub(crate) fn add_profile(&self, name: &str) -> Result<String, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 64 || name.chars().any(char::is_control) {
            return Err("Enter a browser profile name".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let changed=self.0.execute("INSERT INTO browser_named_profiles(id,name) VALUES(?1,?2) ON CONFLICT(name) DO NOTHING",params![id,name]).map_err(|e|e.to_string())?;
        if changed == 0 {
            return Err("A browser profile with this name already exists".into());
        }
        Ok(id)
    }
    pub(crate) fn bind_profile(&self, owner: &str, id: &str) -> Result<(), String> {
        let changed=self.0.execute("INSERT INTO browser_window_profiles(owner,profile) SELECT ?1,id FROM browser_named_profiles WHERE id=?2",params![owner,id]).map_err(|e|e.to_string())?;
        if changed != 1 {
            return Err("Browser profile is unavailable".into());
        }
        Ok(())
    }
}

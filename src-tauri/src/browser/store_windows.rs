use super::Store;
use rusqlite::{params, Connection, OptionalExtension};

pub(super) fn create(db: &Connection) -> Result<(), String> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS browser_windows(label TEXT PRIMARY KEY, parent TEXT NOT NULL, open INTEGER NOT NULL CHECK(open IN(0,1)), sequence INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS browser_windows_family ON browser_windows(parent,open,sequence);").map_err(|e|e.to_string())
}

impl Store {
    pub(crate) fn browser_parent(&self, child: &str) -> Result<String, String> {
        self.0
            .query_row(
                "SELECT parent FROM browser_windows WHERE label=?1",
                [child],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())
    }
    pub(crate) fn insert_browser_window(&self, parent: &str, label: &str) -> Result<(), String> {
        self.0.execute("INSERT INTO browser_windows(label,parent,open,sequence) SELECT ?1,?2,1,COALESCE(MAX(sequence),0)+1 FROM browser_windows",params![label,parent]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub(crate) fn mark_browser_window(&self, label: &str, opened: bool) -> Result<(), String> {
        let count=self.0.execute("UPDATE browser_windows SET open=?2,sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM browser_windows) WHERE label=?1",params![label,opened]).map_err(|e|e.to_string())?;
        if count != 1 {
            return Err("Unknown browser window".into());
        }
        Ok(())
    }
    pub(crate) fn last_closed_window(&self, parent: &str) -> Result<Option<String>, String> {
        self.0.query_row("SELECT label FROM browser_windows WHERE parent=?1 AND open=0 ORDER BY sequence DESC LIMIT 1",[parent],|r|r.get(0)).optional().map_err(|e|e.to_string())
    }
    pub(crate) fn open_browser_windows(&self, parent: &str) -> Result<Vec<String>, String> {
        let mut query = self
            .0
            .prepare(
                "SELECT label FROM browser_windows WHERE parent=?1 AND open=1 ORDER BY sequence",
            )
            .map_err(|e| e.to_string())?;
        let result = query
            .query_map([parent], |r| r.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string());
        result
    }
}

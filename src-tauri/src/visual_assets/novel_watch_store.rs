//! Local scheduling state is separate from portable character/draft snapshots.
use super::super::{characters, discovery, Facet, NotesVault, Result};
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::{
    fs::{File, OpenOptions},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    time::Duration,
};
use uuid::Uuid;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Scope {
    pub character_id: String,
    pub notebook_id: String,
    pub facet: Facet,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Watch {
    pub id: String,
    pub state: String,
    pub completed_passes: i64,
    pub checked_at: Option<String>,
    pub pending: i64,
    pub error: Option<String>,
    #[serde(skip)]
    pub after: Option<String>,
    #[serde(skip)]
    pub next_at: i64,
}

#[derive(Clone)]
pub(super) struct Store {
    path: PathBuf,
    pub library: String,
    pub workspace: String,
}

impl Store {
    pub fn open(root: &Path, library: &str, workspace: &str) -> Result<Self> {
        std::fs::create_dir_all(root)?;
        let store = Self {
            path: root.join("manuscripts.sqlite"),
            library: library.into(),
            workspace: workspace.into(),
        };
        store.connect()?.execute_batch(
            "CREATE TABLE IF NOT EXISTS manuscript_watch(
                id TEXT PRIMARY KEY, library TEXT NOT NULL, workspace TEXT NOT NULL,
                character_id TEXT NOT NULL, notebook TEXT NOT NULL, facet TEXT NOT NULL,
                state TEXT NOT NULL, after_id TEXT, passes INTEGER NOT NULL DEFAULT 0,
                checked_at TEXT, next_at INTEGER NOT NULL DEFAULT 0, error TEXT,
                UNIQUE(library,workspace,character_id,notebook,facet));
             CREATE TABLE IF NOT EXISTS manuscript_pending(
                watch TEXT NOT NULL REFERENCES manuscript_watch(id), chapter TEXT NOT NULL,
                data TEXT NOT NULL, seen INTEGER NOT NULL, PRIMARY KEY(watch,chapter));",
        )?;
        Ok(store)
    }

    fn connect(&self) -> Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(Duration::from_millis(250))?;
        db.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
        )?;
        Ok(db)
    }

    /// The operating system releases scheduling ownership on process exit.
    pub fn lease(&self, id: &str) -> Result<Option<File>> {
        let id = Uuid::parse_str(id)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(self.path.with_file_name(format!("manuscript-{id}.lock")))?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.len() != 0
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("visual_assets_watch_unavailable".into());
        }
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(file)),
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                Ok(None)
            }
            Err(error) => Err(error.into()),
        }
    }

    pub fn get(&self, scope: &Scope) -> Result<Option<Watch>> {
        let db = self.connect()?;
        self.read(&db, scope)
    }

    fn read(&self, db: &Connection, scope: &Scope) -> Result<Option<Watch>> {
        Ok(db.query_row(
            "SELECT id,state,after_id,passes,checked_at,next_at,error,
             (SELECT count(*) FROM manuscript_pending p WHERE p.watch=w.id)
             FROM manuscript_watch w WHERE library=?1 AND workspace=?2 AND character_id=?3 AND notebook=?4 AND facet=?5",
            params![self.library,self.workspace,scope.character_id,scope.notebook_id,scope.facet.key()],
            |row| Ok(Watch { id:row.get(0)?,state:row.get(1)?,after:row.get(2)?,completed_passes:row.get(3)?,
                checked_at:row.get(4)?,next_at:row.get(5)?,error:row.get(6)?,pending:row.get(7)? }),
        ).optional()?)
    }

    pub fn start(&self, catalog: &Connection, scope: &Scope) -> Result<Watch> {
        characters::get(catalog, &scope.character_id)?;
        if Uuid::parse_str(&scope.notebook_id)?.to_string() != scope.notebook_id {
            return Err("visual_assets_chapter_unavailable".into());
        }
        self.connect()?.execute(
            "INSERT INTO manuscript_watch(id,library,workspace,character_id,notebook,facet,state)
             VALUES (?1,?2,?3,?4,?5,?6,'running')
             ON CONFLICT(library,workspace,character_id,notebook,facet)
             DO UPDATE SET state='running',next_at=0,error=NULL",
            params![
                Uuid::new_v4().to_string(),
                self.library,
                self.workspace,
                scope.character_id,
                scope.notebook_id,
                scope.facet.key()
            ],
        )?;
        self.get(scope)?
            .ok_or_else(|| "visual_assets_watch_unavailable".into())
    }

    pub fn pause(&self, scope: &Scope, error: Option<&str>) -> Result<()> {
        self.connect()?.execute(
            "UPDATE manuscript_watch SET state=?6,error=?7
             WHERE library=?1 AND workspace=?2 AND character_id=?3 AND notebook=?4 AND facet=?5",
            params![
                self.library,
                self.workspace,
                scope.character_id,
                scope.notebook_id,
                scope.facet.key(),
                if error.is_some() { "error" } else { "paused" },
                error
            ],
        )?;
        Ok(())
    }

    pub fn page(&self, scope: &Scope, after: Option<&str>) -> Result<Value> {
        if let Some(after) = after {
            Uuid::parse_str(after)?;
        }
        let Some(watch) = self.get(scope)? else {
            return Ok(json!({"entries":[],"next":null}));
        };
        let db = self.connect()?;
        let mut statement = db.prepare("SELECT chapter,data FROM manuscript_pending WHERE watch=?1 AND chapter>?2 ORDER BY chapter LIMIT 21")?;
        let mut rows = statement
            .query_map(params![watch.id, after.unwrap_or("")], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let next = if rows.len() > 20 {
            rows.pop();
            rows.last().map(|(id, _)| id.clone())
        } else {
            None
        };
        let entries = rows
            .into_iter()
            .map(|(_, data)| serde_json::from_str::<Value>(&data))
            .collect::<serde_json::Result<Vec<_>>>()?;
        Ok(json!({"entries":entries,"next":next}))
    }

    /// One bounded batch. Candidate updates and the traversal cursor commit together.
    pub fn tick(
        &self,
        catalog: &Connection,
        notes: &NotesVault,
        scope: &Scope,
        now: i64,
    ) -> Result<bool> {
        self.tick_with(catalog, notes, scope, now, &|| Ok(()))
    }

    fn tick_with(
        &self,
        catalog: &Connection,
        notes: &NotesVault,
        scope: &Scope,
        now: i64,
        before_commit: &dyn Fn() -> Result<()>,
    ) -> Result<bool> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let Some(watch) = self.read(&tx, scope)? else {
            return Ok(false);
        };
        if watch.state != "running" || watch.next_at > now {
            return Ok(false);
        }
        let page = discovery::discover(
            catalog,
            notes,
            &self.workspace,
            discovery::Query {
                character_id: scope.character_id.clone(),
                notebook_id: scope.notebook_id.clone(),
                facet: scope.facet,
                title: String::new(),
                after: watch.after,
                needs_work_only: false,
            },
        )?;
        let epoch = watch
            .completed_passes
            .checked_add(1)
            .ok_or("visual_assets_watch_unavailable")?;
        for entry in page["entries"]
            .as_array()
            .ok_or("visual_assets_watch_unavailable")?
        {
            let chapter = entry["id"]
                .as_str()
                .ok_or("visual_assets_watch_unavailable")?;
            if entry["status"] == "recorded" {
                tx.execute(
                    "DELETE FROM manuscript_pending WHERE watch=?1 AND chapter=?2",
                    params![watch.id, chapter],
                )?;
            } else {
                tx.execute(
                    "INSERT INTO manuscript_pending(watch,chapter,data,seen) VALUES (?1,?2,?3,?4)
                    ON CONFLICT(watch,chapter) DO UPDATE SET data=excluded.data,seen=excluded.seen",
                    params![watch.id, chapter, serde_json::to_string(entry)?, epoch],
                )?;
            }
        }
        let after = page["next"].as_str();
        let completed = after.is_none();
        if completed {
            tx.execute(
                "DELETE FROM manuscript_pending WHERE watch=?1 AND seen<>?2",
                params![watch.id, epoch],
            )?;
        }
        tx.execute("UPDATE manuscript_watch SET after_id=?2,passes=?3,checked_at=?4,next_at=?5 WHERE id=?1",
            params![watch.id,after,if completed {epoch} else {watch.completed_passes},
                if completed {Some(chrono::Utc::now().to_rfc3339())} else {watch.checked_at},
                now.saturating_add(if completed {30_000} else {1_000})])?;
        before_commit()?;
        tx.commit()?;
        Ok(true)
    }
}

#[cfg(test)]
#[path = "novel_watch_crash_tests.rs"]
mod crash_tests;
#[cfg(test)]
#[path = "novel_watch_store_tests.rs"]
mod tests;

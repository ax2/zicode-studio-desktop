//! Machine-local configuration and bounded image attempts, separate from library backups.
use super::{
    creation_types::{hash, validate_usage, Plan, Settings},
    Result,
};
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::{
    fs::{File, OpenOptions},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

#[derive(Clone)]
pub(super) struct Store {
    path: PathBuf,
    pub workspace: String,
    pub scene: String,
}
type JobRow = (
    String,
    String,
    i64,
    Option<String>,
    Option<String>,
    Option<String>,
);
impl Store {
    pub fn open(root: &Path, workspace: &str, scene: &str) -> Result<Self> {
        if workspace.is_empty() || scene.is_empty() || workspace.len() > 1024 || scene.len() > 1024
        {
            return Err("visual_assets_creation_scope_invalid".into());
        }
        std::fs::create_dir_all(root)?;
        let store = Self {
            path: root.join("image-creation.sqlite"),
            workspace: workspace.into(),
            scene: scene.into(),
        };
        store.db()?.execute_batch("CREATE TABLE IF NOT EXISTS image_settings(workspace TEXT,scene TEXT,settings TEXT NOT NULL,PRIMARY KEY(workspace,scene));
            CREATE TABLE IF NOT EXISTS image_job(id TEXT PRIMARY KEY,library TEXT NOT NULL,workspace TEXT NOT NULL,scene TEXT NOT NULL,plan TEXT NOT NULL,digest TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('unknown','ready','rejected')),created INTEGER NOT NULL DEFAULT(unixepoch('now')),output BLOB,thumbnail TEXT,sha256 TEXT,usage TEXT,CHECK(output IS NULL OR length(output)<=25165824));
            CREATE TABLE IF NOT EXISTS image_job_error(id TEXT PRIMARY KEY,error TEXT NOT NULL);
            CREATE UNIQUE INDEX IF NOT EXISTS image_unknown_plan ON image_job(library,workspace,scene,digest) WHERE state='unknown';")?;
        Ok(store)
    }
    fn db(&self) -> Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.busy_timeout(std::time::Duration::from_millis(250))?;
        db.execute_batch(
            "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF;",
        )?;
        Ok(db)
    }
    pub fn settings(&self) -> Result<Settings> {
        let saved: Option<String> = self
            .db()?
            .query_row(
                "SELECT settings FROM image_settings WHERE workspace=?1 AND scene=?2",
                params![self.workspace, self.scene],
                |row| row.get(0),
            )
            .optional()?;
        Ok(saved
            .map(|encoded| serde_json::from_str(&encoded))
            .transpose()?
            .unwrap_or_default())
    }
    pub fn save_settings(&self, settings: &Settings) -> Result<()> {
        settings.endpoint()?;
        self.db()?.execute("INSERT INTO image_settings VALUES (?1,?2,?3) ON CONFLICT(workspace,scene) DO UPDATE SET settings=excluded.settings",params![self.workspace,self.scene,serde_json::to_string(settings)?])?;
        Ok(())
    }
    pub fn get(&self, library: &str, id: Uuid) -> Result<Option<Value>> {
        let row: Option<JobRow> = self.db()?.query_row("SELECT plan,state,created,sha256,usage,(SELECT error FROM image_job_error WHERE id=image_job.id) FROM image_job WHERE id=?1 AND library=?2 AND workspace=?3 AND scene=?4",params![id.to_string(),library,self.workspace,self.scene],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?))).optional()?;
        row.map(|(plan,state,created,sha256,usage,error)|Ok(json!({"id":id,"plan":serde_json::from_str::<Plan>(&plan)?,"state":state,"error":error,"created":created,"sha256":sha256,"usage":usage.map(|s|serde_json::from_str::<Value>(&s)).transpose()?}))).transpose()
    }
    pub fn history(&self, library: &str, before: Option<i64>) -> Result<Value> {
        let db = self.db()?;
        let mut statement = db.prepare("SELECT id,rowid FROM image_job WHERE library=?1 AND workspace=?2 AND scene=?3 AND rowid<?4 ORDER BY rowid DESC LIMIT 11")?;
        let mut ids = statement
            .query_map(
                params![
                    library,
                    self.workspace,
                    self.scene,
                    before.unwrap_or(i64::MAX)
                ],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let next = if ids.len() > 10 {
            ids.pop();
            ids.last().map(|(_, cursor)| *cursor)
        } else {
            None
        };
        let entries = ids
            .into_iter()
            .map(|(id, _)| self.get(library, Uuid::parse_str(&id)?))
            .collect::<Result<Vec<_>>>()?;
        Ok(json!({"entries":entries,"next":next}))
    }
    pub fn begin(&self, id: Uuid, plan: &Plan) -> Result<()> {
        self.begin_checked(id, plan, &|_| Ok(()))
    }
    pub fn begin_checked(
        &self,
        id: Uuid,
        plan: &Plan,
        checkpoint: &impl Fn(&str) -> Result<()>,
    ) -> Result<()> {
        if plan.workspace_id != self.workspace || plan.scene_id != self.scene {
            return Err("visual_assets_creation_scope_invalid".into());
        }
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.prepare("SELECT 1 FROM image_job WHERE library=?1 AND workspace=?2 AND scene=?3 AND digest=?4 AND state='unknown'")?.exists(params![plan.library_id,self.workspace,self.scene,plan.digest])? {
            return Err("visual_assets_creation_existing_unknown".into());
        }
        tx.execute("INSERT INTO image_job(id,library,workspace,scene,plan,digest,state) VALUES(?1,?2,?3,?4,?5,?6,'unknown')",params![id.to_string(),plan.library_id,self.workspace,self.scene,serde_json::to_string(plan)?,plan.digest])?;
        checkpoint("before-begin-commit")?;
        tx.commit()?;
        checkpoint("after-begin-commit")?;
        Ok(())
    }
    pub fn finish(&self, id: Uuid, bytes: &[u8], thumbnail: &str, usage: &Value) -> Result<()> {
        self.finish_checked(id, bytes, thumbnail, usage, &|_| Ok(()))
    }
    pub fn finish_checked(
        &self,
        id: Uuid,
        bytes: &[u8],
        thumbnail: &str,
        usage: &Value,
        checkpoint: &impl Fn(&str) -> Result<()>,
    ) -> Result<()> {
        validate_usage(usage)?;
        if bytes.len() > 24 * 1024 * 1024 || thumbnail.len() > 700_000 {
            return Err("visual_assets_creation_result_too_large".into());
        }
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute("UPDATE image_job SET state='ready',output=?4,thumbnail=?5,sha256=?6,usage=?7 WHERE id=?1 AND workspace=?2 AND scene=?3 AND state='unknown'",params![id.to_string(),self.workspace,self.scene,bytes,thumbnail,hash(bytes),usage.to_string()])?;
        if changed != 1 {
            return Err("visual_assets_creation_job_changed".into());
        }
        checkpoint("before-result-commit")?;
        tx.commit()?;
        checkpoint("after-result-commit")?;
        Ok(())
    }
    pub fn reject(&self, id: Uuid, reason: &str) -> Result<()> {
        if !super::creation_errors::rejected(reason) {
            return Err("visual_assets_creation_error_invalid".into());
        }
        let mut db = self.db()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute("UPDATE image_job SET state='rejected' WHERE id=?1 AND workspace=?2 AND scene=?3 AND state='unknown'",params![id.to_string(),self.workspace,self.scene])?;
        if changed == 1 {
            tx.execute(
                "INSERT INTO image_job_error VALUES (?1,?2)",
                params![id.to_string(), reason],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn output(&self, library: &str, id: Uuid) -> Result<(Vec<u8>, String)> {
        let (bytes, thumbnail, digest): (Vec<u8>,String,String) = self.db()?.query_row("SELECT output,thumbnail,sha256 FROM image_job WHERE id=?1 AND library=?2 AND workspace=?3 AND scene=?4 AND state='ready'",params![id.to_string(),library,self.workspace,self.scene],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
        if hash(&bytes) != digest {
            return Err("visual_assets_creation_result_changed".into());
        }
        Ok((bytes, thumbnail))
    }
    pub fn lease(&self, library: &str) -> Result<Option<File>> {
        Uuid::parse_str(library)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .open(self.path.with_file_name(format!("image-{library}.lock")))?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.len() != 0
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("visual_assets_creation_busy".into());
        }
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(file)),
            Err(error) if error.raw_os_error() == fs2::lock_contended_error().raw_os_error() => {
                Ok(None)
            }
            Err(error) => Err(error.into()),
        }
    }
}

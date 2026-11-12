//! Local execution history. Unknown outcomes are never automatically resubmitted.
use crate::visual_assets::Result;
use fs2::FileExt;
use rusqlite::{params, Connection, OptionalExtension, Row, TransactionBehavior};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    fs::{File, OpenOptions},
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_READ, FILE_SHARE_WRITE,
};

const COLUMNS: &str = "id,plan,state,result,error,created_ms,finished_ms,rowid";

#[derive(Clone)]
pub(super) struct Store {
    root: PathBuf,
    library: String,
    workspace: String,
    scene: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Job {
    pub(super) id: String,
    pub(super) plan: Value,
    pub(super) state: String,
    pub(super) result: Option<Value>,
    pub(super) error: Option<String>,
    pub(super) created_ms: i64,
    pub(super) finished_ms: Option<i64>,
    #[serde(skip)]
    cursor: i64,
}

fn now() -> Result<i64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}

fn decode(row: &Row<'_>) -> rusqlite::Result<Job> {
    let parse =
        |value: String| serde_json::from_str(&value).map_err(|_| rusqlite::Error::InvalidQuery);
    Ok(Job {
        id: row.get(0)?,
        plan: parse(row.get(1)?)?,
        state: row.get(2)?,
        result: row.get::<_, Option<String>>(3)?.map(parse).transpose()?,
        error: row.get(4)?,
        created_ms: row.get(5)?,
        finished_ms: row.get(6)?,
        cursor: row.get(7)?,
    })
}

impl Store {
    pub(super) fn open(root: &Path, library: &str, workspace: &str, scene: &str) -> Result<Self> {
        Uuid::parse_str(library)?;
        std::fs::create_dir_all(root)?;
        let store = Self {
            root: root.into(),
            library: library.into(),
            workspace: workspace.into(),
            scene: scene.into(),
        };
        store.connection()?.execute_batch("CREATE TABLE IF NOT EXISTS novel_model_job(
            id TEXT PRIMARY KEY CHECK(length(id)=36), library TEXT NOT NULL, workspace TEXT NOT NULL,
            scene TEXT NOT NULL, character TEXT NOT NULL, digest TEXT NOT NULL CHECK(length(digest)=64),
            plan TEXT NOT NULL CHECK(length(plan)<=131072), state TEXT NOT NULL CHECK(state IN ('unknown','ready','rejected')),
            result TEXT, error TEXT, created_ms INTEGER NOT NULL, finished_ms INTEGER,
            CHECK((state='unknown' AND result IS NULL AND finished_ms IS NULL) OR (state<>'unknown' AND result IS NOT NULL AND finished_ms IS NOT NULL))
        ); CREATE INDEX IF NOT EXISTS novel_model_history ON novel_model_job(library,workspace,scene,character);
        CREATE UNIQUE INDEX IF NOT EXISTS novel_model_unresolved ON novel_model_job(library,workspace,scene,digest) WHERE state='unknown';")?;
        Ok(store)
    }

    fn connection(&self) -> Result<Connection> {
        let db = Connection::open(self.root.join("model-drafts.sqlite"))?;
        db.busy_timeout(Duration::from_millis(250))?;
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")?;
        Ok(db)
    }

    pub(super) fn get(&self, id: Uuid) -> Result<Option<Job>> {
        Ok(self.connection()?.query_row(&format!("SELECT {COLUMNS} FROM novel_model_job WHERE id=?1 AND library=?2 AND workspace=?3 AND scene=?4"),
            params![id.to_string(), self.library, self.workspace, self.scene], decode).optional()?)
    }

    pub(super) fn list(&self, character: &str, before: Option<i64>) -> Result<Value> {
        Uuid::parse_str(character)?;
        let db = self.connection()?;
        let mut statement = db.prepare(&format!("SELECT {COLUMNS} FROM novel_model_job WHERE library=?1 AND workspace=?2 AND scene=?3 AND character=?4 AND rowid<=?5 ORDER BY rowid DESC LIMIT 11"))?;
        let mut jobs = statement
            .query_map(
                params![
                    self.library,
                    self.workspace,
                    self.scene,
                    character,
                    before.unwrap_or(i64::MAX)
                ],
                decode,
            )?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let next = if jobs.len() > 10 {
            jobs.pop().map(|job| job.cursor)
        } else {
            None
        };
        Ok(json!({"entries":jobs,"next":next}))
    }

    /// The committed unknown row is the durable boundary before any HTTP send.
    pub(super) fn begin(&self, id: Uuid, plan: &Value) -> Result<()> {
        self.begin_checked(id, plan, &|_| Ok(()))
    }

    fn begin_checked(
        &self,
        id: Uuid,
        plan: &Value,
        checkpoint: &impl Fn(&str) -> Result<()>,
    ) -> Result<()> {
        if plan["libraryId"] != self.library
            || plan["sceneId"] != self.scene
            || plan["evidence"]["workspaceId"] != self.workspace
        {
            return Err("visual_assets_model_scope_changed".into());
        }
        let digest = plan["digest"]
            .as_str()
            .ok_or("visual_assets_model_plan_invalid")?;
        let character = plan["characterId"]
            .as_str()
            .ok_or("visual_assets_model_plan_invalid")?;
        Uuid::parse_str(character)?;
        let mut db = self.connection()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx
            .prepare("SELECT 1 FROM novel_model_job WHERE id=?1")?
            .exists([id.to_string()])?
        {
            return Err("visual_assets_model_job_exists".into());
        }
        if tx.prepare("SELECT 1 FROM novel_model_job WHERE library=?1 AND workspace=?2 AND scene=?3 AND digest=?4 AND state='unknown'")?.exists(params![self.library,self.workspace,self.scene,digest])? {
            return Err("visual_assets_model_outcome_unknown".into());
        }
        tx.execute("INSERT INTO novel_model_job(id,library,workspace,scene,character,digest,plan,state,created_ms) VALUES (?1,?2,?3,?4,?5,?6,?7,'unknown',?8)",
            params![id.to_string(),self.library,self.workspace,self.scene,character,digest,serde_json::to_string(plan)?,now()?])?;
        checkpoint("before-begin-commit")?;
        tx.commit()?;
        checkpoint("after-begin-commit")?;
        Ok(())
    }

    pub(super) fn finish(&self, id: Uuid, outcome: &Value) -> Result<()> {
        self.finish_checked(id, outcome, &|_| Ok(()))
    }

    fn finish_checked(
        &self,
        id: Uuid,
        outcome: &Value,
        checkpoint: &impl Fn(&str) -> Result<()>,
    ) -> Result<()> {
        let state = outcome["state"]
            .as_str()
            .ok_or("visual_assets_model_result_invalid")?;
        if !matches!(state, "ready" | "rejected") {
            return Err("visual_assets_model_result_invalid".into());
        }
        let encoded = serde_json::to_string(outcome)?;
        if encoded.len() > 32 * 1024 {
            return Err("visual_assets_model_result_invalid".into());
        }
        let mut db = self.connection()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute("UPDATE novel_model_job SET state=?5,result=?6,error=NULL,finished_ms=?7 WHERE id=?1 AND library=?2 AND workspace=?3 AND scene=?4 AND state='unknown'",
            params![id.to_string(),self.library,self.workspace,self.scene,state,encoded,now()?])?;
        if changed != 1 {
            return Err("visual_assets_model_job_changed".into());
        }
        checkpoint("before-result-commit")?;
        tx.commit()?;
        checkpoint("after-result-commit")?;
        Ok(())
    }

    pub(super) fn record_unknown(&self, id: Uuid) -> Result<()> {
        self.connection()?.execute("UPDATE novel_model_job SET error='visual_assets_model_outcome_unknown' WHERE id=?1 AND library=?2 AND workspace=?3 AND scene=?4 AND state='unknown'",
            params![id.to_string(),self.library,self.workspace,self.scene])?;
        Ok(())
    }

    // Per-library execution limit across processes, released by the OS on exit.
    pub(super) fn lease(&self) -> Result<Option<File>> {
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
            .open(self.root.join(format!("novel-model-{}.lock", self.library)))?;
        let metadata = file.metadata()?;
        if !metadata.is_file()
            || metadata.len() != 0
            || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
        {
            return Err("visual_assets_model_job_unavailable".into());
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

#[cfg(test)]
#[path = "novel_model_jobs_tests.rs"]
mod tests;

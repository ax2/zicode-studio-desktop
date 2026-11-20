//! Durable backup task state is separate from the Catalog whose writer lock is pinned.
use super::{animation_install, animation_request::AnimationIntent};
use super::{catalog, imports, snapshot, Result};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

#[path = "animation_jobs.rs"]
mod animation_jobs;
#[path = "animation_retry.rs"]
mod animation_retry;
#[path = "animation_stage_journal.rs"]
mod animation_stage_journal;
use animation_retry::Retry;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub state: String,
    pub phase: String,
    pub destination: PathBuf,
    pub operation: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub include_referenced_originals: bool,
}

pub struct Store {
    path: PathBuf,
    verification: Mutex<()>,
}

impl Store {
    /// Called once per application lifetime. Never automatically resubmit interrupted work.
    pub fn open(root: &Path, library: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let store = Self {
            path: root.join("backups.sqlite"),
            verification: Mutex::new(()),
        };
        let mut db = store.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS job (
            ordinal INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE,
            state TEXT NOT NULL, phase TEXT NOT NULL, destination TEXT NOT NULL,
            operation TEXT NOT NULL DEFAULT 'backup');
            CREATE TABLE IF NOT EXISTS backup_publication (
                job_id TEXT PRIMARY KEY REFERENCES job(id), manifest_digest TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS animation_intent (
                job_id TEXT PRIMARY KEY REFERENCES job(id), intent TEXT NOT NULL, manifest_digest TEXT);
            CREATE TABLE IF NOT EXISTS animation_install (
                job_id TEXT PRIMARY KEY REFERENCES job(id), previous_version TEXT);
            CREATE TABLE IF NOT EXISTS animation_retry (
                job_id TEXT PRIMARY KEY REFERENCES job(id),
                source_job_id TEXT NOT NULL REFERENCES job(id), reusable_digest TEXT);
            CREATE TABLE IF NOT EXISTS animation_stage (
                job_id TEXT PRIMARY KEY REFERENCES job(id), nonce TEXT NOT NULL,
                directory_identity TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);",
        )?;
        if !tx
            .prepare("SELECT 1 FROM pragma_table_info('job') WHERE name='operation'")?
            .exists([])?
        {
            tx.execute_batch(
                "ALTER TABLE job ADD COLUMN operation TEXT NOT NULL DEFAULT 'backup';",
            )?;
        }
        if !tx
            .prepare(
                "SELECT 1 FROM pragma_table_info('job') WHERE name='include_referenced_originals'",
            )?
            .exists([])?
        {
            tx.execute_batch("ALTER TABLE job ADD COLUMN include_referenced_originals INTEGER NOT NULL DEFAULT 0 CHECK(include_referenced_originals IN (0,1));")?;
        }
        if !tx
            .prepare("SELECT 1 FROM pragma_table_info('job') WHERE name='restore_digest'")?
            .exists([])?
        {
            tx.execute_batch("ALTER TABLE job ADD COLUMN restore_digest TEXT;")?;
        }
        let publication = tx
            .query_row(
                "SELECT id,restore_digest FROM job WHERE state='publishing' AND operation='restore'
             AND destination=?1 AND restore_digest IS NOT NULL ORDER BY ordinal DESC LIMIT 1",
                [library.to_str().ok_or("invalid default library path")?],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((job_id, digest)) = publication {
            let id = uuid::Uuid::parse_str(&job_id)?;
            if super::restore_library::reconcile(library, id, &digest)? {
                tx.execute(
                    "UPDATE job SET state='completed',phase='restore-installed' WHERE id=?1",
                    [&job_id],
                )?;
            }
        }
        tx.execute_batch("UPDATE job SET state='interrupted' WHERE state IN ('queued','running','publishing','cancelling');")?;
        tx.commit()?;
        let _ = store.recover_animation_stages(None);
        Ok(store)
    }

    fn connect(&self) -> Result<Connection> {
        let db = Connection::open(&self.path)?;
        db.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;")?;
        Ok(db)
    }

    pub fn latest(&self) -> Result<Option<Job>> {
        Ok(self
            .connect()?
            .query_row(
                "SELECT id,state,phase,destination,operation,include_referenced_originals FROM job ORDER BY ordinal DESC LIMIT 1",
                [],
                |row| {
                    Ok(Job {
                        id: row.get(0)?,
                        state: row.get(1)?,
                        phase: row.get(2)?,
                        destination: PathBuf::from(row.get::<_, String>(3)?),
                        operation: row.get(4)?,
                        include_referenced_originals: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn latest_for_display(&self) -> Result<Option<Job>> {
        let latest = self.latest()?;
        let Some(job) = latest.as_ref().filter(|job| {
            matches!(job.operation.as_str(), "backup" | "animation") && job.state == "interrupted"
        }) else {
            return Ok(latest);
        };
        // Multiple windows can ask for status. Keep verification outside SQLite transactions.
        let Ok(_verification) = self.verification.try_lock() else {
            return Ok(latest);
        };
        let db = self.connect()?;
        let animation = job.operation == "animation";
        let digest_query = if animation {
            "SELECT manifest_digest FROM animation_intent JOIN job ON job.id=job_id
             WHERE job_id=?1 AND job.state='interrupted' AND manifest_digest IS NOT NULL"
        } else {
            "SELECT manifest_digest FROM backup_publication JOIN job ON job.id=job_id
             WHERE job_id=?1 AND job.state='interrupted'"
        };
        let digest: Option<String> = db
            .query_row(digest_query, [&job.id], |row| row.get(0))
            .optional()?;
        let Some(digest) = digest else {
            return self.latest();
        };
        let installation = animation
            && db.query_row(
                "SELECT EXISTS(SELECT 1 FROM animation_install WHERE job_id=?1)",
                [&job.id],
                |row| row.get::<_, bool>(0),
            )?;
        let verified = if installation {
            animation_install::verify(&job.destination, &digest)
        } else if animation {
            (|| {
                let intent: String = db.query_row(
                    "SELECT intent FROM animation_intent WHERE job_id=?1",
                    [&job.id],
                    |row| row.get(0),
                )?;
                let intent: AnimationIntent = serde_json::from_str(&intent)?;
                super::animation_export::verify_publication(
                    &job.destination,
                    &digest,
                    intent.format,
                )
            })()
        } else {
            snapshot::verify_publication(&job.destination, &digest)
        };
        if verified.is_ok() {
            db.execute(
                "UPDATE job SET state='completed',phase=?2 WHERE id=?1 AND state='interrupted'",
                params![
                    job.id,
                    if animation {
                        "animation-published"
                    } else {
                        "snapshot-published"
                    }
                ],
            )?;
        }
        self.latest()
    }

    pub fn begin(&self, parent: &Path, include_referenced_originals: bool) -> Result<Job> {
        let parent = fs::canonicalize(parent)?;
        if !parent.is_dir() {
            return Err("backup destination must be a directory".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let destination = parent.join(format!("visual-assets-backup-{id}"));
        self.insert(
            id,
            destination,
            "backup",
            include_referenced_originals,
            None,
        )
    }

    pub fn begin_restore(&self, library: &Path) -> Result<Job> {
        self.insert(
            uuid::Uuid::new_v4().to_string(),
            library.to_path_buf(),
            "restore",
            false,
            None,
        )
    }

    fn insert(
        &self,
        id: String,
        destination: PathBuf,
        operation: &str,
        include_referenced_originals: bool,
        animation: Option<AnimationSubmission<'_>>,
    ) -> Result<Job> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.query_row("SELECT EXISTS(SELECT 1 FROM job WHERE state IN ('queued','running','publishing','cancelling'))", [], |row| row.get::<_, bool>(0))? {
            return Err("a visual asset backup is already active".into());
        }
        tx.execute(
            "INSERT INTO job(id,state,phase,destination,operation,include_referenced_originals) VALUES (?1,'queued','queued',?2,?3,?4)",
            params![
                id,
                destination.to_str().ok_or("invalid job destination")?,
                operation,
                include_referenced_originals
            ],
        )?;
        if let Some(animation) = animation {
            tx.execute(
                "INSERT INTO animation_intent(job_id,intent) VALUES (?1,?2)",
                params![id, serde_json::to_string(animation.intent)?],
            )?;
            if let Some(previous) = animation.install_previous {
                tx.execute(
                    "INSERT INTO animation_install(job_id,previous_version) VALUES (?1,?2)",
                    params![id, previous],
                )?;
            }
            if let Some(retry) = animation.retry {
                let can_retry: bool = tx.query_row(
                    "SELECT EXISTS(SELECT 1 FROM job WHERE id=?1 AND state='interrupted'
                     AND operation='animation' AND ordinal=(SELECT MAX(ordinal) FROM job WHERE id<>?2))",
                    params![retry.id, id],
                    |row| row.get(0),
                )?;
                if !can_retry {
                    return Err("animation retry is no longer current".into());
                }
                tx.execute(
                    "INSERT INTO animation_retry(job_id,source_job_id,reusable_digest) VALUES (?1,?2,?3)",
                    params![id, retry.id, retry.reusable_digest],
                )?;
            }
        }
        tx.commit()?;
        Ok(Job {
            id,
            state: "queued".into(),
            phase: "queued".into(),
            destination,
            operation: operation.into(),
            include_referenced_originals,
        })
    }

    pub fn cancel(&self, id: &str) -> Result<()> {
        let changed = self.connect()?.execute(
            "UPDATE job SET state='cancelling' WHERE id=?1 AND state IN ('queued','running','cancelling')", [id])?;
        if changed != 1 {
            return Err("backup cannot be cancelled after publication starts".into());
        }
        Ok(())
    }

    fn checkpoint(&self, id: &str, phase: &str) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state: String =
            tx.query_row("SELECT state FROM job WHERE id=?1", [id], |row| row.get(0))?;
        if state == "cancelling" {
            return Err("backup cancelled".into());
        }
        if !matches!(state.as_str(), "queued" | "running" | "publishing") {
            return Err("backup is no longer active".into());
        }
        let next = if state == "publishing" {
            "publishing"
        } else {
            "running"
        };
        tx.execute(
            "UPDATE job SET state=?2,phase=?3 WHERE id=?1 AND (state<>?2 OR phase<>?3)",
            params![id, next, phase],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn interrupted(&self, id: &str) -> Result<()> {
        self.connect()?
            .execute("UPDATE job SET state='interrupted' WHERE id=?1", [id])?;
        Ok(())
    }

    pub fn run(&self, job: &Job, library: &Path, observe: &impl Fn(&str)) -> Result<()> {
        let outcome = (|| -> Result<()> {
            self.checkpoint(&job.id, "preparing")?;
            let parent = job.destination.parent().ok_or("missing backup parent")?;
            // Selection resolves to a fixed directory; reject a changed junction before writing.
            if fs::canonicalize(parent)? != parent {
                return Err("backup destination changed".into());
            }
            let reference_profile = if job.include_referenced_originals {
                Some(library.parent().ok_or("missing library profile")?)
            } else {
                None
            };
            let library = fs::canonicalize(library)?;
            if job.destination.starts_with(&library) {
                return Err("backup must be outside the library".into());
            }
            let mut db = catalog::open(&library)?;
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, &library)?;
            tx.commit()?;
            fs::create_dir(&job.destination)?;
            snapshot::create(
                &mut db,
                &library,
                &job.destination,
                reference_profile,
                &|phase| {
                    observe(phase);
                    self.checkpoint(&job.id, phase)
                },
                &|digest| self.prepare_backup(&job.id, digest),
            )?;
            Ok(())
        })();
        self.finish(job, outcome, job.destination.join("snapshot").exists())
    }

    fn prepare_backup(&self, id: &str, digest: &str) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE job SET state='publishing',phase='snapshot-ready'
             WHERE id=?1 AND state='running' AND operation='backup'",
            [id],
        )?;
        if changed != 1 {
            return Err("backup is no longer active".into());
        }
        tx.execute(
            "INSERT INTO backup_publication(job_id,manifest_digest) VALUES (?1,?2)",
            params![id, digest],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn run_restore(&self, job: &Job, source: &Path, observe: &impl Fn(&str)) -> Result<()> {
        let outcome = (|| -> Result<()> {
            self.checkpoint(&job.id, "preparing")?;
            super::restore_library::install(
                source,
                &job.destination,
                uuid::Uuid::parse_str(&job.id)?,
                super::worker::restore_thumbnails(),
                &|phase| self.checkpoint(&job.id, phase),
                &|digest| self.prepare_restore(&job.id, digest),
                observe,
            )?;
            Ok(())
        })();
        self.finish(job, outcome, false)
    }

    fn prepare_restore(&self, id: &str, digest: &str) -> Result<()> {
        let changed = self.connect()?.execute(
            "UPDATE job SET state='publishing',phase='restore-ready',restore_digest=?2
             WHERE id=?1 AND state='running' AND operation='restore'",
            params![id, digest],
        )?;
        if changed != 1 {
            return Err("restore is no longer active".into());
        }
        Ok(())
    }

    fn finish(&self, job: &Job, outcome: Result<()>, published: bool) -> Result<()> {
        let mut db = self.connect()?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let state: String =
            tx.query_row("SELECT state FROM job WHERE id=?1", [&job.id], |row| {
                row.get(0)
            })?;
        let terminal = if outcome.is_ok() {
            "completed"
        } else if published {
            "interrupted"
        } else if state == "cancelling" {
            "cancelled"
        } else {
            "failed"
        };
        tx.execute(
            "UPDATE job SET state=?2,phase=CASE
               WHEN operation='restore' AND ?2='completed' THEN 'restore-installed'
               WHEN operation='animation' AND ?2='completed' THEN 'animation-published'
               ELSE phase END WHERE id=?1",
            params![job.id, terminal],
        )?;
        tx.commit()?;
        outcome
    }
}

struct AnimationSubmission<'a> {
    intent: &'a AnimationIntent,
    install_previous: Option<Option<&'a str>>,
    retry: Option<&'a Retry>,
}

#[cfg(test)]
#[path = "backup_jobs_tests.rs"]
mod tests;

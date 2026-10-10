use super::Run;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

const ERROR: &str = "task_history_unavailable";

#[derive(Serialize, Deserialize)]
struct Summary {
    id: String,
    workspace_id: String,
    directory: String,
    name: String,
    manager: String,
    fingerprint: String,
    status: String,
    started_at: u64,
    finished_at: Option<u64>,
    exit_code: Option<i32>,
}

impl Summary {
    fn from_run(run: &Run) -> Self {
        Self {
            id: run.id.clone(),
            workspace_id: run.workspace_id.clone(),
            directory: run.directory.clone(),
            name: run.name.clone(),
            manager: run.manager.clone(),
            fingerprint: run.fingerprint.clone(),
            status: run.status.clone(),
            started_at: run.started_at,
            finished_at: run.finished_at,
            exit_code: run.exit_code,
        }
    }

    fn into_run(self) -> Run {
        let status = if self.finished_at.is_none()
            || !matches!(self.status.as_str(), "succeeded" | "failed" | "cancelled")
        {
            "unknown".into()
        } else {
            self.status
        };
        Run {
            id: self.id,
            workspace_id: self.workspace_id,
            directory: self.directory,
            name: self.name,
            manager: self.manager,
            fingerprint: self.fingerprint,
            status,
            started_at: self.started_at,
            finished_at: self.finished_at,
            exit_code: self.exit_code,
            historical: true,
            command: String::new(),
            invocation: String::new(),
            executable: String::new(),
            stdout: String::new(),
            stderr: String::new(),
            truncated: false,
        }
    }
}

pub(super) fn scope(root: &Path, workspace: &str) -> String {
    let path = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    let mut hash = Sha256::new();
    hash.update(workspace.as_bytes());
    hash.update([0]);
    #[cfg(unix)]
    {
        use std::os::unix::ffi::OsStrExt;
        // Distinct non-UTF-8 filenames must not share a lossy replacement key.
        hash.update(path.as_os_str().as_bytes());
    }
    #[cfg(windows)]
    {
        let normalized = path
            .to_string_lossy()
            .to_lowercase()
            .replace('\\', "/")
            .trim_start_matches("//?/")
            .to_owned();
        hash.update(normalized.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

#[derive(Default)]
pub(super) struct History {
    connection: Option<Connection>,
    configured: bool,
    failed: bool,
    // Bounded metadata snapshots keep a transient read failure from erasing the
    // last observed history. They are not persisted separately.
    cache: std::collections::VecDeque<(String, Vec<Run>)>,
}

impl History {
    pub fn unavailable() -> Self {
        Self {
            configured: true,
            failed: true,
            ..Self::default()
        }
    }

    pub fn open(path: &Path) -> Self {
        match Self::connect(path) {
            Ok(connection) => Self {
                connection: Some(connection),
                configured: true,
                ..Self::default()
            },
            Err(_) => Self::unavailable(),
        }
    }

    fn connect(path: &Path) -> Result<Connection, String> {
        if std::fs::symlink_metadata(path).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err(ERROR.into());
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|_| ERROR)?;
        }
        let connection = Connection::open(path).map_err(|_| ERROR)?;
        connection
            .busy_timeout(std::time::Duration::from_millis(100))
            .map_err(|_| ERROR)?;
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|_| ERROR)?;
        if version > 1 {
            return Err(ERROR.into());
        }
        connection.execute_batch("CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, scope TEXT NOT NULL, started INTEGER NOT NULL, summary TEXT NOT NULL); CREATE INDEX IF NOT EXISTS runs_scope_time ON runs(scope, started DESC); PRAGMA user_version=1; PRAGMA secure_delete=ON;").map_err(|_| ERROR)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
                .map_err(|_| ERROR)?;
        }
        Ok(connection)
    }

    pub fn status(&self) -> &'static str {
        if !self.configured {
            "memory"
        } else if self.failed {
            "unavailable"
        } else {
            "persistent"
        }
    }

    pub fn save(&mut self, scope: &str, run: &Run) {
        if !self.configured {
            return;
        }
        if self.write(scope, run).is_err() {
            self.failed = true;
        }
    }

    fn write(&mut self, scope: &str, run: &Run) -> Result<(), String> {
        let connection = self.connection.as_mut().ok_or(ERROR)?;
        let transaction = connection.transaction().map_err(|_| ERROR)?;
        insert(&transaction, scope, run)?;
        prune(&transaction, scope)?;
        transaction.commit().map_err(|_| ERROR.to_owned())
    }

    pub fn list(&mut self, scope: &str) -> Vec<Run> {
        if !self.configured {
            return vec![];
        }
        let result = (|| {
            let connection = self.connection.as_ref().ok_or(ERROR)?;
            let mut statement = connection.prepare("SELECT summary FROM runs WHERE scope=?1 ORDER BY started DESC,id DESC LIMIT 40").map_err(|_| ERROR)?;
            let rows = statement
                .query_map([scope], |row| row.get::<_, String>(0))
                .map_err(|_| ERROR)?;
            let mut result = vec![];
            for row in rows {
                let text = row.map_err(|_| ERROR)?;
                if text.len() > 32 * 1024 {
                    return Err(ERROR);
                }
                let summary: Summary = serde_json::from_str(&text).map_err(|_| ERROR)?;
                result.push(summary.into_run());
            }
            Ok(result)
        })();
        match result {
            Ok(runs) => {
                self.cache.retain(|(key, _)| key != scope);
                self.cache.push_back((scope.into(), runs.clone()));
                while self.cache.len() > 12 {
                    self.cache.pop_front();
                }
                runs
            }
            Err(_) => {
                self.failed = true;
                self.cache
                    .iter()
                    .find(|(key, _)| key == scope)
                    .map(|(_, runs)| runs.clone())
                    .unwrap_or_default()
            }
        }
    }

    pub fn clear(&mut self, scope: &str, active: &[Run]) -> Result<(), String> {
        if !self.configured {
            return Ok(());
        }
        let result = (|| {
            let connection = self.connection.as_mut().ok_or(ERROR)?;
            let transaction = connection.transaction().map_err(|_| ERROR)?;
            transaction
                .execute("DELETE FROM runs WHERE scope=?1", [scope])
                .map_err(|_| ERROR)?;
            for run in active {
                insert(&transaction, scope, run)?;
            }
            prune(&transaction, scope)?;
            transaction.commit().map_err(|_| ERROR.to_owned())
        })();
        if result.is_err() {
            self.failed = true;
        } else {
            self.cache.retain(|(key, _)| key != scope);
        }
        result
    }
}

fn prune(connection: &Connection, scope: &str) -> Result<(), String> {
    connection.execute("DELETE FROM runs WHERE scope=?1 AND id NOT IN (SELECT id FROM runs WHERE scope=?1 ORDER BY started DESC,id DESC LIMIT 40)", [scope]).map_err(|_| ERROR)?;
    connection.execute("DELETE FROM runs WHERE id NOT IN (SELECT id FROM runs ORDER BY started DESC,id DESC LIMIT 500)", []).map_err(|_| ERROR)?;
    Ok(())
}

fn insert(connection: &Connection, scope: &str, run: &Run) -> Result<(), String> {
    let summary = serde_json::to_string(&Summary::from_run(run)).map_err(|_| ERROR)?;
    if summary.len() > 32 * 1024 {
        return Err(ERROR.into());
    }
    connection.execute("INSERT INTO runs (id,scope,started,summary) VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,started=excluded.started,summary=excluded.summary", params![run.id, scope, run.started_at, summary]).map_err(|_| ERROR)?;
    Ok(())
}

#[cfg(test)]
#[path = "history_tests.rs"]
mod tests;

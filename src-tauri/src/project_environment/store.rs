use super::{validate, Environment, PythonEnvironment, Settings};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::sync::Mutex;
const ERROR: &str = "project_environment_unavailable";

pub struct Store(Mutex<Option<Connection>>);
impl Store {
    pub fn for_host(static_dir: &Path) -> Self {
        #[cfg(test)]
        let root = Ok::<_, String>(static_dir.parent().unwrap_or(static_dir).to_path_buf());
        #[cfg(not(test))]
        let root = {
            let _ = static_dir;
            crate::app_paths::data_root()
        };
        root.and_then(|p| {
            std::fs::create_dir_all(&p).map_err(|_| ERROR.to_owned())?;
            Ok(Self::open(&p.join("project-environments.sqlite3")))
        })
        .unwrap_or_else(|_| Self(Mutex::new(None)))
    }
    pub fn open(path: &Path) -> Self {
        let connection = (|| -> rusqlite::Result<Connection> {
            let db = Connection::open(path)?;
            db.busy_timeout(std::time::Duration::from_millis(500))?;
            db.execute_batch("CREATE TABLE IF NOT EXISTS project_environments (scope TEXT PRIMARY KEY, revision INTEGER NOT NULL, directories TEXT NOT NULL)")?;
            db.execute_batch("CREATE TABLE IF NOT EXISTS project_python_environments (scope TEXT PRIMARY KEY, environment TEXT)")?;
            Ok(db)
        })().ok();
        Self(Mutex::new(connection))
    }
    pub fn read(&self, root: &Path, workspace: &str) -> Result<Settings, String> {
        let scope = scope(root, workspace)?;
        let guard = self.0.lock().map_err(|_| ERROR)?;
        read(guard.as_ref().ok_or(ERROR)?, &scope)
    }
    pub fn resolve(&self, root: &Path, workspace: &str) -> Result<Environment, String> {
        Environment::new(self.read(root, workspace)?)
    }
    #[cfg(test)]
    pub fn save(
        &self,
        root: &Path,
        workspace: &str,
        expected: u64,
        directories: Vec<String>,
    ) -> Result<Settings, String> {
        self.save_selection(root, workspace, expected, directories, None)
    }
    pub fn save_selection(
        &self,
        root: &Path,
        workspace: &str,
        expected: u64,
        directories: Vec<String>,
        python_update: Option<Option<String>>,
    ) -> Result<Settings, String> {
        let scope = scope(root, workspace)?;
        let python_update = python_update
            .map(|value| {
                value
                    .map(|path| {
                        PythonEnvironment::inspect(&path)
                            .map(|environment| environment.root.to_string_lossy().into_owned())
                    })
                    .transpose()
            })
            .transpose()?;
        let directories = validate(&directories)?
            .into_iter()
            .map(|p| p.to_string_lossy().into_owned())
            .collect();
        let mut guard = self.0.lock().map_err(|_| ERROR)?;
        let db = guard.as_mut().ok_or(ERROR)?;
        let tx = db
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
            .map_err(|_| ERROR)?;
        let current = read(&tx, &scope)?;
        if current.revision != expected {
            return Err("project_environment_conflict".into());
        }
        let settings = Settings {
            revision: expected
                .checked_add(1)
                .filter(|r| *r <= i64::MAX as u64)
                .ok_or(ERROR)?,
            directories,
            python_environment: python_update.unwrap_or(current.python_environment),
        };
        tx.execute("INSERT INTO project_environments(scope, revision, directories) VALUES (?1, ?2, ?3) ON CONFLICT(scope) DO UPDATE SET revision=excluded.revision, directories=excluded.directories",
            params![scope, settings.revision, serde_json::to_string(&settings.directories).map_err(|_| ERROR)?]).map_err(|_| ERROR)?;
        tx.execute("INSERT INTO project_python_environments(scope, environment) VALUES (?1, ?2) ON CONFLICT(scope) DO UPDATE SET environment=excluded.environment", params![scope, settings.python_environment]).map_err(|_| ERROR)?;
        tx.commit().map_err(|_| ERROR)?;
        Ok(settings)
    }
}
fn read(db: &Connection, scope: &str) -> Result<Settings, String> {
    let row: Option<(u64, String, Option<String>)> = db
        .query_row(
            "SELECT p.revision, p.directories, v.environment FROM project_environments p LEFT JOIN project_python_environments v ON p.scope=v.scope WHERE p.scope=?1",
            [scope],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|_| ERROR)?;
    match row {
        None => Ok(Settings::default()),
        Some((revision, directories, python_environment)) => Ok(Settings {
            revision,
            directories: serde_json::from_str(&directories).map_err(|_| ERROR)?,
            python_environment,
        }),
    }
}
fn scope(root: &Path, workspace: &str) -> Result<String, String> {
    let canonical = root
        .canonicalize()
        .map_err(|_| "project_environment_invalid")?;
    let path = canonical.to_string_lossy();
    #[cfg(windows)]
    let path = path.to_lowercase();
    let mut hash = Sha256::new();
    hash.update(workspace.as_bytes());
    hash.update([0]);
    hash.update(path.as_bytes());
    Ok(format!("{:x}", hash.finalize()))
}

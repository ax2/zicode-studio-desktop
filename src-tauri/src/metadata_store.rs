#![cfg_attr(not(test), allow(dead_code))]

use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PairedDeviceRecord {
    pub device_id: String,
    pub device_name: String,
    pub paired_at: i64,
    pub last_seen_at: i64,
    pub revoked_at: Option<i64>,
}

pub struct MetadataStore {
    connection: Connection,
    #[cfg_attr(not(unix), allow(dead_code))]
    path: PathBuf,
}

impl MetadataStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!(
                    "Cannot create ZiCode Studio Desktop metadata directory {}: {error}",
                    parent.display()
                )
            })?;
        }
        let connection = Connection::open(path).map_err(|error| {
            format!(
                "Cannot open ZiCode Studio Desktop metadata database {}: {error}",
                path.display()
            )
        })?;
        let mut store = Self {
            connection,
            path: path.to_path_buf(),
        };
        store.migrate()?;
        store.restrict_permissions()?;
        Ok(store)
    }

    fn migrate(&mut self) -> Result<(), String> {
        let current: i64 = self
            .connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| {
                format!("Cannot read ZiCode Studio Desktop metadata schema version: {error}")
            })?;
        if current > SCHEMA_VERSION {
            return Err(format!(
                "ZiCode Studio Desktop metadata schema {current} is newer than supported schema {SCHEMA_VERSION}"
            ));
        }
        if current == SCHEMA_VERSION {
            return Ok(());
        }
        let transaction = self.connection.transaction().map_err(|error| {
            format!("Cannot start ZiCode Studio Desktop metadata migration: {error}")
        })?;
        transaction
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    canonical_path TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE TABLE IF NOT EXISTS paired_devices (
                    device_id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL UNIQUE,
                    device_name TEXT NOT NULL DEFAULT 'Mobile device',
                    paired_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    last_seen_at INTEGER NOT NULL DEFAULT (unixepoch()),
                    revoked_at INTEGER
                );
                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                PRAGMA user_version = 1;",
            )
            .map_err(|error| {
                format!("Cannot migrate ZiCode Studio Desktop metadata schema: {error}")
            })?;
        if current < 2 {
            let columns = transaction
                .prepare("PRAGMA table_info(paired_devices)")
                .and_then(|mut statement| {
                    statement
                        .query_map([], |row| row.get::<_, String>(1))?
                        .collect::<Result<Vec<_>, _>>()
                })
                .map_err(|error| format!("Cannot inspect paired device metadata: {error}"))?;
            if !columns.iter().any(|column| column == "device_name") {
                transaction
                    .execute(
                        "ALTER TABLE paired_devices ADD COLUMN device_name TEXT NOT NULL DEFAULT 'Mobile device'",
                        [],
                    )
                    .map_err(|error| format!("Cannot add paired device name: {error}"))?;
            }
            if !columns.iter().any(|column| column == "last_seen_at") {
                transaction
                    .execute(
                        "ALTER TABLE paired_devices ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0",
                        [],
                    )
                    .map_err(|error| format!("Cannot add paired device activity: {error}"))?;
                transaction
                    .execute(
                        "UPDATE paired_devices SET last_seen_at = paired_at WHERE last_seen_at = 0",
                        [],
                    )
                    .map_err(|error| format!("Cannot migrate paired device activity: {error}"))?;
            }
            transaction
                .pragma_update(None, "user_version", SCHEMA_VERSION)
                .map_err(|error| format!("Cannot update metadata schema version: {error}"))?;
        }
        transaction.commit().map_err(|error| {
            format!("Cannot commit ZiCode Studio Desktop metadata migration: {error}")
        })
    }

    #[cfg(unix)]
    fn restrict_permissions(&self) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600)).map_err(
            |error| {
                format!(
                    "Cannot restrict metadata permissions {}: {error}",
                    self.path.display()
                )
            },
        )
    }

    #[cfg(not(unix))]
    fn restrict_permissions(&self) -> Result<(), String> {
        Ok(())
    }

    pub fn schema_version(&self) -> Result<i64, String> {
        self.connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| {
                format!("Cannot read ZiCode Studio Desktop metadata schema version: {error}")
            })
    }

    pub fn workspace_id_for_path(&mut self, workspace: &Path) -> Result<String, String> {
        let canonical = workspace.canonicalize().map_err(|error| {
            format!("Cannot resolve workspace {}: {error}", workspace.display())
        })?;
        let canonical = canonical.to_string_lossy();
        if let Some(id) = self
            .connection
            .query_row(
                "SELECT workspace_id FROM workspaces WHERE canonical_path = ?1",
                [canonical.as_ref()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("Cannot query workspace metadata: {error}"))?
        {
            return Ok(id);
        }
        let id = Uuid::new_v4().to_string();
        self.connection
            .execute(
                "INSERT INTO workspaces (workspace_id, canonical_path) VALUES (?1, ?2)",
                params![id, canonical.as_ref()],
            )
            .map_err(|error| format!("Cannot store workspace metadata: {error}"))?;
        Ok(id)
    }

    /// Enumerate every registered workspace as (workspace_id, canonical_path),
    /// ordered by path. Used by the desktop workspace switcher to offer quick
    /// navigation between opened projects.
    pub fn list_workspaces(&self) -> Result<Vec<(String, String)>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT workspace_id, canonical_path FROM workspaces ORDER BY canonical_path")
            .map_err(|error| format!("Cannot query workspace metadata: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|error| format!("Cannot query workspace metadata: {error}"))?;
        let mut workspaces = Vec::new();
        for row in rows {
            workspaces.push(row.map_err(|error| format!("Cannot read workspace row: {error}"))?);
        }
        Ok(workspaces)
    }

    /// Remove a workspace from the registry. The caller is responsible for
    /// relocating the workspace's app data (recycle bin) before calling this,
    /// so the un-registration is the last step of a recoverable delete.
    pub fn remove_workspace(&self, workspace_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "DELETE FROM workspaces WHERE workspace_id = ?1",
                params![workspace_id],
            )
            .map_err(|error| format!("Cannot remove workspace metadata: {error}"))?;
        Ok(())
    }

    pub fn store_device_token(
        &mut self,
        device_id: &str,
        device_name: &str,
        token: &str,
    ) -> Result<(), String> {
        let token_hash = token_hash(token);
        self.connection
            .execute(
                "INSERT INTO paired_devices (
                    device_id, token_hash, device_name, paired_at, last_seen_at, revoked_at
                 ) VALUES (?1, ?2, ?3, unixepoch(), unixepoch(), NULL)
                 ON CONFLICT(device_id) DO UPDATE SET
                   token_hash = excluded.token_hash,
                   device_name = excluded.device_name,
                   paired_at = unixepoch(),
                   last_seen_at = unixepoch(),
                   revoked_at = NULL",
                params![device_id, token_hash, device_name],
            )
            .map_err(|error| format!("Cannot store paired device: {error}"))?;
        Ok(())
    }

    pub fn verify_device_token(&mut self, token: &str) -> Result<bool, String> {
        let token_hash = token_hash(token);
        self.connection
            .execute(
                "UPDATE paired_devices
                 SET last_seen_at = unixepoch()
                 WHERE token_hash = ?1 AND revoked_at IS NULL
                   AND last_seen_at < unixepoch() - 60",
                [&token_hash],
            )
            .map_err(|error| format!("Cannot update paired device activity: {error}"))?;
        self.connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM paired_devices WHERE token_hash = ?1 AND revoked_at IS NULL
                )",
                [token_hash],
                |row| row.get(0),
            )
            .map_err(|error| format!("Cannot verify paired device: {error}"))
    }

    pub fn list_paired_devices(&self) -> Result<Vec<PairedDeviceRecord>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT device_id, device_name, paired_at, last_seen_at, revoked_at
                 FROM paired_devices
                 ORDER BY revoked_at IS NOT NULL, last_seen_at DESC, paired_at DESC",
            )
            .map_err(|error| format!("Cannot prepare paired device list: {error}"))?;
        let devices = statement
            .query_map([], |row| {
                Ok(PairedDeviceRecord {
                    device_id: row.get(0)?,
                    device_name: row.get(1)?,
                    paired_at: row.get(2)?,
                    last_seen_at: row.get(3)?,
                    revoked_at: row.get(4)?,
                })
            })
            .map_err(|error| format!("Cannot list paired devices: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Cannot read paired device: {error}"))?;
        Ok(devices)
    }

    pub fn revoke_device(&mut self, device_id: &str) -> Result<(), String> {
        self.connection
            .execute(
                "UPDATE paired_devices SET revoked_at = unixepoch() WHERE device_id = ?1",
                [device_id],
            )
            .map_err(|error| format!("Cannot revoke paired device: {error}"))?;
        Ok(())
    }

    pub fn reset(&mut self) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| format!("Cannot start metadata reset: {error}"))?;
        transaction
            .execute_batch(
                "DELETE FROM workspaces; DELETE FROM paired_devices; DELETE FROM preferences;",
            )
            .map_err(|error| format!("Cannot reset ZiCode Studio Desktop metadata: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("Cannot commit ZiCode Studio Desktop metadata reset: {error}"))
    }
}

fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

#[cfg(test)]
mod tests {
    use super::MetadataStore;
    use rusqlite::Connection;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("picot-metadata-{nonce}"));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn assigns_stable_workspace_ids_and_stores_only_device_token_hashes() {
        let temp = temp_dir();
        let database = temp.join("picot.sqlite3");
        let workspace = temp.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let mut store = MetadataStore::open(&database).unwrap();

        let first = store.workspace_id_for_path(&workspace).unwrap();
        let second = store.workspace_id_for_path(&workspace).unwrap();
        assert_eq!(first, second);
        assert_eq!(store.schema_version().unwrap(), 2);

        store
            .store_device_token("phone", "Alice's phone", "plain-device-token")
            .unwrap();
        assert!(store.verify_device_token("plain-device-token").unwrap());
        assert!(!store.verify_device_token("wrong-token").unwrap());
        let devices = store.list_paired_devices().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_name, "Alice's phone");
        assert!(devices[0].revoked_at.is_none());
        let bytes = fs::read(&database).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("plain-device-token"));
        store.revoke_device("phone").unwrap();
        assert!(!store.verify_device_token("plain-device-token").unwrap());

        drop(store);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn remove_workspace_unregisters_a_saved_workspace() {
        let temp = temp_dir();
        let database = temp.join("picot.sqlite3");
        let workspace = temp.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let mut store = MetadataStore::open(&database).unwrap();

        let id = store.workspace_id_for_path(&workspace).unwrap();
        assert_eq!(store.list_workspaces().unwrap().len(), 1);
        store.remove_workspace(&id).unwrap();
        assert!(store.list_workspaces().unwrap().is_empty());

        drop(store);
        fs::remove_dir_all(&temp).unwrap();
    }

    #[test]
    fn reset_cannot_modify_pi_sessions_or_workspace_files() {
        let temp = temp_dir();
        let database = temp.join("picot.sqlite3");
        let workspace = temp.join("workspace");
        fs::create_dir(&workspace).unwrap();
        let session = workspace.join("session.jsonl");
        fs::write(&session, "{\"type\":\"session\"}\n").unwrap();
        let mut store = MetadataStore::open(&database).unwrap();
        store.workspace_id_for_path(&workspace).unwrap();

        store.reset().unwrap();

        assert_eq!(
            fs::read_to_string(session).unwrap(),
            "{\"type\":\"session\"}\n"
        );
        assert_eq!(store.schema_version().unwrap(), 2);
        drop(store);
        fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn migrates_existing_paired_devices_without_losing_revocation_state() {
        let temp = temp_dir();
        let database = temp.join("picot.sqlite3");
        let connection = Connection::open(&database).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE paired_devices (
                    device_id TEXT PRIMARY KEY,
                    token_hash BLOB NOT NULL UNIQUE,
                    paired_at INTEGER NOT NULL,
                    revoked_at INTEGER
                );
                CREATE TABLE workspaces (
                    workspace_id TEXT PRIMARY KEY,
                    canonical_path TEXT NOT NULL UNIQUE,
                    created_at INTEGER NOT NULL DEFAULT (unixepoch())
                );
                CREATE TABLE preferences (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );
                INSERT INTO paired_devices VALUES ('old-phone', X'0102', 1234, 1300);
                PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);

        let store = MetadataStore::open(&database).unwrap();
        assert_eq!(store.schema_version().unwrap(), 2);
        let devices = store.list_paired_devices().unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0].device_name, "Mobile device");
        assert_eq!(devices[0].last_seen_at, 1234);
        assert_eq!(devices[0].revoked_at, Some(1300));
        drop(store);
        fs::remove_dir_all(temp).unwrap();
    }
}

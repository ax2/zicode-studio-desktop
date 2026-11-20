//! Named groups of assets. Membership changes leave asset revisions untouched.
use super::catalog::{read_page, Page};
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};

pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS asset_collection(
    id TEXT NOT NULL PRIMARY KEY, name TEXT NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 64));
    CREATE TABLE IF NOT EXISTS asset_collection_member(
    collection TEXT NOT NULL REFERENCES asset_collection(id) ON DELETE CASCADE,
    asset INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    PRIMARY KEY(collection,asset)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS asset_collection_by_asset ON asset_collection_member(asset,collection);";

const PAGE_QUERY: &str = "SELECT m.asset,a.name,r.digest FROM asset_collection_member m
    CROSS JOIN asset a ON a.id=m.asset
    CROSS JOIN revision r ON r.asset=a.id AND r.version=1
    WHERE m.collection=?1 AND m.asset>?2 AND (?3='' OR instr(a.name,?3)>0)
    AND (?4='' OR EXISTS(SELECT 1 FROM asset_tag t WHERE t.tag=?4 AND t.asset=m.asset))
    ORDER BY m.asset LIMIT 51";

#[derive(Serialize)]
pub struct Collection {
    id: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Edit {
    Create {
        name: String,
    },
    Rename {
        id: String,
        previous: String,
        name: String,
    },
    Delete {
        id: String,
        previous: String,
    },
    Membership {
        id: String,
        asset_id: i64,
        member: bool,
    },
}

fn name(value: &str) -> Result<&str, &'static str> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().take(65).count() > 64
        || value.chars().any(char::is_control)
    {
        return Err("visual_assets_invalid_collection_name");
    }
    Ok(value)
}

fn storage<T>(result: rusqlite::Result<T>) -> Result<T, &'static str> {
    result.map_err(|_| "visual_assets_collection_save_failed")
}

fn available_name(db: &Connection, name: &str, except: &str) -> Result<(), &'static str> {
    let exists: bool = storage(db.query_row(
        "SELECT EXISTS(SELECT 1 FROM asset_collection WHERE name=?1 AND id<>?2)",
        params![name, except],
        |row| row.get(0),
    ))?;
    if exists {
        return Err("visual_assets_collection_name_used");
    }
    Ok(())
}

pub fn apply(tx: &Transaction<'_>, edit: Edit) -> Result<Option<String>, &'static str> {
    match edit {
        Edit::Create { name: value } => {
            let name = name(&value)?;
            available_name(tx, name, "")?;
            let id = uuid::Uuid::new_v4().to_string();
            storage(tx.execute(
                "INSERT INTO asset_collection(id,name) VALUES (?1,?2)",
                params![id, name],
            ))?;
            Ok(Some(id))
        }
        Edit::Rename {
            id,
            previous,
            name: value,
        } => {
            let name = name(&value)?;
            available_name(tx, name, &id)?;
            let changed = storage(tx.execute(
                "UPDATE asset_collection SET name=?1 WHERE id=?2 AND name=?3",
                params![name, id, previous],
            ))?;
            if changed == 0 {
                return Err("visual_assets_collection_changed");
            }
            Ok(None)
        }
        Edit::Delete { id, previous } => {
            let changed = storage(tx.execute(
                "DELETE FROM asset_collection WHERE id=?1 AND name=?2",
                params![id, previous],
            ))?;
            if changed == 0 {
                return Err("visual_assets_collection_changed");
            }
            Ok(None)
        }
        Edit::Membership {
            id,
            asset_id,
            member,
        } => {
            let exists: bool = storage(tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM asset_collection WHERE id=?1)
                 AND EXISTS(SELECT 1 FROM asset WHERE id=?2)",
                params![id, asset_id],
                |row| row.get(0),
            ))?;
            if !exists {
                return Err("visual_assets_collection_changed");
            }
            if member {
                storage(tx.execute(
                    "INSERT INTO asset_collection_member VALUES (?1,?2) ON CONFLICT DO NOTHING",
                    params![id, asset_id],
                ))?;
            } else {
                storage(tx.execute(
                    "DELETE FROM asset_collection_member WHERE collection=?1 AND asset=?2",
                    params![id, asset_id],
                ))?;
            }
            Ok(None)
        }
    }
}

pub fn list(db: &Connection) -> rusqlite::Result<Vec<Collection>> {
    let mut statement = db.prepare_cached("SELECT id,name FROM asset_collection ORDER BY name")?;
    let rows = statement.query_map([], |row| {
        Ok(Collection {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;
    rows.collect()
}

#[cfg(windows)]
pub fn has_records(db: &Connection) -> rusqlite::Result<bool> {
    if !db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='asset_collection'")?
        .exists([])?
    {
        return Ok(false);
    }
    db.prepare("SELECT 1 FROM asset_collection LIMIT 1")?
        .exists([])
}

pub fn fill_page(db: &Connection, page: &mut Page) -> rusqlite::Result<()> {
    let mut statement = db.prepare_cached(
        "SELECT collection FROM asset_collection_member WHERE asset=?1 ORDER BY collection",
    )?;
    for asset in &mut page.assets {
        asset.collection_ids = statement
            .query_map([asset.id], |row| row.get(0))?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(())
}

pub fn page(
    db: &Connection,
    after: i64,
    id: &str,
    query: &str,
    tag: &str,
) -> rusqlite::Result<Page> {
    let mut statement = db.prepare_cached(PAGE_QUERY)?;
    let mut rows = statement.query(params![id, after, query, tag])?;
    read_page(&mut rows)
}

#[cfg(test)]
#[path = "collections_tests.rs"]
mod tests;

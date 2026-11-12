//! Catalog queries shared by the acceptance runner and the future Host service.
use super::{collections, duplicates, name_search, tags};
use rusqlite::{Connection, Rows, TransactionBehavior};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

pub const PAGE_SIZE: usize = 50;
const PAGE_QUERY: &str =
    "SELECT a.id, a.name, r.digest FROM asset a JOIN revision r ON a.id=r.asset
     WHERE a.id > ?1 AND r.version=1 ORDER BY a.id LIMIT 51";

#[derive(Debug, Serialize)]
pub struct AssetSummary {
    pub id: i64,
    pub name: String,
    pub digest: String,
    pub tags: Vec<String>,
    #[serde(rename = "collectionIds")]
    pub collection_ids: Vec<String>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub referenced: bool,
    #[serde(
        skip_serializing_if = "std::ops::Not::not",
        rename = "archivedReference"
    )]
    pub archived_reference: bool,
    #[cfg(windows)]
    #[serde(rename = "generatedFrom", skip_serializing_if = "Option::is_none")]
    pub(super) generated_from: Option<super::generation_outputs::Provenance>,
}

#[derive(Debug, Serialize)]
pub struct Page {
    pub assets: Vec<AssetSummary>,
    pub next: Option<i64>,
}

const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS library(id TEXT PRIMARY KEY);
         CREATE TABLE IF NOT EXISTS blob(digest TEXT PRIMARY KEY, bytes INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS asset(id INTEGER PRIMARY KEY, name TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS revision(asset INTEGER REFERENCES asset, version INTEGER,
            digest TEXT NOT NULL REFERENCES blob, PRIMARY KEY(asset, version));";
const DUPLICATE_INDEX: &str = "CREATE INDEX IF NOT EXISTS revision_first_digest
    ON revision(digest, asset) WHERE version=1;";

pub fn open(library: &Path) -> rusqlite::Result<Connection> {
    let mut db = Connection::open(library.join("catalog.sqlite"))?;
    db.execute_batch(
        "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
    )?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute_batch(SCHEMA)?;
    name_search::ensure(&tx)?;
    tx.execute_batch(tags::SCHEMA)?;
    tx.execute_batch(collections::SCHEMA)?;
    tx.execute_batch(DUPLICATE_INDEX)?;
    #[cfg(windows)]
    {
        tx.execute_batch(super::reference_catalog::SCHEMA)?;
        tx.execute_batch(super::reference_catalog::ARCHIVED_SCHEMA)?;
    }
    tx.execute(
        "INSERT INTO library SELECT ?1 WHERE NOT EXISTS (SELECT 1 FROM library)",
        [Uuid::new_v4().to_string()],
    )?;
    tx.commit()?;
    Ok(db)
}

#[cfg(windows)]
pub fn has_managed_schema(db: &Connection) -> rusqlite::Result<bool> {
    fn entries(db: &Connection) -> rusqlite::Result<Vec<Vec<Option<String>>>> {
        db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name")?
            .query_map([], |row| (0..4).map(|column| row.get(column)).collect())?
            .collect()
    }
    let reference = Connection::open_in_memory()?;
    reference.execute_batch(SCHEMA)?;
    let actual = entries(db)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(name_search::SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(tags::SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(collections::SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(DUPLICATE_INDEX)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(super::reference_catalog::SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(super::reference_catalog::ARCHIVED_SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(super::characters::SCHEMA)?;
    if super::novel_drafts::schema_present(db)? {
        reference.execute_batch(super::novel_drafts::SCHEMA)?;
    }
    if super::novel_model_archive::schema_present(db)? {
        reference.execute_batch(super::novel_model_archive::SCHEMA)?;
    }
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(super::generation_recipes::SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(super::generation_attempts::SCHEMA)?;
    if actual == entries(&reference)? {
        return Ok(true);
    }
    reference.execute_batch(super::generation_outputs::SCHEMA)?;
    Ok(actual == entries(&reference)?)
}

#[cfg(windows)]
pub fn add_asset(db: &Connection, name: &str) -> rusqlite::Result<i64> {
    db.execute("INSERT INTO asset(name) VALUES (?1)", [name])?;
    let id = db.last_insert_rowid();
    name_search::index_asset(db, id, name)?;
    Ok(id)
}

pub fn page(db: &Connection, after: i64) -> rusqlite::Result<Page> {
    let mut stmt = db.prepare(PAGE_QUERY)?;
    let mut rows = stmt.query([after])?;
    read_page(&mut rows)
}

pub fn listing(
    db: &Connection,
    after: i64,
    query: &str,
    tag: &str,
    collection: Option<&str>,
    duplicates_only: bool,
) -> rusqlite::Result<Page> {
    let mut page = if duplicates_only {
        duplicates::page(db, after, query, tag, collection)?
    } else if let Some(id) = collection {
        collections::page(db, after, id, query, tag)?
    } else if !tag.is_empty() {
        tags::page(db, after, tag, query)?
    } else if !query.is_empty() {
        name_search::page(db, after, query)?
    } else {
        page(db, after)?
    };
    tags::fill_page(db, &mut page)?;
    collections::fill_page(db, &mut page)?;
    #[cfg(windows)]
    {
        super::reference_catalog::fill_page(db, &mut page)?;
        super::generation_outputs::fill_page(db, &mut page)?;
    }
    Ok(page)
}

pub(super) fn read_page(rows: &mut Rows<'_>) -> rusqlite::Result<Page> {
    let mut assets = Vec::with_capacity(PAGE_SIZE + 1);
    while let Some(row) = rows.next()? {
        assets.push(AssetSummary {
            id: row.get(0)?,
            name: row.get(1)?,
            digest: row.get(2)?,
            tags: Vec::new(),
            collection_ids: Vec::new(),
            referenced: false,
            archived_reference: false,
            #[cfg(windows)]
            generated_from: None,
        });
    }
    let next = if assets.len() > PAGE_SIZE {
        assets.pop();
        assets.last().map(|asset| asset.id)
    } else {
        None
    };
    Ok(Page { assets, next })
}

#[cfg(test)]
#[path = "catalog_tests.rs"]
mod tests;

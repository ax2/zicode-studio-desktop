//! Literal filename search. The index only narrows the candidates.
use super::catalog::{read_page, Page};
use rusqlite::{params, Connection};
use std::collections::HashSet;

pub const MAX_QUERY_CHARS: usize = 64;
const MAX_INDEXED_NAME_CHARS: usize = 255;
pub const SCHEMA: &str = "CREATE TABLE asset_name_gram(
    gram TEXT NOT NULL, asset INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    PRIMARY KEY(gram,asset)) WITHOUT ROWID;";

// Empty grams are reserved for legacy names beyond the index size bound. The
// two ordered ranges can be merged by asset ID without scanning the Catalog.
const QUERY: &str = "SELECT g.asset AS id,a.name,r.digest FROM asset_name_gram g
CROSS JOIN asset a ON a.id=g.asset
CROSS JOIN revision r ON r.asset=a.id AND r.version=1
WHERE g.gram=?1 AND g.asset>?2 AND instr(a.name,?3)>0
UNION ALL
SELECT g.asset AS id,a.name,r.digest FROM asset_name_gram g
CROSS JOIN asset a ON a.id=g.asset
CROSS JOIN revision r ON r.asset=a.id AND r.version=1
WHERE g.gram='' AND g.asset>?2 AND instr(a.name,?3)>0
ORDER BY id LIMIT 51";

pub fn ensure(db: &Connection) -> rusqlite::Result<()> {
    if db
        .prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='asset_name_gram'")?
        .exists([])?
    {
        return Ok(());
    }
    db.execute_batch(SCHEMA)?;
    let mut statement = db.prepare("SELECT id,name FROM asset")?;
    let mut rows = statement.query([])?;
    while let Some(row) = rows.next()? {
        index_asset(db, row.get(0)?, &row.get::<_, String>(1)?)?;
    }
    Ok(())
}

pub fn index_asset(db: &Connection, asset: i64, name: &str) -> rusqlite::Result<()> {
    let mut offsets: Vec<_> = name
        .char_indices()
        .map(|(offset, _)| offset)
        .take(MAX_INDEXED_NAME_CHARS + 1)
        .collect();
    let mut statement =
        db.prepare_cached("INSERT INTO asset_name_gram(gram,asset) VALUES (?1,?2)")?;
    if offsets.len() > MAX_INDEXED_NAME_CHARS {
        statement.execute(params!["", asset])?;
        return Ok(());
    }
    offsets.push(name.len());
    let mut unique = HashSet::new();
    for start in 0..offsets.len() - 1 {
        for end in start + 1..=usize::min(start + 3, offsets.len() - 1) {
            let gram = &name[offsets[start]..offsets[end]];
            if unique.insert(gram) {
                statement.execute(params![gram, asset])?;
            }
        }
    }
    Ok(())
}

pub fn page(db: &Connection, after: i64, query: &str) -> rusqlite::Result<Page> {
    let gram: String = query.chars().take(3).collect();
    let mut statement = db.prepare_cached(QUERY)?;
    let mut rows = statement.query(params![gram, after, query])?;
    read_page(&mut rows)
}

#[cfg(test)]
#[path = "name_search_tests.rs"]
mod tests;

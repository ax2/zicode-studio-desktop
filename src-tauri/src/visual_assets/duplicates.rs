//! Library-wide first-revision matches, including each group's original asset.
use super::catalog::{read_page, Page};
use rusqlite::{params, Connection};

const QUERY: &str = "SELECT a.id,a.name,r.digest FROM asset a
    CROSS JOIN revision r ON r.asset=a.id AND r.version=1
    WHERE a.id>?1 AND (?2='' OR instr(a.name,?2)>0)
    AND EXISTS(SELECT 1 FROM revision d
        WHERE d.digest=r.digest AND d.version=1 AND d.asset<>a.id)
    AND (?3='' OR EXISTS(SELECT 1 FROM asset_tag t WHERE t.tag=?3 AND t.asset=a.id))
    AND (?4 IS NULL OR EXISTS(SELECT 1 FROM asset_collection_member m
        WHERE m.collection=?4 AND m.asset=a.id))
    ORDER BY a.id LIMIT 51";

pub fn page(
    db: &Connection,
    after: i64,
    query: &str,
    tag: &str,
    collection: Option<&str>,
) -> rusqlite::Result<Page> {
    let mut statement = db.prepare_cached(QUERY)?;
    let mut rows = statement.query(params![after, query, tag, collection])?;
    read_page(&mut rows)
}

#[cfg(test)]
#[path = "duplicates_tests.rs"]
mod tests;

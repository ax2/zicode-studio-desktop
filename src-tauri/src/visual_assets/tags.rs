//! Asset tags are exact, library-local labels. Edits use the caller's read version.
use super::catalog::{read_page, Page};
use rusqlite::{params, Connection, Transaction};

pub const MAX_TAGS: usize = 16;
pub const MAX_TAG_CHARS: usize = 32;
pub const SCHEMA: &str = "CREATE TABLE IF NOT EXISTS asset_tag(
    tag TEXT NOT NULL CHECK(length(tag) BETWEEN 1 AND 32),
    asset INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
    PRIMARY KEY(tag,asset)) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS asset_tag_by_asset ON asset_tag(asset,tag);";

const BY_ASSET: &str = "SELECT tag FROM asset_tag WHERE asset=?1 ORDER BY tag LIMIT 17";
const PAGE_QUERY: &str = "SELECT t.asset,a.name,r.digest FROM asset_tag t
    CROSS JOIN asset a ON a.id=t.asset
    CROSS JOIN revision r ON r.asset=a.id AND r.version=1
    WHERE t.tag=?1 AND t.asset>?2 AND (?3='' OR instr(a.name,?3)>0)
    ORDER BY t.asset LIMIT 51";

pub fn valid(tag: &str) -> bool {
    !tag.is_empty()
        && tag.chars().take(MAX_TAG_CHARS + 1).count() <= MAX_TAG_CHARS
        && !tag
            .chars()
            .any(|character| character.is_control() || matches!(character, ',' | '，'))
}

fn normalized(tags: &[String]) -> Result<Vec<String>, &'static str> {
    if tags.len() > MAX_TAGS {
        return Err("visual_assets_invalid_tags");
    }
    let mut result = Vec::with_capacity(tags.len());
    for tag in tags {
        let tag = tag.trim();
        if !valid(tag) {
            return Err("visual_assets_invalid_tags");
        }
        result.push(tag.to_owned());
    }
    result.sort_unstable();
    result.dedup();
    Ok(result)
}

pub fn replace(
    db: &Transaction<'_>,
    asset: i64,
    previous: &[String],
    tags: &[String],
) -> Result<Vec<String>, &'static str> {
    let previous = normalized(previous)?;
    let tags = normalized(tags)?;
    let exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM asset WHERE id=?1)",
            [asset],
            |row| row.get(0),
        )
        .map_err(|_| "visual_assets_tag_save_failed")?;
    if !exists {
        return Err("visual_assets_asset_missing");
    }
    let current = read(db, asset).map_err(|_| "visual_assets_tag_save_failed")?;
    if current != previous {
        return Err("visual_assets_tags_changed");
    }
    if current != tags {
        db.execute("DELETE FROM asset_tag WHERE asset=?1", [asset])
            .map_err(|_| "visual_assets_tag_save_failed")?;
        let mut insert = db
            .prepare_cached("INSERT INTO asset_tag(tag,asset) VALUES (?1,?2)")
            .map_err(|_| "visual_assets_tag_save_failed")?;
        for tag in &tags {
            insert
                .execute(params![tag, asset])
                .map_err(|_| "visual_assets_tag_save_failed")?;
        }
    }
    Ok(tags)
}

pub(super) fn read(db: &Connection, asset: i64) -> rusqlite::Result<Vec<String>> {
    let mut statement = db.prepare_cached(BY_ASSET)?;
    let values = statement
        .query_map([asset], |row| row.get(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if values.len() > MAX_TAGS {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(values)
}

pub fn fill_page(db: &Connection, page: &mut Page) -> rusqlite::Result<()> {
    for asset in &mut page.assets {
        asset.tags = read(db, asset.id)?;
    }
    Ok(())
}

pub fn page(db: &Connection, after: i64, tag: &str, query: &str) -> rusqlite::Result<Page> {
    let mut statement = db.prepare_cached(PAGE_QUERY)?;
    let mut rows = statement.query(params![tag, after, query])?;
    read_page(&mut rows)
}

#[cfg(test)]
#[path = "tags_tests.rs"]
mod tests;

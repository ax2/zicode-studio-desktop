//! Traversal and timings for the production listing query in an isolated Windows probe.
use super::{catalog, name_search, Result};
use rusqlite::Connection;
use serde::ser::{SerializeSeq, Serializer};
use serde_json::{json, Value};
use std::{io::Write, time::Instant};

pub(super) fn scan(db: &Connection, output: impl Write) -> Result<()> {
    let mut serializer = serde_json::Serializer::new(output);
    let mut sequence = serializer.serialize_seq(None)?;
    let mut after = 0;
    loop {
        let page = catalog::listing(db, after, "", "", None, false)?;
        let mut last = after;
        for asset in &page.assets {
            if asset.id <= last {
                return Err("listing IDs were repeated or out of order".into());
            }
            sequence.serialize_element(asset)?;
            last = asset.id;
        }
        match page.next {
            Some(next) if next == last && page.assets.len() == catalog::PAGE_SIZE => after = next,
            Some(_) => return Err("invalid cursor or page length".into()),
            None => return Ok(sequence.end()?),
        }
    }
}

pub(super) fn measure(db: &Connection, after: i64, query: &str) -> Result<Value> {
    if after < 0 || query.chars().count() > name_search::MAX_QUERY_CHARS {
        return Err("invalid listing measurement".into());
    }
    let started = Instant::now();
    let page = catalog::listing(db, after, query, "", None, false)?;
    let first_ms = started.elapsed().as_secs_f64() * 1000.0;
    let expected: Vec<_> = page.assets.iter().map(|asset| asset.id).collect();
    let mut repeats = Vec::with_capacity(32);
    for _ in 0..32 {
        let started = Instant::now();
        let next = catalog::listing(db, after, query, "", None, false)?;
        repeats.push(started.elapsed().as_secs_f64() * 1000.0);
        if next.next != page.next
            || !next
                .assets
                .iter()
                .map(|asset| asset.id)
                .eq(expected.iter().copied())
        {
            return Err("listing results changed between measurements".into());
        }
    }
    repeats.sort_by(f64::total_cmp);
    let p95 = repeats[(repeats.len() * 95).div_ceil(100) - 1];
    Ok(json!({
        "after": after, "query": query, "assets": expected, "next": page.next,
        "firstQueryMs": first_ms, "repeatCount": repeats.len(), "repeatP95Ms": p95,
    }))
}

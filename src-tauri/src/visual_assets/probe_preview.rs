//! Measure repeated reference previews inside one isolated probe process.
use super::{preview, Result};
use base64::Engine;
use rusqlite::Connection;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::Path, time::Instant};

pub(super) fn render(db: &Connection, root: &Path, asset: i64, repeat: bool) -> Result<Value> {
    let library: String = db.query_row("SELECT id FROM library", [], |row| row.get(0))?;
    let owner = preview::Owner {
        window: "probe".into(),
        workspace: "isolated".into(),
        route: "visual-assets".into(),
    };
    let mut previews = preview::Previews::default();
    let mut read = || -> Result<String> {
        let ticket = previews.issue(db, owner.clone(), &library, asset, 1)?;
        Ok(previews.read(db, root, &owner, &ticket.handle)?)
    };
    let started = Instant::now();
    let png = read()?;
    let cold_ms = started.elapsed().as_secs_f64() * 1000.0;
    if !repeat {
        return Ok(json!({"mimeType": "image/png", "base64": png}));
    }
    let mut warm_ms = Vec::new();
    for _ in 0..8 {
        let started = Instant::now();
        let next = read()?;
        warm_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        if next != png {
            return Err("repeated preview bytes changed".into());
        }
    }
    let decoded = base64::engine::general_purpose::STANDARD.decode(&png)?;
    Ok(json!({
        "coldMs": cold_ms,
        "warmMs": warm_ms,
        "previewSHA256": format!("{:x}", Sha256::digest(&decoded)),
    }))
}

//! The batch shares the existing one-file journal and commits independently per asset.
use super::{imports, worker, Result};
use rusqlite::{Connection, TransactionBehavior};
use serde::Serialize;
use std::{
    fs::File,
    path::{Path, PathBuf},
};

pub const MAX_FILES: usize = 16;

#[derive(Serialize)]
pub struct Item {
    name: String,
    position: usize,
    #[serde(flatten)]
    outcome: Outcome,
}

#[derive(Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub(super) enum Outcome {
    Imported {
        asset_id: i64,
        #[serde(skip_serializing_if = "Option::is_none")]
        duplicate_of: Option<imports::DuplicateCandidate>,
    },
    Failed,
    Unconfirmed,
    NotAttempted,
}

pub fn import_selected(
    db: &mut Connection,
    library: &Path,
    sources: &[PathBuf],
    checkpoint: &impl Fn(&str),
) -> Result<Vec<Item>> {
    if sources.is_empty() || sources.len() > MAX_FILES {
        return Err("invalid batch size".into());
    }
    // Open each selected file once. Work uses the held handles, so a queued
    // file cannot be replaced with another file at the same path.
    let sources: Vec<_> = sources
        .iter()
        .map(|source| {
            let name = source
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            (name, worker::open_input(source).ok())
        })
        .collect();
    Ok(results(sources, |name, file| {
        import_one(db, library, name, file, checkpoint)
    }))
}

pub(super) fn results<T>(
    sources: impl IntoIterator<Item = (String, T)>,
    mut import: impl FnMut(&str, T) -> Outcome,
) -> Vec<Item> {
    let mut stopped = false;
    sources
        .into_iter()
        .enumerate()
        .map(|(position, (name, file))| {
            let outcome = if stopped {
                Outcome::NotAttempted
            } else {
                import(&name, file)
            };
            stopped = matches!(outcome, Outcome::Unconfirmed | Outcome::NotAttempted);
            Item {
                name,
                position,
                outcome,
            }
        })
        .collect()
}

fn import_one(
    db: &mut Connection,
    library: &Path,
    name: &str,
    file: Option<File>,
    checkpoint: &impl Fn(&str),
) -> Outcome {
    let Some(file) = file else {
        return Outcome::Failed;
    };
    let Ok(bytes) = worker::read_input_file(file) else {
        return Outcome::Failed;
    };
    let Ok(tx) = db.transaction_with_behavior(TransactionBehavior::Immediate) else {
        return Outcome::NotAttempted;
    };
    if imports::recover(&tx, library).is_err() {
        return Outcome::NotAttempted;
    }
    let Ok(imported) = imports::import_bytes(&tx, library, name, &bytes, checkpoint) else {
        return Outcome::Failed;
    };
    if tx.commit().is_err() {
        return Outcome::Unconfirmed;
    }
    checkpoint("committed");
    Outcome::Imported {
        asset_id: imported.asset_id,
        duplicate_of: imported.duplicate_of,
    }
}

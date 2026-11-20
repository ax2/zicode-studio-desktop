use super::{
    animation,
    generation_attempts::{self, Plan},
    generation_outputs, Result,
};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::{ffi::OsString, path::Path};
use uuid::Uuid;

pub(super) fn run(
    db: &mut Connection,
    library: &Path,
    operation: Option<&str>,
    args: &[OsString],
    checkpoint: &impl Fn(&str),
) -> Option<Result<Value>> {
    match (operation, args) {
        (Some(action @ ("comfy-plan" | "comfy-run")), [selection, port]) => Some((|| {
            let selection = serde_json::from_slice(&animation::read_recipe(Path::new(selection))?)?;
            let port = port.to_str().ok_or("invalid port")?.parse()?;
            let plan = Plan::load(db, selection, port)?;
            plan.check_provider()?;
            if action == "comfy-plan" {
                return Ok(json!({"plan":plan}));
            }
            let expected: String = db.query_row("SELECT id FROM library", [], |row| row.get(0))?;
            let (_, prepared) =
                generation_attempts::begin(db, library, &expected, Uuid::new_v4(), plan)?;
            let attempt = generation_attempts::run(library, &expected, prepared, checkpoint)?;
            Ok(json!({"attempt":attempt}))
        })()),
        (Some("comfy-refresh"), [expected, id]) => Some((|| {
            let attempt = generation_attempts::refresh(
                library,
                expected.to_str().ok_or("invalid library id")?,
                Uuid::parse_str(id.to_str().ok_or("invalid attempt id")?)?,
            )?;
            Ok(json!({"attempt":attempt}))
        })()),
        (Some("comfy-list"), [expected, selection]) => Some((|| {
            let selection = serde_json::from_slice(&animation::read_recipe(Path::new(selection))?)?;
            let attempts = generation_attempts::list(
                db,
                library,
                expected.to_str().ok_or("invalid library id")?,
                &selection,
            )?;
            Ok(json!({"attempts":attempts}))
        })()),
        (Some("comfy-review"), [expected, id, filename]) => Some((|| {
            let source = generation_outputs::Source::load(
                db,
                text(expected)?,
                Uuid::parse_str(text(id)?)?,
                text(filename)?,
            )?;
            let bytes = source.download()?;
            Ok(
                json!({"sha256":generation_outputs::digest(&bytes),"base64":generation_outputs::thumbnail(db,library,&bytes)?}),
            )
        })()),
        (Some("comfy-archive"), [expected, id, filename, digest]) => Some((|| {
            let expected = text(expected)?;
            let digest = text(digest)?;
            let source = generation_outputs::Source::load(
                db,
                expected,
                Uuid::parse_str(text(id)?)?,
                text(filename)?,
            )?;
            if let Some(archived) = source.existing(db, digest)? {
                return Ok(json!({"archived":archived}));
            }
            let bytes = source.download()?;
            Ok(json!({"archived":source.archive(db,library,expected,&bytes,digest,checkpoint)?}))
        })()),
        _ => None,
    }
}

fn text(argument: &OsString) -> Result<&str> {
    argument
        .to_str()
        .ok_or_else(|| "invalid generation argument".into())
}

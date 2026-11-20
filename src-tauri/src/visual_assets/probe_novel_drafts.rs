use super::{
    animation,
    characters::{self, Facet},
    generation_attempts, imports,
    novel_drafts::{self, Chapter},
    Result,
};
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{ffi::OsString, path::Path};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureChapter {
    workspace_id: String,
    notebook_id: String,
    id: String,
    title: String,
    revision: String,
    body: String,
}

impl FixtureChapter {
    fn chapter(&self) -> Chapter<'_> {
        Chapter {
            workspace_id: &self.workspace_id,
            notebook_id: &self.notebook_id,
            id: &self.id,
            title: &self.title,
            revision: &self.revision,
            body: &self.body,
        }
    }
}

pub(super) fn run(
    db: &mut Connection,
    library: &Path,
    operation: Option<&str>,
    args: &[OsString],
    checkpoint: &impl Fn(&str),
) -> Option<Result<Value>> {
    let (Some(operation), [expected, args @ ..]) = (operation, args) else {
        return None;
    };
    if !matches!(
        operation,
        "novel-preview" | "novel-save" | "novel-approve" | "novel-list" | "novel-model-save"
    ) {
        return None;
    }
    Some((|| {
        generation_attempts::check_library(db, text(expected)?)?;
        match (operation, args) {
            ("novel-model-save", [proposal, chapter, model_source]) => {
                let proposal: novel_drafts::Proposal =
                    serde_json::from_slice(&animation::read_recipe(Path::new(proposal))?)?;
                let chapter: FixtureChapter =
                    serde_json::from_slice(&animation::read_recipe(Path::new(chapter))?)?;
                let source = super::novel_model_source::Source::seal(serde_json::from_slice(
                    &animation::read_recipe(Path::new(model_source))?,
                )?)?;
                if let Some(id) = super::novel_model_archive::existing(
                    db,
                    source.job_id,
                    proposal.draft_id,
                    &proposal.text,
                    &proposal.evidence.workspace_id,
                )? {
                    return Ok(json!({"id":id}));
                }
                let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
                imports::recover(&tx, library)?;
                novel_drafts::create(&tx, &proposal, chapter.chapter())?;
                super::novel_model_archive::insert(&tx, proposal.draft_id, &source)?;
                checkpoint("novel-model-before-commit");
                tx.commit()?;
                checkpoint("novel-model-committed");
                Ok(json!({"id":proposal.draft_id}))
            }
            ("novel-preview", [character, source, phrase]) => {
                let source: FixtureChapter =
                    serde_json::from_slice(&animation::read_recipe(Path::new(source))?)?;
                let base = characters::latest(db, text(character)?, Facet::Identity)?;
                Ok(json!({"excerpts":source.chapter().excerpts(text(phrase)?)?,"baseVersion":base}))
            }
            ("novel-save", [proposal, source]) => {
                let proposal =
                    serde_json::from_slice(&animation::read_recipe(Path::new(proposal))?)?;
                let source: FixtureChapter =
                    serde_json::from_slice(&animation::read_recipe(Path::new(source))?)?;
                let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
                imports::recover(&tx, library)?;
                novel_drafts::create(&tx, &proposal, source.chapter())?;
                tx.commit()?;
                Ok(json!({"saved":true}))
            }
            ("novel-approve", [id, source]) => {
                let source: FixtureChapter =
                    serde_json::from_slice(&animation::read_recipe(Path::new(source))?)?;
                let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
                imports::recover(&tx, library)?;
                let version =
                    novel_drafts::approve(&tx, Uuid::parse_str(text(id)?)?, source.chapter())?;
                checkpoint("novel-draft-before-commit");
                tx.commit()?;
                checkpoint("novel-draft-committed");
                Ok(json!({"version":version}))
            }
            ("novel-list", [character]) => {
                let (entries, next) = novel_drafts::list(db, text(character)?, None)?;
                Ok(json!({"entries":entries,"next":next}))
            }
            _ => Err("invalid novel draft probe arguments".into()),
        }
    })())
}

fn text(argument: &OsString) -> Result<&str> {
    argument
        .to_str()
        .ok_or_else(|| "invalid novel draft argument".into())
}

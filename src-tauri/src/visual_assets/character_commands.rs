use super::{
    characters::{self, references, Facet},
    generation_recipes::{self, Draft},
    imports, Result,
};
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Action {
    List {
        after: Option<String>,
    },
    Create {
        name: String,
        identity: String,
    },
    Revisions {
        id: String,
        facet: Facet,
        before: Option<i64>,
    },
    Append {
        id: String,
        facet: Facet,
        previous: Option<i64>,
        text: String,
    },
    ReferenceSets {
        id: String,
        before: Option<i64>,
    },
    ApproveReferences {
        id: String,
        request_id: String,
        name: String,
        references: Vec<references::AssetRevision>,
    },
    Recipes {
        id: String,
        after: Option<String>,
    },
    RecipeVersions {
        id: String,
        recipe_id: String,
        before: Option<i64>,
    },
    RecipeInputs {
        id: String,
        recipe_id: String,
        version: i64,
    },
    CreateRecipe {
        id: String,
        name: String,
        draft: Draft,
    },
    AppendRecipe {
        id: String,
        recipe_id: String,
        previous: i64,
        draft: Draft,
    },
}

pub(super) fn apply(
    db: &mut Connection,
    library: &Path,
    expected: &str,
    action: Action,
    checkpoint: &impl Fn(&str),
) -> Result<Value> {
    let actual: String = db.query_row("SELECT id FROM library", [], |row| row.get(0))?;
    if expected != actual {
        return Err("visual_assets_library_changed".into());
    }
    let result = match action {
        Action::List { after } => {
            let (entries, next) = characters::list(db, after.as_deref())?;
            json!({"entries": entries,"next":next})
        }
        Action::Revisions { id, facet, before } => {
            let (entries, next) = characters::revisions(db, &id, facet, before)?;
            json!({"entries":entries,"next":next})
        }
        Action::ReferenceSets { id, before } => {
            let (entries, next) = references::list(db, &id, before)?;
            json!({"entries":entries,"next":next})
        }
        Action::Recipes { id, after } => {
            let (entries, next) = generation_recipes::list(db, &id, after.as_deref())?;
            json!({"entries":entries,"next":next})
        }
        Action::RecipeVersions {
            id,
            recipe_id,
            before,
        } => {
            let (entries, next) = generation_recipes::versions(db, &id, &recipe_id, before)?;
            json!({"entries":entries,"next":next})
        }
        Action::RecipeInputs {
            id,
            recipe_id,
            version,
        } => generation_recipes::resolve(db, &id, &recipe_id, version)?,
        Action::CreateRecipe { id, name, draft } => {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            let id = generation_recipes::create(&tx, &id, &name, &draft)?;
            tx.commit()?;
            json!({"id":id,"version":1})
        }
        Action::AppendRecipe {
            id,
            recipe_id,
            previous,
            draft,
        } => {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            let version = generation_recipes::append(&tx, &id, &recipe_id, previous, &draft)?;
            tx.commit()?;
            json!({"version":version})
        }
        Action::Create { name, identity } => {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            let id = characters::create(&tx, &name, &identity)?;
            tx.commit()?;
            json!({"id":id})
        }
        Action::Append {
            id,
            facet,
            previous,
            text,
        } => {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            let version = characters::append(&tx, &id, facet, previous, &text)?;
            tx.commit()?;
            json!({"version":version})
        }
        Action::ApproveReferences {
            id,
            request_id,
            name,
            references: selected,
        } => {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
            imports::recover(&tx, library)?;
            tx.commit()?;
            let id =
                references::approve(db, library, &id, &request_id, &name, &selected, checkpoint)?;
            json!({"id":id})
        }
    };
    Ok(result)
}

use super::{
    animation::{self, sequence},
    animation_export,
    animation_request::AnimationFormat,
    Result,
};
use rusqlite::Transaction;
use std::{path::Path, time::Duration};

pub(super) fn export(atlas: &[u8], recipe: &Path, destination: &Path) -> Result<String> {
    let recipe = animation::read_recipe(recipe)?;
    animation_export::export_staged(
        destination,
        (animation::WORKER, Duration::from_secs(30)),
        AnimationFormat::Godot,
        &|_| Ok(()),
        &|_| Ok(()),
        |stage| {
            animation::write_new(&stage.join("atlas.input"), atlas)?;
            animation::write_new(&stage.join("recipe.json"), &recipe)
        },
        animation_export::Stage::create,
    )
}

pub(super) fn export_sequence(
    tx: Transaction<'_>,
    library: &Path,
    recipe: &Path,
    destination: &Path,
) -> Result<String> {
    let recipe = animation::read_recipe(recipe)?;
    let selection = sequence::Selection::parse(&recipe)?;
    animation_export::export_staged(
        destination,
        (sequence::WORKER, Duration::from_secs(60)),
        AnimationFormat::Godot,
        &|_| Ok(()),
        &|_| Ok(()),
        |stage| {
            animation_export::stage_sequence(stage, &tx, library, &selection, &|| Ok(()))?;
            tx.commit()?;
            animation::write_new(&stage.join("recipe.json"), &recipe)
        },
        animation_export::Stage::create,
    )
}

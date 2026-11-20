use super::{
    animation::{self, Output},
    animation_export::{self, Stage},
    animation_request::AnimationIntent,
    backup_destination, Result,
};
use serde_json::Value;
use std::{fs, path::Path, sync::Mutex};

static RENDERING: Mutex<()> = Mutex::new(());

pub(super) fn render(
    library: &Path,
    intent: &AnimationIntent,
    library_lock: &Mutex<()>,
    checkpoint: &impl Fn() -> Result<()>,
) -> Result<Value> {
    let _rendering = RENDERING
        .try_lock()
        .map_err(|_| "visual_assets_animation_preview_busy")?;
    let recipe = intent.recipe_bytes()?;
    let library = fs::canonicalize(library)?;
    let profile = library
        .parent()
        .ok_or("missing animation library profile")?;
    let temporary = profile.join("visual-assets-animation-previews");
    fs::create_dir_all(&temporary)?;
    let (parent, _handles) = backup_destination::hold(&temporary)?;
    if parent != temporary {
        return Err("animation preview directory changed".into());
    }
    let stage = Stage::create(parent)?;
    {
        let _guard = library_lock.try_lock().map_err(|_| "visual_assets_busy")?;
        animation_export::stage_intent(&stage.path, &library, intent, &recipe, checkpoint)?;
    }
    checkpoint()?;
    let (mode, time_limit) = intent.source.worker();
    stage.run(mode, time_limit, Output::Preview, checkpoint)?;
    checkpoint()?;
    animation::read_preview(&stage.path)
}

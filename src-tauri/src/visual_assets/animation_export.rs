use super::{
    animation,
    animation_request::{AnimationFormat, AnimationIntent, AnimationSource},
    animation_stage, backup_destination, catalog, imports, reference_source, worker, Result,
};
use animation::sequence;
use rusqlite::{Connection, TransactionBehavior};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    env, fs,
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use windows_sys::Win32::Storage::FileSystem::MoveFileW;

pub(super) fn stage_sequence(
    stage: &Path,
    db: &Connection,
    library: &Path,
    selection: &sequence::Selection,
    checkpoint: &impl Fn() -> Result<()>,
) -> Result<()> {
    let mut source_bytes = 0;
    for source in selection.unique_sources() {
        checkpoint()?;
        let bytes = imports::read_original(db, library, source.asset, source.version)?;
        source_bytes += bytes.len();
        if source_bytes > sequence::MAX_SOURCE_BYTES {
            return Err("animation exceeds the encoded source budget".into());
        }
        animation::write_new(&source.input(stage), &bytes)?;
    }
    Ok(())
}

pub(super) fn stage_intent(
    stage: &Path,
    library: &Path,
    intent: &AnimationIntent,
    recipe: &[u8],
    checkpoint: &impl Fn() -> Result<()>,
) -> Result<()> {
    checkpoint()?;
    let mut db = catalog::open(library)?;
    let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    imports::recover(&tx, library)?;
    let actual: String = tx.query_row("SELECT id FROM library", [], |row| row.get(0))?;
    if intent.library_id != actual {
        return Err("animation library changed".into());
    }
    match intent.source {
        AnimationSource::Atlas { asset_id, revision } => {
            let bytes = imports::read_original(&tx, library, asset_id, revision)?;
            animation::write_new(&stage.join("atlas.input"), &bytes)?;
        }
        AnimationSource::Sequence => stage_sequence(
            stage,
            &tx,
            library,
            &sequence::Selection::parse(recipe)?,
            checkpoint,
        )?,
    }
    tx.commit()?;
    animation::write_new(&stage.join("recipe.json"), recipe)
}

pub(super) fn export_staged(
    destination: &Path,
    worker: (&str, Duration),
    format: AnimationFormat,
    checkpoint: &impl Fn(&str) -> Result<()>,
    before_publish: &impl Fn(&str) -> Result<()>,
    prepare: impl FnOnce(&Path) -> Result<()>,
    create_stage: impl FnOnce(PathBuf) -> Result<Stage>,
) -> Result<String> {
    if !destination.is_absolute() {
        return Err("animation export requires an absolute destination".into());
    }
    let name = destination
        .file_name()
        .ok_or("missing export directory name")?;
    let parent = destination
        .parent()
        .ok_or("missing export directory parent")?;
    let (parent, _handles) = backup_destination::hold(parent)?;
    let destination = parent.join(name);
    match fs::symlink_metadata(&destination) {
        Ok(_) => return Err("animation export destination already exists".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }

    let stage = create_stage(parent)?;
    prepare(&stage.path)?;
    checkpoint("animation-rendering")?;

    stage.run(worker.0, worker.1, format.into(), &|| {
        checkpoint("animation-rendering")
    })?;
    let project = stage.path.join("project");
    let manifest = fs::read_to_string(project.join("manifest.json"))?;
    let digest = format!("{:x}", Sha256::digest(manifest.as_bytes()));
    if format == AnimationFormat::PngSequence {
        verify_publication(&project, &digest, format)?;
    }
    before_publish(&digest)?;
    publish(&project, &destination)?;
    Ok(manifest)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Inventory {
    schema_version: u32,
    #[serde(default)]
    format: AnimationFormat,
    recipe: InventoryRecipe,
    frame_files: Option<Vec<String>>,
    file_sha256: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct InventoryRecipe {
    frames: Vec<serde::de::IgnoredAny>,
}

pub(super) fn verify_publication(
    destination: &Path,
    digest: &str,
    format: AnimationFormat,
) -> Result<()> {
    let resources = match format {
        AnimationFormat::Godot => &["project.godot", "preview.tscn", "clip.tscn", "clip.tres"][..],
        AnimationFormat::PngSequence => &[],
    };
    verify_inventory(destination, digest, format, resources)
}

pub(super) fn verify_asset(destination: &Path, digest: &str) -> Result<()> {
    verify_inventory(
        destination,
        digest,
        AnimationFormat::Godot,
        &["clip.tscn", "clip.tres"],
    )
}

fn verify_inventory(
    destination: &Path,
    digest: &str,
    format: AnimationFormat,
    resources: &[&str],
) -> Result<()> {
    // A full canvas sequence has at most 128 MiB of raw RGBA, plus PNG overhead.
    const MAX_PACKAGE_BYTES: usize = 160 * 1024 * 1024;
    let (resolved, _project_handles) = backup_destination::hold(destination)?;
    let frames = destination.join("frames");
    let (resolved_frames, _frame_handles) = backup_destination::hold(&frames)?;
    if resolved != destination || resolved_frames != frames {
        return Err("animation publication changed directories".into());
    }
    let bytes = worker::read_input(&destination.join("manifest.json"))?;
    if format!("{:x}", Sha256::digest(&bytes)) != digest {
        return Err("animation publication manifest changed".into());
    }
    let inventory: Inventory = serde_json::from_slice(&bytes)?;
    let mut package_bytes = bytes.len();
    let count = inventory.recipe.frames.len();
    if inventory.format != format
        || !(1..=128).contains(&count)
        || inventory.file_sha256.len() != count + resources.len()
    {
        return Err("invalid animation publication inventory".into());
    }
    if format == AnimationFormat::PngSequence
        && (inventory.schema_version != 1
            || inventory.frame_files.as_ref().is_none_or(|paths| {
                paths.len() != count
                    || paths
                        .iter()
                        .enumerate()
                        .any(|(index, path)| path != &animation::frame_path(index))
            })
            || !has_entry_count(destination, 2)?
            || !has_entry_count(&frames, count)?)
    {
        return Err("invalid PNG sequence publication inventory".into());
    }
    let names = resources
        .iter()
        .copied()
        .map(str::to_owned)
        .chain((0..count).map(animation::frame_path));
    for name in names {
        let expected = inventory
            .file_sha256
            .get(&name)
            .ok_or("missing animation file")?;
        let bytes = worker::read_input(&destination.join(name))?;
        package_bytes += bytes.len();
        if package_bytes > MAX_PACKAGE_BYTES {
            return Err("animation package exceeds the verification budget".into());
        }
        if &format!("{:x}", Sha256::digest(&bytes)) != expected {
            return Err("animation publication file changed".into());
        }
    }
    Ok(())
}

fn has_entry_count(directory: &Path, expected: usize) -> std::io::Result<bool> {
    let count = fs::read_dir(directory)?
        .take(expected + 1)
        .try_fold(0, |count, entry| entry.map(|_| count + 1))?;
    Ok(count == expected)
}

pub(super) fn publish(project: &Path, destination: &Path) -> std::io::Result<()> {
    let source: Vec<u16> = project.as_os_str().encode_wide().chain([0]).collect();
    let target: Vec<u16> = destination.as_os_str().encode_wide().chain([0]).collect();
    // MoveFileW fails if another process creates the destination before publication.
    if unsafe { MoveFileW(source.as_ptr(), target.as_ptr()) } == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

pub(super) struct Stage {
    pub(super) path: PathBuf,
    parent: PathBuf,
    pinned: Option<fs::File>,
}

impl Stage {
    pub(super) fn create(parent: PathBuf) -> Result<Self> {
        Self::create_with_nonce(parent, uuid::Uuid::new_v4())
    }

    pub(super) fn create_tracked(
        parent: PathBuf,
        register: impl FnOnce(uuid::Uuid, &reference_source::Identity) -> Result<()>,
    ) -> Result<Self> {
        let nonce = uuid::Uuid::new_v4();
        let mut stage = Self::create_with_nonce(parent, nonce)?;
        if let Some((directory, identity)) = animation_stage::hold(&stage.path)? {
            register(nonce, &identity)?;
            stage.pinned = Some(directory);
        }
        Ok(stage)
    }

    fn create_with_nonce(parent: PathBuf, nonce: uuid::Uuid) -> Result<Self> {
        let path = animation_stage::path(&parent, nonce);
        fs::create_dir(&path)?;
        Ok(Self {
            path,
            parent,
            pinned: None,
        })
    }

    pub(super) fn run(
        &self,
        mode: &str,
        time_limit: Duration,
        output: animation::Output,
        checkpoint: &impl Fn() -> Result<()>,
    ) -> Result<()> {
        let mut command = Command::new(env::current_exe()?);
        command.arg(mode).arg(&self.path);
        command.args(match output {
            animation::Output::Export => None,
            animation::Output::Preview => Some(animation::PREVIEW_ARGUMENT),
            animation::Output::Asset => Some(animation::ASSET_ARGUMENT),
            animation::Output::PngSequence => Some(animation::PNG_ARGUMENT),
        });
        worker::run_single_with_checkpoint(command, time_limit, checkpoint)
    }
}

impl Drop for Stage {
    fn drop(&mut self) {
        if self.pinned.is_none()
            && fs::canonicalize(&self.path).is_ok_and(|resolved| {
                resolved == self.path && resolved.parent() == Some(&self.parent)
            })
        {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

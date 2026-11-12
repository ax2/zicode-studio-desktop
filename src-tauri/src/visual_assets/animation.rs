//! Assemble bounded animation clips without resampling or alpha blending.
use super::{animation_request::AnimationFormat, snapshot, worker, Result};
use image::{GenericImage, GenericImageView, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::Path,
};

#[path = "animation_godot.rs"]
mod godot;
#[path = "animation_preview_frames.rs"]
mod preview_frames;
#[path = "animation_sequence.rs"]
pub(super) mod sequence;
pub(super) use preview_frames::read_preview;

pub(super) const WORKER: &str = "--zicode-visual-assets-animation-worker";
pub(super) const PREVIEW_ARGUMENT: &str = "preview";
pub(super) const ASSET_ARGUMENT: &str = "asset";
pub(super) const PNG_ARGUMENT: &str = "png-sequence";
pub(super) const MAX_RECIPE_BYTES: u64 = 64 * 1024;
const MAX_FRAMES: usize = 128;
const MAX_CANVAS_EDGE: u32 = 2048;
const MAX_TOTAL_PIXELS: u64 = 32 * 1024 * 1024;
const MAX_DURATION_MS: u32 = 60_000;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Recipe {
    looped: bool,
    frames: Vec<Frame>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Frame {
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    duration_ms: u32,
    anchor_x: u32,
    anchor_y: u32,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Canvas {
    width: u32,
    height: u32,
    origin_x: u32,
    origin_y: u32,
}

impl Recipe {
    fn layout(&self, width: u32, height: u32) -> Result<Canvas> {
        if self.frames.iter().any(|frame| {
            frame
                .x
                .checked_add(frame.width)
                .is_none_or(|end| end > width)
                || frame
                    .y
                    .checked_add(frame.height)
                    .is_none_or(|end| end > height)
        }) {
            return Err("frame rectangle is outside the atlas".into());
        }
        Canvas::layout(&self.frames)
    }
}

fn validate_frame_count(count: usize) -> Result<()> {
    if !(1..=MAX_FRAMES).contains(&count) {
        return Err("animation must contain 1 to 128 frames".into());
    }
    Ok(())
}

pub(super) fn validate_atlas_recipe(bytes: &[u8]) -> Result<()> {
    let recipe: Recipe = serde_json::from_slice(bytes)?;
    Canvas::layout(&recipe.frames)?;
    if recipe.frames.iter().any(|frame| {
        frame
            .x
            .checked_add(frame.width)
            .is_none_or(|edge| edge > 4096)
            || frame
                .y
                .checked_add(frame.height)
                .is_none_or(|edge| edge > 4096)
    }) {
        return Err("frame rectangle exceeds the atlas edge limit".into());
    }
    Ok(())
}

impl Canvas {
    fn layout(frames: &[Frame]) -> Result<Self> {
        validate_frame_count(frames.len())?;
        let (mut left, mut top, mut right, mut bottom) = (0, 0, 0, 0);
        for frame in frames {
            if frame.width == 0
                || frame.height == 0
                || frame.anchor_x > frame.width
                || frame.anchor_y > frame.height
                || !(1..=MAX_DURATION_MS).contains(&frame.duration_ms)
            {
                return Err("invalid frame rectangle, anchor or duration".into());
            }
            left = left.max(frame.anchor_x);
            top = top.max(frame.anchor_y);
            right = right.max(frame.width - frame.anchor_x);
            bottom = bottom.max(frame.height - frame.anchor_y);
        }
        let width = u64::from(left) + u64::from(right);
        let height = u64::from(top) + u64::from(bottom);
        if width > u64::from(MAX_CANVAS_EDGE)
            || height > u64::from(MAX_CANVAS_EDGE)
            || width * height * frames.len() as u64 > MAX_TOTAL_PIXELS
        {
            return Err("animation exceeds the output pixel budget".into());
        }
        Ok(Canvas {
            width: u32::try_from(width)?,
            height: u32::try_from(height)?,
            origin_x: left,
            origin_y: top,
        })
    }
    fn extract(&self, atlas: &RgbaImage, frame: &Frame) -> Result<RgbaImage> {
        let crop = atlas.view(frame.x, frame.y, frame.width, frame.height);
        let mut image = RgbaImage::new(self.width, self.height);
        image.copy_from(
            &*crop,
            self.origin_x - frame.anchor_x,
            self.origin_y - frame.anchor_y,
        )?;
        Ok(image)
    }
}

#[derive(Serialize)]
#[serde(untagged, rename_all_fields = "camelCase")]
enum Provenance {
    Atlas { atlas_sha256: String },
    Sequence { frame_source_sha256: Vec<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Manifest<'a> {
    schema_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    engine: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    format: Option<AnimationFormat>,
    #[serde(flatten)]
    provenance: Provenance,
    recipe: &'a Recipe,
    canvas: &'a Canvas,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_files: Option<Vec<String>>,
    file_sha256: BTreeMap<String, String>,
}

#[derive(Clone, Copy)]
pub(super) enum Output {
    Export,
    Preview,
    Asset,
    PngSequence,
}

impl From<AnimationFormat> for Output {
    fn from(format: AnimationFormat) -> Self {
        match format {
            AnimationFormat::Godot => Self::Export,
            AnimationFormat::PngSequence => Self::PngSequence,
        }
    }
}

pub(super) fn run_if_requested(args: &[OsString]) -> Option<Result<()>> {
    let (mode, stage, output) = match args {
        [mode, stage] => (mode, stage, Output::Export),
        [mode, stage, output] if output == PREVIEW_ARGUMENT => (mode, stage, Output::Preview),
        [mode, stage, output] if output == ASSET_ARGUMENT => (mode, stage, Output::Asset),
        [mode, stage, output] if output == PNG_ARGUMENT => (mode, stage, Output::PngSequence),
        _ => return None,
    };
    if mode == WORKER {
        Some(run_worker(Path::new(stage), output))
    } else if mode == sequence::WORKER {
        Some(sequence::run_worker(Path::new(stage), output))
    } else {
        None
    }
}

pub(super) fn run_worker(stage: &Path, output: Output) -> Result<()> {
    let recipe: Recipe = serde_json::from_slice(&worker_recipe(stage)?)?;
    let bytes = worker::read_input(&stage.join("atlas.input"))?;
    let digest = format!("{:x}", Sha256::digest(&bytes));
    let atlas = worker::decode_static(&bytes)?.into_rgba8();
    drop(bytes);
    let canvas = recipe.layout(atlas.width(), atlas.height())?;
    render(
        stage,
        &recipe,
        &canvas,
        output,
        Provenance::Atlas {
            atlas_sha256: digest,
        },
        |_, frame| canvas.extract(&atlas, frame),
    )
}

fn worker_recipe(stage: &Path) -> Result<Vec<u8>> {
    if !stage.is_absolute() {
        return Err("animation worker requires an absolute stage".into());
    }
    std::io::stdin().read_exact(&mut [0])?;
    read_recipe(&stage.join("recipe.json"))
}

pub(super) fn read_recipe(path: &Path) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    worker::open_input(path)?
        .take(MAX_RECIPE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_RECIPE_BYTES {
        return Err("animation recipe exceeds 64 KiB".into());
    }
    Ok(bytes)
}

fn render(
    stage: &Path,
    recipe: &Recipe,
    canvas: &Canvas,
    output: Output,
    provenance: Provenance,
    mut frame_image: impl FnMut(usize, &Frame) -> Result<RgbaImage>,
) -> Result<()> {
    if matches!(output, Output::Preview) {
        return preview_frames::render(stage, recipe, canvas, frame_image);
    }
    let root = stage.join("project");
    fs::create_dir(&root)?;
    fs::create_dir(root.join("frames"))?;
    let mut files = BTreeMap::new();
    for (index, frame) in recipe.frames.iter().enumerate() {
        let name = frame_path(index);
        let path = root.join(&name);
        let mut file = create_new(&path)?;
        frame_image(index, frame)?.write_to(&mut file, ImageFormat::Png)?;
        file.sync_all()?;
        drop(file);
        files.insert(name, snapshot::hash(&path)?);
    }
    let png = matches!(output, Output::PngSequence);
    if !png {
        for (name, contents) in godot::resources(recipe, canvas)? {
            if matches!(output, Output::Asset) && matches!(name, "project.godot" | "preview.tscn") {
                continue;
            }
            let path = root.join(name);
            write_new(&path, contents.as_bytes())?;
            files.insert(name.to_string(), snapshot::hash(&path)?);
        }
    }
    let manifest = Manifest {
        schema_version: match (png, &provenance) {
            (false, Provenance::Sequence { .. }) => 2,
            _ => 1,
        },
        engine: (!png).then_some(godot::VERSION),
        format: png.then_some(AnimationFormat::PngSequence),
        provenance,
        recipe,
        canvas,
        frame_files: png.then(|| (0..recipe.frames.len()).map(frame_path).collect()),
        file_sha256: files,
    };
    let mut bytes = serde_json::to_vec_pretty(&manifest)?;
    bytes.push(b'\n');
    write_new(&root.join("manifest.json"), &bytes)
}

pub(super) fn frame_path(index: usize) -> String {
    format!("frames/frame-{:03}.png", index + 1)
}

fn create_new(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().write(true).create_new(true).open(path)
}

pub(super) fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = create_new(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

#[cfg(test)]
#[path = "animation_tests.rs"]
mod tests;

//! Resolve an ordered sequence of whole catalog images in the image worker.
use super::{
    render, validate_frame_count, worker, worker_recipe, Canvas, Frame, Output, Provenance, Recipe,
    Result, MAX_CANVAS_EDGE, MAX_DURATION_MS, MAX_TOTAL_PIXELS,
};
use image::{ImageReader, RgbaImage};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{hash_map::Entry, HashMap, HashSet},
    io::Cursor,
    path::{Path, PathBuf},
};

pub(crate) const WORKER: &str = "--zicode-visual-assets-sequence-worker";
pub(crate) const MAX_SOURCE_BYTES: usize = 128 * 1024 * 1024;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) struct Revision {
    pub(crate) asset: i64,
    pub(crate) version: i64,
}

impl Revision {
    pub(crate) fn input(self, stage: &Path) -> PathBuf {
        stage.join(format!("frame-{}-{}.input", self.asset, self.version))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FrameSelection {
    asset_id: i64,
    revision: i64,
    duration_ms: u32,
    anchor_x: u32,
    anchor_y: u32,
}

impl FrameSelection {
    fn source(&self) -> Revision {
        Revision {
            asset: self.asset_id,
            version: self.revision,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Selection {
    looped: bool,
    frames: Vec<FrameSelection>,
}

impl Selection {
    pub(crate) fn parse(bytes: &[u8]) -> Result<Self> {
        let selection: Self = serde_json::from_slice(bytes)?;
        validate_frame_count(selection.frames.len())?;
        if selection.frames.iter().any(|frame| {
            frame.asset_id <= 0
                || frame.revision <= 0
                || !(1..=MAX_DURATION_MS).contains(&frame.duration_ms)
        }) {
            return Err("invalid frame revision or duration".into());
        }
        Ok(selection)
    }

    pub(crate) fn unique_sources(&self) -> impl Iterator<Item = Revision> + '_ {
        let mut seen = HashSet::new();
        self.frames
            .iter()
            .map(FrameSelection::source)
            .filter(move |source| seen.insert(*source))
    }
}

struct Original {
    digest: String,
    image: RgbaImage,
}

pub(super) fn run_worker(stage: &Path, output: Output) -> Result<()> {
    let selection = Selection::parse(&worker_recipe(stage)?)?;
    let mut originals = HashMap::new();
    let mut encoded_bytes = 0;
    let mut decoded_pixels = 0;
    let mut recipe = Recipe {
        looped: selection.looped,
        frames: Vec::with_capacity(selection.frames.len()),
    };
    let mut hashes = Vec::with_capacity(selection.frames.len());
    for frame in &selection.frames {
        let original = match originals.entry(frame.source()) {
            Entry::Occupied(entry) => entry.into_mut(),
            Entry::Vacant(entry) => {
                let bytes = worker::read_input(&frame.source().input(stage))?;
                encoded_bytes += bytes.len();
                if encoded_bytes > MAX_SOURCE_BYTES {
                    return Err("animation exceeds the encoded source budget".into());
                }
                let (width, height) = ImageReader::new(Cursor::new(bytes.as_slice()))
                    .with_guessed_format()?
                    .into_dimensions()?;
                if width > MAX_CANVAS_EDGE || height > MAX_CANVAS_EDGE {
                    return Err("a sequence frame exceeds the canvas edge limit".into());
                }
                decoded_pixels += u64::from(width) * u64::from(height);
                if decoded_pixels > MAX_TOTAL_PIXELS {
                    return Err("animation exceeds the decoded source pixel budget".into());
                }
                let image = worker::decode_static(&bytes)?.into_rgba8();
                if image.dimensions() != (width, height) {
                    return Err("sequence frame dimensions changed during decoding".into());
                }
                entry.insert(Original {
                    digest: format!("{:x}", Sha256::digest(&bytes)),
                    image,
                })
            }
        };
        hashes.push(original.digest.clone());
        recipe.frames.push(Frame {
            x: 0,
            y: 0,
            width: original.image.width(),
            height: original.image.height(),
            duration_ms: frame.duration_ms,
            anchor_x: frame.anchor_x,
            anchor_y: frame.anchor_y,
        });
    }
    let canvas = Canvas::layout(&recipe.frames)?;
    render(
        stage,
        &recipe,
        &canvas,
        output,
        Provenance::Sequence {
            frame_source_sha256: hashes,
        },
        |index, frame| {
            let original = originals
                .get(&selection.frames[index].source())
                .ok_or("missing staged animation frame")?;
            canvas.extract(&original.image, frame)
        },
    )
}

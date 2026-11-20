//! Encode a bounded playback preview from the same aligned canvases used for export.
use super::{worker, write_new, Canvas, Frame, Recipe, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops, ImageFormat, RgbaImage};
use serde::Serialize;
use serde_json::Value;
use std::{
    io::{Cursor, Read},
    path::Path,
};

const MAX_EDGE: u32 = 192;
const MAX_TOTAL_PIXELS: u64 = 512 * 1024;
const MAX_ENCODED_BYTES: usize = 3 * 1024 * 1024;
const MAX_JSON_BYTES: u64 = 4 * 1024 * 1024 + 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewFrame {
    duration_ms: u32,
    base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    width: u32,
    height: u32,
    looped: bool,
    frames: Vec<PreviewFrame>,
}

fn dimensions(canvas: &Canvas, count: usize) -> (u32, u32) {
    let area = f64::from(canvas.width) * f64::from(canvas.height);
    let area_scale = (MAX_TOTAL_PIXELS as f64 / count as f64 / area).sqrt();
    let edge_scale = f64::from(MAX_EDGE) / f64::from(canvas.width.max(canvas.height));
    let scale = 1.0_f64.min(area_scale).min(edge_scale);
    let scale_edge = |edge| ((f64::from(edge) * scale).floor() as u32).max(1);
    (scale_edge(canvas.width), scale_edge(canvas.height))
}

pub(super) fn render(
    stage: &Path,
    recipe: &Recipe,
    canvas: &Canvas,
    mut image: impl FnMut(usize, &Frame) -> Result<RgbaImage>,
) -> Result<()> {
    let (width, height) = dimensions(canvas, recipe.frames.len());
    let mut frames = Vec::with_capacity(recipe.frames.len());
    let mut encoded_bytes = 0;
    for (index, frame) in recipe.frames.iter().enumerate() {
        let frame_image = image(index, frame)?;
        let frame_image = if frame_image.dimensions() == (width, height) {
            frame_image
        } else {
            imageops::resize(&frame_image, width, height, imageops::FilterType::Nearest)
        };
        let mut png = Cursor::new(Vec::new());
        frame_image.write_to(&mut png, ImageFormat::Png)?;
        let png = png.into_inner();
        encoded_bytes += png.len();
        if encoded_bytes > MAX_ENCODED_BYTES {
            return Err("animation preview exceeds its encoded size limit".into());
        }
        frames.push(PreviewFrame {
            duration_ms: frame.duration_ms,
            base64: STANDARD.encode(png),
        });
    }
    let payload = serde_json::to_vec(&Preview {
        width,
        height,
        looped: recipe.looped,
        frames,
    })?;
    write_new(&stage.join("preview.json"), &payload)
}

pub(crate) fn read_preview(stage: &Path) -> Result<Value> {
    let mut bytes = Vec::new();
    worker::open_input(&stage.join("preview.json"))?
        .take(MAX_JSON_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_JSON_BYTES {
        return Err("animation preview response exceeds its limit".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

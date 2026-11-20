use super::{Canvas, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops, ImageFormat, ImageReader, RgbaImage};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Caption {
    text: String,
    position: Position,
    size: Size,
    raster_png: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Position {
    Top,
    Center,
    Bottom,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Size {
    Small,
    Medium,
    Large,
}

pub(super) struct Overlay {
    image: RgbaImage,
    x: i64,
    y: i64,
}

impl Overlay {
    pub(super) fn apply(&self, image: &mut RgbaImage) {
        imageops::overlay(image, &self.image, self.x, self.y);
    }
}

impl Caption {
    pub(super) fn validate(&self) -> Result<()> {
        if self.text.trim().is_empty()
            || self.text.chars().count() > 120
            || self.text.split('\n').count() > 3
            || self.raster_png.is_empty()
            || self.raster_png.len() > 48 * 1024
        {
            return Err("caption exceeds text or image limits".into());
        }
        Ok(())
    }
    pub(super) fn prepare(&self, canvas: &Canvas) -> Result<Overlay> {
        self.validate()?;
        let bytes = STANDARD.decode(&self.raster_png)?;
        let (w, h) =
            ImageReader::with_format(Cursor::new(&bytes), ImageFormat::Png).into_dimensions()?;
        if !(1..=1024).contains(&w) || !(1..=256).contains(&h) {
            return Err("caption bitmap exceeds its dimensions".into());
        }
        let original = image::load_from_memory_with_format(&bytes, ImageFormat::Png)?.to_rgba8();
        let margin = (canvas.width.min(canvas.height) / 32).min(32);
        let max_w = (canvas.width - 2 * margin).max(1);
        let line_count = self.text.split('\n').count() as u32;
        let divisor = match self.size {
            Size::Small => 12,
            Size::Medium => 8,
            Size::Large => 5,
        };
        let max_h = (canvas.height * line_count / divisor)
            .max(1)
            .min(canvas.height - 2 * margin);
        let scale = (f64::from(max_w) / f64::from(w)).min(f64::from(max_h) / f64::from(h));
        let width = ((f64::from(w) * scale).round() as u32).clamp(1, max_w);
        let height = ((f64::from(h) * scale).round() as u32).clamp(1, max_h);
        let image = imageops::resize(&original, width, height, imageops::FilterType::Triangle);
        let x = (canvas.width - width) / 2;
        let y = match self.position {
            Position::Top => margin,
            Position::Center => (canvas.height - height) / 2,
            Position::Bottom => canvas.height - height - margin,
        };
        Ok(Overlay {
            image,
            x: i64::from(x),
            y: i64::from(y),
        })
    }
}

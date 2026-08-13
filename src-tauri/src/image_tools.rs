//! 图片工具箱：缩放、格式/质量转换、翻转、旋转、多图拼接。

use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResizeSpec {
    pub width: Option<u32>,
    pub height: Option<u32>,
    /// contain | cover | stretch
    #[serde(default = "default_fit")]
    pub fit: String,
}

fn default_fit() -> String {
    "contain".to_string()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProcessRequest {
    pub image: String,
    pub resize: Option<ResizeSpec>,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub quality: Option<u8>,
    #[serde(default)]
    pub rotate: Option<u32>,
    #[serde(default)]
    pub flip: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageConcatRequest {
    pub images: Vec<String>,
    #[serde(default = "default_columns")]
    pub columns: u32,
    #[serde(default)]
    pub gap: u32,
    /// 背景色（十六进制 #RRGGBB，默认白色）
    #[serde(default)]
    pub background: Option<String>,
}

fn default_columns() -> u32 {
    2
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageToolResult {
    pub ok: bool,
    pub file_name: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub bytes: usize,
}

fn decode_image(input: &str, workspace_root: &Path) -> Result<DynamicImage, String> {
    if let Some(payload) = input.strip_prefix("data:") {
        let body = payload
            .split_once(',')
            .map(|(_, body)| body)
            .ok_or_else(|| "Invalid data URL".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|error| format!("Invalid base64 image: {error}"))?;
        return image::load_from_memory(&bytes)
            .map_err(|error| format!("Cannot decode image: {error}"));
    }
    let path = if Path::new(input).is_absolute() {
        PathBuf::from(input)
    } else {
        workspace_root.join(input)
    };
    image::open(&path).map_err(|error| format!("Cannot open image {}: {error}", path.display()))
}

fn output_format(request_format: &Option<String>) -> (ImageFormat, String) {
    match request_format.as_deref().unwrap_or("") {
        "jpeg" | "jpg" => (ImageFormat::Jpeg, "jpg".to_string()),
        "webp" => (ImageFormat::WebP, "webp".to_string()),
        _ => (ImageFormat::Png, "png".to_string()),
    }
}

fn resize_image(img: &DynamicImage, spec: &ResizeSpec) -> DynamicImage {
    let (src_w, src_h) = (img.width(), img.height());
    let width = spec.width;
    let height = spec.height;
    let (target_w, target_h) = match (width, height) {
        (Some(w), Some(h)) => {
            if spec.fit == "stretch" {
                (w, h)
            } else if spec.fit == "cover" {
                let scale = (w as f64 / src_w as f64).max(h as f64 / src_h as f64);
                (
                    (src_w as f64 * scale).round().max(1.0) as u32,
                    (src_h as f64 * scale).round().max(1.0) as u32,
                )
            } else {
                // contain
                let scale = (w as f64 / src_w as f64).min(h as f64 / src_h as f64);
                (
                    (src_w as f64 * scale).round().max(1.0) as u32,
                    (src_h as f64 * scale).round().max(1.0) as u32,
                )
            }
        }
        (Some(w), None) => {
            let scale = w as f64 / src_w as f64;
            (w, (src_h as f64 * scale).round().max(1.0) as u32)
        }
        (None, Some(h)) => {
            let scale = h as f64 / src_h as f64;
            ((src_w as f64 * scale).round().max(1.0) as u32, h)
        }
        (None, None) => (src_w, src_h),
    };
    img.resize_exact(target_w, target_h, FilterType::Lanczos3)
}

fn apply_flip(img: DynamicImage, flip: &str) -> DynamicImage {
    match flip {
        "horizontal" => img.fliph(),
        "vertical" => img.flipv(),
        "both" => img.fliph().flipv(),
        _ => img,
    }
}

fn apply_rotate(img: DynamicImage, degrees: u32) -> DynamicImage {
    match degrees % 360 {
        90 => img.rotate90(),
        180 => img.rotate180(),
        270 => img.rotate270(),
        _ => img,
    }
}

fn save_output(
    img: &DynamicImage,
    workspace_root: &Path,
    workspace_id: &str,
    format: ImageFormat,
    quality: Option<u8>,
    ext: &str,
) -> Result<ImageToolResult, String> {
    let output_dir = workspace_root.join(".zicode").join("imagetools");
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Cannot create image output directory: {error}"))?;
    let file_name = format!("image-{}.{ext}", Uuid::new_v4().simple());
    let output_path = output_dir.join(&file_name);
    let mut bytes: Vec<u8> = Vec::new();
    if format == ImageFormat::Jpeg {
        let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(
            &mut bytes,
            quality.unwrap_or(85).clamp(1, 100),
        );
        img.write_with_encoder(encoder)
            .map_err(|error| format!("Cannot encode image: {error}"))?;
    } else {
        img.write_to(&mut std::io::Cursor::new(&mut bytes), format)
            .map_err(|error| format!("Cannot encode image: {error}"))?;
    }
    std::fs::write(&output_path, &bytes).map_err(|error| format!("Cannot save image: {error}"))?;
    let bytes = std::fs::metadata(&output_path)
        .map(|meta| meta.len())
        .unwrap_or(0) as usize;
    let url = format!("/v2/imagetools/file?workspaceId={workspace_id}&file={file_name}");
    Ok(ImageToolResult {
        ok: true,
        file_name,
        url,
        width: img.width(),
        height: img.height(),
        format: ext.to_string(),
        bytes,
    })
}

pub fn process(
    request: &ImageProcessRequest,
    workspace_root: &Path,
    workspace_id: &str,
) -> Result<ImageToolResult, String> {
    let mut img = decode_image(&request.image, workspace_root)?;
    if let Some(spec) = &request.resize {
        img = resize_image(&img, spec);
    }
    if let Some(degrees) = request.rotate {
        img = apply_rotate(img, degrees);
    }
    if let Some(flip) = &request.flip {
        img = apply_flip(img, flip);
    }
    let (format, ext) = output_format(&request.format);
    save_output(
        &img,
        workspace_root,
        workspace_id,
        format,
        request.quality,
        &ext,
    )
}

fn parse_hex_color(value: Option<&str>) -> [u8; 4] {
    let value = value.and_then(|v| v.strip_prefix('#')).unwrap_or("ffffff");
    let parsed = u32::from_str_radix(value, 16).unwrap_or(0xffffff);
    [
        ((parsed >> 16) & 0xff) as u8,
        ((parsed >> 8) & 0xff) as u8,
        (parsed & 0xff) as u8,
        255,
    ]
}

pub fn concat(
    request: &ImageConcatRequest,
    workspace_root: &Path,
    workspace_id: &str,
) -> Result<ImageToolResult, String> {
    if request.images.is_empty() {
        return Err("At least one image is required".to_string());
    }
    let images: Vec<DynamicImage> = request
        .images
        .iter()
        .map(|image| decode_image(image, workspace_root))
        .collect::<Result<_, _>>()?;
    let columns = request.columns.max(1) as usize;
    let rows = images.len().div_ceil(columns);
    let cell_w = images.iter().map(|img| img.width()).max().unwrap_or(1);
    let cell_h = images.iter().map(|img| img.height()).max().unwrap_or(1);
    let gap = request.gap;
    let sheet_w = columns as u32 * cell_w + (columns.saturating_sub(1)) as u32 * gap;
    let sheet_h = rows as u32 * cell_h + (rows.saturating_sub(1)) as u32 * gap;
    let bg = parse_hex_color(request.background.as_deref());
    let mut sheet: RgbaImage = ImageBuffer::from_pixel(sheet_w, sheet_h, Rgba(bg));
    for (index, image) in images.iter().enumerate() {
        let col = (index % columns) as u32;
        let row = (index / columns) as u32;
        let x = col * (cell_w + gap) + (cell_w - image.width()) / 2;
        let y = row * (cell_h + gap) + (cell_h - image.height()) / 2;
        image::imageops::overlay(&mut sheet, &image.to_rgba8(), x as i64, y as i64);
    }
    save_output(
        &DynamicImage::ImageRgba8(sheet),
        workspace_root,
        workspace_id,
        ImageFormat::Png,
        None,
        "png",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data_url(img: &DynamicImage) -> String {
        let mut bytes = std::io::Cursor::new(Vec::new());
        img.write_to(&mut bytes, ImageFormat::Png).unwrap();
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
        )
    }

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("imagetools-test-{}", Uuid::new_v4().simple()))
    }

    #[test]
    fn resize_fits_contain() {
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(400, 200, Rgba([0, 0, 0, 255])));
        let out = resize_image(
            &img,
            &ResizeSpec {
                width: Some(200),
                height: Some(200),
                fit: "contain".into(),
            },
        );
        assert_eq!((out.width(), out.height()), (200, 100));
    }

    #[test]
    fn rotate_and_flip_apply() {
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 3, Rgba([0, 0, 0, 255])));
        let rotated = apply_rotate(img.clone(), 90);
        assert_eq!((rotated.width(), rotated.height()), (3, 2));
        let flipped = apply_flip(img, "horizontal");
        assert_eq!((flipped.width(), flipped.height()), (2, 3));
    }

    #[test]
    fn concat_grids_images() {
        let root = tmp_root();
        std::fs::create_dir_all(&root).unwrap();
        let a = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(10, 10, Rgba([255, 0, 0, 255])));
        let b = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(10, 10, Rgba([0, 255, 0, 255])));
        let request = ImageConcatRequest {
            images: vec![data_url(&a), data_url(&b)],
            columns: 2,
            gap: 0,
            background: None,
        };
        let result = concat(&request, &root, "ws-test").unwrap();
        assert_eq!((result.width, result.height), (20, 10));
        std::fs::remove_dir_all(&root).ok();
    }
}

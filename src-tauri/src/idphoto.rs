//! 证件照排版引擎 (ID photo layout engine).
//!
//! 输入一张照片（data URL 或文件路径），按证件照模板（一寸/二寸/签证等）
//! 裁剪、可选替换底色，并排版到打印纸（5寸/6寸/A4）输出 300 DPI PNG。
//! 前端工作台与 Pi 工具共用同一套引擎。

use base64::Engine;
use image::imageops::FilterType;
use image::{DynamicImage, ImageBuffer, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub const DPI: f64 = 300.0;
pub const MM_PER_INCH: f64 = 25.4;

const SHEET_MARGIN_MM: f64 = 5.0;
const GAP_MM: f64 = 2.0;
const MAX_GRID: u32 = 30;

/// 证件照模板：(id, 中文名, 宽mm, 高mm)
pub const TEMPLATES: &[(&str, &str, f64, f64)] = &[
    ("one_inch", "一寸", 25.0, 35.0),
    ("small_one_inch", "小一寸", 22.0, 32.0),
    ("large_one_inch", "大一寸", 33.0, 48.0),
    ("two_inch", "二寸", 35.0, 49.0),
    ("small_two_inch", "小二寸", 35.0, 45.0),
    ("visa", "签证照", 33.0, 48.0),
    ("passport", "护照", 33.0, 48.0),
    ("driving", "驾照", 22.0, 32.0),
    ("us_visa", "美签", 51.0, 51.0),
];

/// 打印纸：(id, 中文名, 宽mm, 高mm)
pub const SHEETS: &[(&str, &str, f64, f64)] = &[
    ("5inch", "5寸", 89.0, 127.0),
    ("6inch", "6寸", 102.0, 152.0),
    ("a4", "A4", 210.0, 297.0),
];

fn template(id: &str) -> Option<(&'static str, &'static str, f64, f64)> {
    TEMPLATES
        .iter()
        .find(|(template_id, _, _, _)| *template_id == id)
        .copied()
}

fn sheet(id: &str) -> Option<(&'static str, &'static str, f64, f64)> {
    SHEETS
        .iter()
        .find(|(sheet_id, _, _, _)| *sheet_id == id)
        .copied()
}

fn default_tolerance() -> u8 {
    48
}

fn default_border_px() -> u32 {
    2
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    /// 0..1 归一化坐标
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdPhotoRequest {
    /// data URL（`data:image/...;base64,...`）或文件路径（绝对路径，
    /// 或相对工作区根目录的路径）
    pub image: String,
    pub template: String,
    pub sheet: String,
    /// keep | white | red | blue | lightblue
    #[serde(default = "default_background")]
    pub background: String,
    /// 底色替换容差（0-255，默认 48）
    #[serde(default = "default_tolerance")]
    pub tolerance: u8,
    /// 归一化裁剪矩形（可选；缺省按模板比例自动裁剪，头部偏上）
    #[serde(default)]
    pub crop: Option<CropRect>,
    /// 可选列数/行数（缺省自动按纸张计算最大网格）
    #[serde(default)]
    pub cols: Option<u32>,
    #[serde(default)]
    pub rows: Option<u32>,
    /// 每张照片四周的白色描边（像素）
    #[serde(default = "default_border_px")]
    pub border_px: u32,
}

fn default_background() -> String {
    "keep".to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdPhotoResult {
    pub ok: bool,
    pub file_name: String,
    /// 相对 URL，浏览器直接可加载
    pub url: String,
    pub template: String,
    pub template_name: String,
    pub sheet: String,
    pub sheet_name: String,
    pub cols: u32,
    pub rows: u32,
    pub count: u32,
    pub width_px: u32,
    pub height_px: u32,
    pub width_mm: f64,
    pub height_mm: f64,
}

pub fn mm_to_px(mm: f64) -> u32 {
    ((mm / MM_PER_INCH) * DPI).round().max(1.0) as u32
}

fn background_rgb(name: &str) -> Option<[u8; 3]> {
    match name {
        "white" => Some([255, 255, 255]),
        "red" => Some([237, 28, 36]),
        "blue" => Some([0, 90, 200]),
        "lightblue" => Some([120, 190, 240]),
        _ => None,
    }
}

/// 解码输入：data URL 或文件路径。
fn decode_image(input: &str, workspace_root: &Path) -> Result<DynamicImage, String> {
    if let Some(payload) = input.strip_prefix("data:") {
        let base64_part = payload
            .split_once(',')
            .map(|(_, body)| body)
            .ok_or_else(|| "Invalid data URL".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(base64_part)
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

/// 边缘洪水填充替换底色：把与边框主色相近的连通背景区域替换为目标色。
fn replace_background(img: &RgbaImage, target: [u8; 3], tolerance: u8) -> RgbaImage {
    let (width, height) = (img.width(), img.height());
    if width == 0 || height == 0 {
        return img.clone();
    }
    // 统计边框像素的平均色作为背景色。
    let mut sum: [u64; 3] = [0, 0, 0];
    let mut count: u64 = 0;
    let mut consider = |x: u32, y: u32| {
        let p = img.get_pixel(x, y);
        sum[0] += p[0] as u64;
        sum[1] += p[1] as u64;
        sum[2] += p[2] as u64;
        count += 1;
    };
    for x in 0..width {
        consider(x, 0);
        consider(x, height - 1);
    }
    for y in 0..height {
        consider(0, y);
        consider(width - 1, y);
    }
    let bg: [u8; 3] = if count == 0 {
        target
    } else {
        [
            (sum[0] / count) as u8,
            (sum[1] / count) as u8,
            (sum[2] / count) as u8,
        ]
    };
    let tolerance_sq = (tolerance as u64) * (tolerance as u64) * 3;
    let color_dist_sq = |p: &Rgba<u8>| -> u64 {
        let dr = p[0] as i64 - bg[0] as i64;
        let dg = p[1] as i64 - bg[1] as i64;
        let db = p[2] as i64 - bg[2] as i64;
        (dr * dr + dg * dg + db * db) as u64
    };

    let mut out = img.clone();
    let mut visited = vec![false; (width as usize) * (height as usize)];
    let mut queue: VecDeque<(u32, u32)> = VecDeque::new();
    let idx = |x: u32, y: u32| (y as usize) * (width as usize) + x as usize;
    let push = |queue: &mut VecDeque<(u32, u32)>, visited: &mut Vec<bool>, x: u32, y: u32| {
        let i = idx(x, y);
        if !visited[i] {
            visited[i] = true;
            queue.push_back((x, y));
        }
    };
    for x in 0..width {
        push(&mut queue, &mut visited, x, 0);
        push(&mut queue, &mut visited, x, height - 1);
    }
    for y in 0..height {
        push(&mut queue, &mut visited, 0, y);
        push(&mut queue, &mut visited, width - 1, y);
    }
    while let Some((x, y)) = queue.pop_front() {
        let pixel = img.get_pixel(x, y);
        if color_dist_sq(pixel) > tolerance_sq {
            continue;
        }
        out.put_pixel(x, y, Rgba([target[0], target[1], target[2], 255]));
        if x > 0 {
            push(&mut queue, &mut visited, x - 1, y);
        }
        if x + 1 < width {
            push(&mut queue, &mut visited, x + 1, y);
        }
        if y > 0 {
            push(&mut queue, &mut visited, x, y - 1);
        }
        if y + 1 < height {
            push(&mut queue, &mut visited, x, y + 1);
        }
    }
    out
}

/// 按模板比例裁剪（可传入归一化矩形；缺省自动居中、头部偏上）。
fn crop_to_aspect(img: &DynamicImage, aspect: f64, crop: Option<&CropRect>) -> DynamicImage {
    let (src_w, src_h) = (img.width() as f64, img.height() as f64);
    let (crop_x, crop_y, crop_w, crop_h) = match crop {
        Some(rect) => {
            let w = (rect.w.clamp(0.01, 1.0) * src_w).round().max(1.0);
            let h = (rect.h.clamp(0.01, 1.0) * src_h).round().max(1.0);
            let x = (rect.x.clamp(0.0, 1.0 - rect.w.min(1.0)) * src_w).round();
            let y = (rect.y.clamp(0.0, 1.0 - rect.h.min(1.0)) * src_h).round();
            (x, y, w, h)
        }
        None => {
            if src_w / src_h > aspect {
                // 源图更宽：按宽度裁剪
                let crop_w = (src_h * aspect).min(src_w);
                let x = ((src_w - crop_w) / 2.0).round();
                (x, 0.0, crop_w, src_h)
            } else {
                // 源图更高：按高度裁剪，头部偏上（顶部留 12% 空间）
                let crop_h = (src_w / aspect).min(src_h);
                let y = ((src_h - crop_h) * 0.12).round();
                (0.0, y, src_w, crop_h)
            }
        }
    };
    let (x, y, w, h) = (crop_x as u32, crop_y as u32, crop_w as u32, crop_h as u32);
    let x = x.min(src_w as u32 - 1);
    let y = y.min(src_h as u32 - 1);
    let w = w.min(src_w as u32 - x);
    let h = h.min(src_h as u32 - y);
    img.crop_imm(x, y, w.max(1), h.max(1))
}

fn compute_grid(
    template_mm: (f64, f64),
    sheet_mm: (f64, f64),
    cols: Option<u32>,
    rows: Option<u32>,
) -> (u32, u32) {
    if let (Some(cols), Some(rows)) = (cols, rows) {
        return (cols.max(1), rows.max(1));
    }
    let (tw, th) = template_mm;
    let (sw, sh) = sheet_mm;
    let usable_w = (sw - 2.0 * SHEET_MARGIN_MM).max(1.0);
    let usable_h = (sh - 2.0 * SHEET_MARGIN_MM).max(1.0);
    let cols = ((usable_w + GAP_MM) / (tw + GAP_MM)).floor().max(1.0) as u32;
    let rows = ((usable_h + GAP_MM) / (th + GAP_MM)).floor().max(1.0) as u32;
    // 限制总张数，避免极端排版
    if cols * rows > MAX_GRID {
        let ratio = (MAX_GRID as f64 / (cols * rows) as f64).sqrt();
        return (
            ((cols as f64) * ratio).floor().max(1.0) as u32,
            ((rows as f64) * ratio).floor().max(1.0) as u32,
        );
    }
    (cols, rows)
}

fn sheet_pixel_size(sheet_mm: (f64, f64)) -> (u32, u32) {
    (mm_to_px(sheet_mm.0), mm_to_px(sheet_mm.1))
}

/// 执行证件照排版，输出 PNG 到工作区 `.zicode/idphoto/`。
pub fn layout(
    request: &IdPhotoRequest,
    workspace_root: &Path,
    workspace_id: &str,
) -> Result<IdPhotoResult, String> {
    let (template_id, template_name, template_w_mm, template_h_mm) = template(&request.template)
        .ok_or_else(|| format!("Unknown template: {}", request.template))?;
    let (sheet_id, sheet_name, sheet_w_mm, sheet_h_mm) =
        sheet(&request.sheet).ok_or_else(|| format!("Unknown sheet: {}", request.sheet))?;

    let source = decode_image(&request.image, workspace_root)?;
    let aspect = template_w_mm / template_h_mm;
    let cropped = crop_to_aspect(&source, aspect, request.crop.as_ref());
    let target_px = (mm_to_px(template_w_mm), mm_to_px(template_h_mm));
    let resized = cropped.resize(target_px.0, target_px.1, FilterType::CatmullRom);
    let rgb = resized.to_rgba8();

    let photo = match background_rgb(&request.background) {
        Some(target) => replace_background(&rgb, target, request.tolerance),
        None => rgb,
    };

    let (cols, rows) = compute_grid(
        (template_w_mm, template_h_mm),
        (sheet_w_mm, sheet_h_mm),
        request.cols,
        request.rows,
    );
    let (sheet_w_px, sheet_h_px) = sheet_pixel_size((sheet_w_mm, sheet_h_mm));
    let margin_px = mm_to_px(SHEET_MARGIN_MM);
    let gap_px = mm_to_px(GAP_MM);
    let border = request.border_px;
    let photo_w = target_px.0 + border * 2;
    let photo_h = target_px.1 + border * 2;

    let mut sheet: RgbaImage =
        ImageBuffer::from_pixel(sheet_w_px, sheet_h_px, Rgba([255, 255, 255, 255]));
    for row in 0..rows {
        for col in 0..cols {
            let x = margin_px as i64 + col as i64 * (photo_w as i64 + gap_px as i64);
            let y = margin_px as i64 + row as i64 * (photo_h as i64 + gap_px as i64);
            if x + photo_w as i64 > sheet_w_px as i64 || y + photo_h as i64 > sheet_h_px as i64 {
                continue;
            }
            image::imageops::overlay(
                &mut sheet,
                &photo,
                x as i64 + border as i64,
                y as i64 + border as i64,
            );
        }
    }

    let output_dir = workspace_root.join(".zicode").join("idphoto");
    std::fs::create_dir_all(&output_dir)
        .map_err(|error| format!("Cannot create idphoto output directory: {error}"))?;
    let file_name = format!("idphoto-{}.png", Uuid::new_v4().simple());
    let output_path = output_dir.join(&file_name);
    sheet
        .save(&output_path)
        .map_err(|error| format!("Cannot save idphoto sheet: {error}"))?;
    let url = format!("/v2/idphoto/file?workspaceId={workspace_id}&file={file_name}");

    Ok(IdPhotoResult {
        ok: true,
        file_name,
        url,
        template: template_id.to_string(),
        template_name: template_name.to_string(),
        sheet: sheet_id.to_string(),
        sheet_name: sheet_name.to_string(),
        cols,
        rows,
        count: cols * rows,
        width_px: sheet_w_px,
        height_px: sheet_h_px,
        width_mm: sheet_w_mm,
        height_mm: sheet_h_mm,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn template_lookup_matches_known_sizes() {
        let (_, name, w, h) = template("one_inch").unwrap();
        assert_eq!(name, "一寸");
        assert!((w - 25.0).abs() < 1e-9);
        assert!((h - 35.0).abs() < 1e-9);
        assert!(template("missing").is_none());
    }

    #[test]
    fn pixel_conversion_is_300_dpi() {
        assert_eq!(mm_to_px(25.4), 300);
        assert_eq!(mm_to_px(25.0), 295);
        assert_eq!(mm_to_px(35.0), 413);
        assert_eq!(mm_to_px(102.0), 1205);
        assert_eq!(mm_to_px(152.0), 1795);
    }

    #[test]
    fn grid_fits_within_sheet() {
        // 一寸 25x35mm 排到 6寸 102x152mm（5mm 边距 + 2mm 间距）：3 x 3 = 9
        let (cols, rows) = compute_grid((25.0, 35.0), (102.0, 152.0), None, None);
        assert_eq!((cols, rows), (3, 3));
        assert_eq!(cols * rows, 9);
        // 二寸 35x49mm 排到 6寸：2 x 2 = 4
        let (cols2, rows2) = compute_grid((35.0, 49.0), (102.0, 152.0), None, None);
        assert_eq!((cols2, rows2), (2, 2));
        // 一寸排到 5寸 89x127mm：3 x 3 = 9
        let (cols3, rows3) = compute_grid((25.0, 35.0), (89.0, 127.0), None, None);
        assert_eq!((cols3, rows3), (3, 3));
    }

    #[test]
    fn manual_grid_is_respected() {
        let (cols, rows) = compute_grid((25.0, 35.0), (102.0, 152.0), Some(4), Some(2));
        assert_eq!((cols, rows), (4, 2));
    }

    #[test]
    fn background_replace_fills_uniform_backdrop() {
        let mut img = RgbaImage::from_pixel(60, 80, Rgba([10, 10, 10, 255]));
        // 中间画一个主体块（远离边缘）
        for y in 20..60 {
            for x in 20..40 {
                img.put_pixel(x, y, Rgba([200, 200, 200, 255]));
            }
        }
        let out = replace_background(&img, [255, 0, 0], 40);
        assert_eq!(out.get_pixel(5, 5), &Rgba([255, 0, 0, 255]));
        assert_eq!(out.get_pixel(59, 79), &Rgba([255, 0, 0, 255]));
        // 主体保留
        assert_eq!(out.get_pixel(30, 40), &Rgba([200, 200, 200, 255]));
    }

    #[test]
    fn crop_to_aspect_keeps_ratio() {
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(600, 800, Rgba([0, 0, 0, 255])));
        let out = crop_to_aspect(&img, 25.0 / 35.0, None);
        let (w, h) = (out.width(), out.height());
        assert!((w as f64 / h as f64 - 25.0 / 35.0).abs() < 0.01);
        // 源图更宽：宽度被裁到比例，高度不变
        assert_eq!(h, 800);
        assert!(w < 600);
    }

    #[test]
    fn end_to_end_layout_writes_png() {
        let tmp = std::env::temp_dir().join(format!("idphoto-test-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&tmp).unwrap();
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            300,
            420,
            Rgba([240, 240, 240, 255]),
        ));
        let data_url = {
            let mut bytes = std::io::Cursor::new(Vec::new());
            img.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes.into_inner());
            format!("data:image/png;base64,{b64}")
        };
        let request = IdPhotoRequest {
            image: data_url,
            template: "one_inch".into(),
            sheet: "6inch".into(),
            background: "white".into(),
            tolerance: 48,
            crop: None,
            cols: None,
            rows: None,
            border_px: 2,
        };
        let result = layout(&request, &tmp, "ws-test").unwrap();
        assert_eq!(result.cols, 3);
        assert_eq!(result.rows, 3);
        let path = tmp.join(".zicode").join("idphoto").join(&result.file_name);
        assert!(path.exists());
        let decoded = image::open(&path).unwrap();
        assert_eq!(decoded.width(), mm_to_px(102.0));
        assert_eq!(decoded.height(), mm_to_px(152.0));
        std::fs::remove_dir_all(&tmp).ok();
    }
}

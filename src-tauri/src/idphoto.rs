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

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IdPhotoSlot {
    pub template: String,
    /// 该模板要排的张数
    pub count: u32,
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
    /// 混合排版：一张纸排多种模板（优先于单模板 grid 计算）
    #[serde(default)]
    pub slots: Option<Vec<IdPhotoSlot>>,
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
    /// 是否为混合排版
    #[serde(default)]
    pub mixed: bool,
    /// 混合排版时各模板的张数汇总
    #[serde(default)]
    pub slots: Vec<SlotResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotResult {
    pub template: String,
    pub template_name: String,
    pub count: u32,
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

/// 从源图裁剪到模板比例、缩放到 300DPI、可选替换底色，返回 RGBA 照片。
fn make_photo(
    source: &DynamicImage,
    template_mm: (f64, f64),
    crop: Option<&CropRect>,
    background: &str,
    tolerance: u8,
) -> RgbaImage {
    let aspect = template_mm.0 / template_mm.1;
    let cropped = crop_to_aspect(source, aspect, crop);
    let target_px = (mm_to_px(template_mm.0), mm_to_px(template_mm.1));
    let resized = cropped
        .resize(target_px.0, target_px.1, FilterType::CatmullRom)
        .to_rgba8();
    match background_rgb(background) {
        Some(target) => replace_background(&resized, target, tolerance),
        None => resized,
    }
}

/// 把照片按“先左对齐换行、再整体居中”排进纸张，返回实际排入张数。
fn pack_items(
    sheet: &mut RgbaImage,
    items: Vec<RgbaImage>,
    border: u32,
    margin_px: u32,
    gap_px: u32,
) -> usize {
    let sheet_w = sheet.width() as i64;
    let sheet_h = sheet.height() as i64;
    let margin = margin_px as i64;
    let gap = gap_px as i64;
    let border = border as i64;
    let usable_w = sheet_w - margin * 2;
    let usable_h = sheet_h - margin * 2;

    // 先干跑：按行分组并计算每行高度。
    let mut rows: Vec<(i64, usize)> = Vec::new();
    let mut cur_w = 0i64;
    let mut cur_h = 0i64;
    let mut cur_len = 0usize;
    let flush =
        |rows: &mut Vec<(i64, usize)>, cur_h: &mut i64, cur_w: &mut i64, cur_len: &mut usize| {
            if *cur_len > 0 {
                rows.push((*cur_h, *cur_len));
                *cur_h = 0;
                *cur_w = 0;
                *cur_len = 0;
            }
        };
    for photo in &items {
        let pw = photo.width() as i64 + border * 2;
        let ph = photo.height() as i64 + border * 2;
        if cur_len > 0 && cur_w + gap + pw > usable_w {
            flush(&mut rows, &mut cur_h, &mut cur_w, &mut cur_len);
        }
        cur_w += pw + if cur_len > 0 { gap } else { 0 };
        cur_h = cur_h.max(ph);
        cur_len += 1;
    }
    flush(&mut rows, &mut cur_h, &mut cur_w, &mut cur_len);

    let block_h =
        rows.iter().map(|(h, _)| *h).sum::<i64>() + (rows.len().saturating_sub(1) as i64) * gap;
    let start_y = (margin + (usable_h - block_h) / 2).max(margin);

    let mut placed = 0usize;
    let mut item_iter = items.iter();
    let mut y = start_y;
    for (row_h, row_len) in &rows {
        let row_w: i64 = items
            .iter()
            .skip(placed)
            .take(*row_len)
            .map(|p| p.width() as i64 + border * 2)
            .sum::<i64>()
            + (*row_len as i64 - 1) * gap;
        let mut x = (margin + (usable_w - row_w) / 2).max(margin);
        for _ in 0..*row_len {
            let Some(photo) = item_iter.next() else {
                break;
            };
            let pw = photo.width() as i64 + border * 2;
            let ph = photo.height() as i64 + border * 2;
            if x + pw <= sheet_w - margin && y + ph <= sheet_h - margin {
                image::imageops::overlay(sheet, photo, x + border, y + border);
                placed += 1;
            }
            x += pw + gap;
        }
        y += row_h + gap;
    }
    placed
}

/// 执行证件照排版，输出 PNG 到工作区 `.zicode/idphoto/`。
pub fn layout(
    request: &IdPhotoRequest,
    workspace_root: &Path,
    workspace_id: &str,
) -> Result<IdPhotoResult, String> {
    let (sheet_id, sheet_name, sheet_w_mm, sheet_h_mm) =
        sheet(&request.sheet).ok_or_else(|| format!("Unknown sheet: {}", request.sheet))?;

    let source = decode_image(&request.image, workspace_root)?;
    let (sheet_w_px, sheet_h_px) = sheet_pixel_size((sheet_w_mm, sheet_h_mm));
    let margin_px = mm_to_px(SHEET_MARGIN_MM);
    let gap_px = mm_to_px(GAP_MM);
    let border = request.border_px;

    let mut sheet: RgbaImage =
        ImageBuffer::from_pixel(sheet_w_px, sheet_h_px, Rgba([255, 255, 255, 255]));

    let (cols, rows, count, mixed, slot_results, result_template, result_template_name) =
        if let Some(slots) = request.slots.as_ref().filter(|slots| !slots.is_empty()) {
            let mut items: Vec<RgbaImage> = Vec::new();
            let mut slot_results = Vec::new();
            for slot in slots {
                let (template_id, template_name, template_w_mm, template_h_mm) =
                    template(&slot.template)
                        .ok_or_else(|| format!("Unknown template: {}", slot.template))?;
                let photo = make_photo(
                    &source,
                    (template_w_mm, template_h_mm),
                    None,
                    &request.background,
                    request.tolerance,
                );
                slot_results.push(SlotResult {
                    template: template_id.to_string(),
                    template_name: template_name.to_string(),
                    count: slot.count.max(1),
                });
                for _ in 0..slot.count.max(1) {
                    items.push(photo.clone());
                }
            }
            let placed = pack_items(&mut sheet, items, border, margin_px, gap_px);
            (
                0,
                0,
                placed as u32,
                true,
                slot_results,
                String::new(),
                String::new(),
            )
        } else {
            let (template_id, template_name, template_w_mm, template_h_mm) =
                template(&request.template)
                    .ok_or_else(|| format!("Unknown template: {}", request.template))?;
            let photo = make_photo(
                &source,
                (template_w_mm, template_h_mm),
                request.crop.as_ref(),
                &request.background,
                request.tolerance,
            );
            let (cols, rows) = compute_grid(
                (template_w_mm, template_h_mm),
                (sheet_w_mm, sheet_h_mm),
                request.cols,
                request.rows,
            );
            let photo_w = photo.width() + border * 2;
            let photo_h = photo.height() + border * 2;
            let mut placed = 0u32;
            for row in 0..rows {
                for col in 0..cols {
                    let x = margin_px as i64 + col as i64 * (photo_w as i64 + gap_px as i64);
                    let y = margin_px as i64 + row as i64 * (photo_h as i64 + gap_px as i64);
                    if x + photo_w as i64 > sheet_w_px as i64
                        || y + photo_h as i64 > sheet_h_px as i64
                    {
                        continue;
                    }
                    image::imageops::overlay(
                        &mut sheet,
                        &photo,
                        x + border as i64,
                        y + border as i64,
                    );
                    placed += 1;
                }
            }
            (
                cols,
                rows,
                placed,
                false,
                vec![SlotResult {
                    template: template_id.to_string(),
                    template_name: template_name.to_string(),
                    count: placed,
                }],
                template_id.to_string(),
                template_name.to_string(),
            )
        };

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
        template: result_template,
        template_name: result_template_name,
        sheet: sheet_id.to_string(),
        sheet_name: sheet_name.to_string(),
        cols,
        rows,
        count,
        width_px: sheet_w_px,
        height_px: sheet_h_px,
        width_mm: sheet_w_mm,
        height_mm: sheet_h_mm,
        mixed,
        slots: slot_results,
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
            slots: None,
        };
        let result = layout(&request, &tmp, "ws-test").unwrap();
        assert_eq!(result.cols, 3);
        assert_eq!(result.rows, 3);
        assert!(!result.mixed);
        let path = tmp.join(".zicode").join("idphoto").join(&result.file_name);
        assert!(path.exists());
        let decoded = image::open(&path).unwrap();
        assert_eq!(decoded.width(), mm_to_px(102.0));
        assert_eq!(decoded.height(), mm_to_px(152.0));
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn mixed_layout_packs_multiple_templates() {
        let tmp = std::env::temp_dir().join(format!("idphoto-mix-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&tmp).unwrap();
        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            600,
            800,
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
            background: "red".into(),
            tolerance: 48,
            crop: None,
            cols: None,
            rows: None,
            border_px: 2,
            slots: Some(vec![
                IdPhotoSlot {
                    template: "one_inch".into(),
                    count: 4,
                },
                IdPhotoSlot {
                    template: "two_inch".into(),
                    count: 2,
                },
            ]),
        };
        let result = layout(&request, &tmp, "ws-test").unwrap();
        assert!(result.mixed);
        assert_eq!(result.count, 6);
        assert_eq!(result.slots.len(), 2);
        assert_eq!(result.slots[0].template, "one_inch");
        assert_eq!(result.slots[0].count, 4);
        assert_eq!(result.slots[1].template, "two_inch");
        assert_eq!(result.slots[1].count, 2);
        let path = tmp.join(".zicode").join("idphoto").join(&result.file_name);
        assert!(path.exists());
        std::fs::remove_dir_all(&tmp).ok();
    }
}

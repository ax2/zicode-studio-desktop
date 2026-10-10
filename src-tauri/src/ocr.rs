//! Screenshot / image OCR using the built-in Windows OCR engine.
//!
//! Windows.Media.Ocr is available on Windows 10/11 and requires no extra
//! dependency, but only recognizes languages for which a language pack is
//! installed. The PowerShell bridge runs hidden and returns recognized text.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use uuid::Uuid;

const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

#[cfg(any(windows, test))]
const WINDOWS_OCR_SCRIPT: &str = r#"
$ErrorActionPreference = 'Stop'
# PowerShell 5.1 encodes redirected stdout with the console code page (GBK on
# Chinese systems) by default, which corrupts non-ASCII OCR output when Rust
# reads it as UTF-8. Force UTF-8 so recognized CJK text round-trips cleanly.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Foundation, ContentType = WindowsRuntime]

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($operation, $resultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($resultType)
    $task = $asTask.Invoke($null, @($operation))
    $task.Wait(-1) | Out-Null
    return $task.Result
}

$imagePath = $env:ZICODE_OCR_IMAGE
if (-not $imagePath -or -not (Test-Path -LiteralPath $imagePath)) {
    throw 'OCR image path is missing'
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($imagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$language = $env:ZICODE_OCR_LANGUAGE
$engine = $null
if ($language) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($language))
}
if ($null -eq $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
if ($null -eq $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
}
if ($null -eq $engine) {
    throw 'No OCR language pack is installed on this device'
}

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$result.Text
"#;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrRequest {
    pub image: String,
    #[serde(default)]
    pub language: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OcrResult {
    pub ok: bool,
    pub text: String,
    pub char_count: usize,
}

fn decode_image(input: &str, workspace_root: &Path) -> Result<image::DynamicImage, String> {
    if let Some(payload) = input.strip_prefix("data:") {
        let body = payload
            .split_once(',')
            .map(|(_, body)| body)
            .ok_or_else(|| "Invalid data URL".to_string())?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(body)
            .map_err(|error| format!("Invalid base64 image: {error}"))?;
        if bytes.len() > MAX_IMAGE_BYTES {
            return Err(format!(
                "Image exceeds the {MAX_IMAGE_BYTES} byte OCR limit"
            ));
        }
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

fn save_temp_png(img: &image::DynamicImage) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("zicode-ocr-{}.png", Uuid::new_v4().simple()));
    img.save_with_format(&path, image::ImageFormat::Png)
        .map_err(|error| format!("Cannot prepare image for OCR: {error}"))?;
    Ok(path)
}

#[cfg(target_os = "windows")]
fn run_windows_ocr(png_path: &Path, language: Option<&str>) -> Result<String, String> {
    let mut command = crate::process_command::new_command("powershell.exe");
    command
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            WINDOWS_OCR_SCRIPT,
        ])
        .env("ZICODE_OCR_IMAGE", png_path);
    if let Some(language) = language.map(str::trim).filter(|value| !value.is_empty()) {
        command.env("ZICODE_OCR_LANGUAGE", language);
    }
    let output = command
        .output()
        .map_err(|error| format!("Cannot start Windows OCR: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let message = if stderr.is_empty() {
            "Windows OCR failed".to_string()
        } else {
            stderr
                .lines()
                .last()
                .unwrap_or("Windows OCR failed")
                .to_string()
        };
        return Err(message);
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return Err("No text was recognized in the image".to_string());
    }
    Ok(text)
}

#[cfg(not(target_os = "windows"))]
fn run_windows_ocr(_png_path: &Path, _language: Option<&str>) -> Result<String, String> {
    Err("OCR is only available on Windows".to_string())
}

pub fn extract_text(request: &OcrRequest, workspace_root: &Path) -> Result<OcrResult, String> {
    let img = decode_image(&request.image, workspace_root)?;
    let png_path = save_temp_png(&img)?;
    let text = run_windows_ocr(&png_path, request.language.as_deref())?;
    let char_count = text.chars().count();
    std::fs::remove_file(&png_path).ok();
    Ok(OcrResult {
        ok: true,
        text,
        char_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_root() -> PathBuf {
        std::env::temp_dir().join(format!("ocr-test-{}", Uuid::new_v4().simple()))
    }

    #[test]
    fn decodes_a_data_url_image() {
        let root = tmp_root();
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            4,
            4,
            image::Rgb([0, 0, 0]),
        ));
        let mut bytes = std::io::Cursor::new(Vec::new());
        img.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
        let data_url = format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes.into_inner())
        );
        let decoded = decode_image(&data_url, &root).unwrap();
        assert_eq!(decoded.width(), 4);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn saves_a_temp_png() {
        let img = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
            3,
            3,
            image::Rgb([1, 2, 3]),
        ));
        let path = save_temp_png(&img).unwrap();
        assert!(path.exists());
        assert!(path.extension().map(|ext| ext == "png").unwrap_or(false));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn windows_ocr_script_forces_utf8_stdout() {
        // PowerShell 5.1 defaults to the OEM code page for redirected output,
        // which turns CJK OCR results into mojibake. Guard the explicit UTF-8
        // override so a future edit cannot silently regress this.
        assert!(
            WINDOWS_OCR_SCRIPT.contains("[Console]::OutputEncoding = [System.Text.Encoding]::UTF8")
        );
    }
}

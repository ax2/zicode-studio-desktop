use serde::{Deserialize, Serialize};
use tauri::WebviewWindow;

use super::capture::{FrameImageLocator, PageImage};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRecognition {
    #[serde(flatten)]
    provenance: ImageProvenance,
    text: String,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImagePreview {
    #[serde(flatten)]
    provenance: ImageProvenance,
    png_base64: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageProvenance {
    source: PageImage,
    page_url: String,
    document_revision: String,
    captured_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    frame: Option<CapturedFrame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImageTarget {
    tab: String,
    expected_url: String,
    expected_revision: String,
    image: PageImage,
    frame: Option<ImageFrameSource>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ImageFrameSource {
    title: String,
    url: Option<String>,
    locator: FrameImageLocator,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CapturedFrame {
    title: String,
    url: Option<String>,
    document_revision: String,
}

#[derive(Clone, Copy, Deserialize)]
pub(crate) enum ImageOcrLanguage {
    #[serde(rename = "zh-CN")]
    SimplifiedChinese,
    #[serde(rename = "en-US")]
    English,
}

impl ImageOcrLanguage {
    #[cfg(windows)]
    fn tag(self) -> &'static str {
        match self {
            Self::SimplifiedChinese => "zh-CN",
            Self::English => "en-US",
        }
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)] // Preserve the existing IPC keys while adding an optional language.
pub(crate) async fn browser_recognize_image_text(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
    expected_revision: String,
    image: PageImage,
    confirmed: bool,
    frame: Option<ImageFrameSource>,
    language: Option<ImageOcrLanguage>,
) -> Result<ImageRecognition, String> {
    crate::require_workspace_window(&window)?;
    if !confirmed {
        return Err("Confirm recognition for this image first.".into());
    }
    #[cfg(windows)]
    {
        windows::recognize(
            window,
            ImageTarget {
                tab,
                expected_url,
                expected_revision,
                image,
                frame,
            },
            language,
        )
        .await
    }
    #[cfg(not(windows))]
    {
        let _ = (tab, expected_url, expected_revision, image, frame, language);
        Err("OCR is only available on Windows".into())
    }
}

#[tauri::command]
pub(crate) async fn browser_preview_image(
    window: WebviewWindow,
    target: ImageTarget,
    confirmed: bool,
) -> Result<ImagePreview, String> {
    crate::require_workspace_window(&window)?;
    if !confirmed {
        return Err("Choose an image to preview first.".into());
    }
    #[cfg(windows)]
    {
        windows::preview(window, target).await
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Err("Integrated browser is currently available on Windows".into())
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::browser::capture::{
        is_web_url, run, valid_image_locator, Capture, Script, IMAGE_IDENTITY,
    };
    use base64::{engine::general_purpose::STANDARD, Engine};
    use image::{codecs::png::PngDecoder, DynamicImage, ImageDecoder, Limits};
    use std::io::Cursor;

    const MAX_RESPONSE: usize = 6 * 1024 * 1024;
    const MAX_SIDE: u32 = 1536;
    const PREVIEW_SIDE: u32 = 384;
    const MAX_PREVIEW_BASE64: usize = 800_000;
    const MAX_PIXELS: u64 = 1_000_000;
    const MAX_TEXT: usize = 8000;
    const PNG_PREFIX: &str = "data:image/png;base64,";

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
    enum Pixels {
        Ready { png: String },
        Unavailable,
        OriginRestricted,
        FrameChanged,
        TooLarge,
    }

    fn parse_pixels(raw: &str, _: &str) -> Result<String, String> {
        if raw.len() > MAX_RESPONSE {
            return Err("Browser image exceeded the OCR size limit.".into());
        }
        match serde_json::from_str(raw).map_err(|_| "Invalid browser image response")? {
            Pixels::Ready { png } if png.starts_with(PNG_PREFIX) => Ok(png),
            Pixels::Ready { .. } => Err("Invalid browser image response".into()),
            Pixels::Unavailable => {
                Err("This image changed or is no longer visible. Read the page again.".into())
            }
            Pixels::OriginRestricted => {
                Err("This image does not allow access to its pixels.".into())
            }
            Pixels::FrameChanged => Err("The embedded page changed. Read the page again.".into()),
            Pixels::TooLarge => Err("Browser image exceeded the OCR size limit.".into()),
        }
    }

    fn decode_png(data: &str) -> Result<DynamicImage, String> {
        let payload = data
            .strip_prefix(PNG_PREFIX)
            .ok_or("Invalid browser image response")?;
        let bytes = STANDARD
            .decode(payload)
            .map_err(|_| "Invalid browser image response")?;
        let mut decoder =
            PngDecoder::new(Cursor::new(bytes)).map_err(|_| "Invalid browser image response")?;
        let (width, height) = decoder.dimensions();
        if u64::from(width) * u64::from(height) > MAX_PIXELS {
            return Err("Browser image exceeded the OCR size limit.".into());
        }
        let mut limits = Limits::default();
        limits.max_image_width = Some(MAX_SIDE);
        limits.max_image_height = Some(MAX_SIDE);
        limits.max_alloc = Some(8 * 1024 * 1024);
        decoder
            .set_limits(limits)
            .map_err(|_| "Browser image exceeded the OCR size limit.")?;
        DynamicImage::from_decoder(decoder).map_err(|_| "Invalid browser image response".into())
    }

    async fn capture_pixels(
        window: WebviewWindow,
        target: &ImageTarget,
        max_side: u32,
    ) -> Result<Capture<String>, String> {
        let ImageTarget {
            tab,
            expected_url,
            expected_revision,
            image,
            frame,
        } = target;
        if expected_revision.is_empty()
            || expected_revision.len() > 128
            || image.alt.chars().count() > 160
            || !(1..=100_000).contains(&image.width)
            || !(1..=100_000).contains(&image.height)
            || !image.url.as_deref().is_some_and(is_web_url)
            || !image.locator.as_deref().is_some_and(valid_image_locator)
        {
            return Err("Invalid browser image source.".into());
        }
        if frame.as_ref().is_some_and(|frame| {
            !frame.locator.is_valid()
                || frame.title.chars().count() > 512
                || frame.url.as_deref().is_some_and(|source| {
                    !is_web_url(source)
                        || !reqwest::Url::parse(source)
                            .ok()
                            .zip(reqwest::Url::parse(expected_url).ok())
                            .is_some_and(|(child, parent)| child.origin() == parent.origin())
                })
        }) {
            return Err("Invalid browser image source.".into());
        }
        let descriptor = serde_json::to_string(image).map_err(|e| e.to_string())?;
        let location = serde_json::to_string(frame).map_err(|e| e.to_string())?;
        let script = format!(
            "({})({descriptor}, {location}, {max_side}, ({IMAGE_IDENTITY})().resolve)",
            include_str!("image_ocr.js")
        );
        run(
            window,
            tab.clone(),
            expected_url.clone(),
            Some(expected_revision.clone()),
            Script::Isolated {
                source: script,
                fallback: None,
            },
            parse_pixels,
        )
        .await
    }

    fn provenance(mut target: ImageTarget, captured: Capture<String>) -> ImageProvenance {
        target.image.locator = None;
        ImageProvenance {
            source: target.image,
            page_url: target.expected_url,
            document_revision: captured.document_revision,
            captured_at: captured.captured_at,
            frame: target.frame.map(|source| CapturedFrame {
                title: source.title,
                url: source.url,
                document_revision: source.locator.time_origin,
            }),
        }
    }

    fn encode_preview(data: &str) -> Result<String, String> {
        let pixels = decode_png(data)?;
        if pixels.width() > PREVIEW_SIDE || pixels.height() > PREVIEW_SIDE {
            return Err("Browser image exceeded the preview size limit.".into());
        }
        // Send only pixels. Do not relay ancillary data from the page's PNG.
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(pixels.to_rgb8())
            .write_to(&mut bytes, image::ImageFormat::Png)
            .map_err(|_| "Invalid browser image response")?;
        let data = STANDARD.encode(bytes.into_inner());
        if data.len() > MAX_PREVIEW_BASE64 {
            return Err("Browser image exceeded the preview size limit.".into());
        }
        Ok(data)
    }

    pub(super) async fn recognize(
        window: WebviewWindow,
        target: ImageTarget,
        language: Option<ImageOcrLanguage>,
    ) -> Result<ImageRecognition, String> {
        let captured = capture_pixels(window, &target, MAX_SIDE).await?;
        tauri::async_runtime::spawn_blocking(move || {
            let pixels = decode_png(&captured.page)?;
            let result =
                crate::ocr::extract_decoded_text(&pixels, language.map(ImageOcrLanguage::tag), None, true)?;
            Ok(ImageRecognition {
                provenance: provenance(target, captured),
                text: result.text.chars().take(MAX_TEXT).collect(),
                truncated: result.char_count > MAX_TEXT,
            })
        })
        .await
        .map_err(|_| "Browser image OCR worker stopped".to_owned())?
    }

    pub(super) async fn preview(
        window: WebviewWindow,
        target: ImageTarget,
    ) -> Result<ImagePreview, String> {
        let captured = capture_pixels(window, &target, PREVIEW_SIDE).await?;
        tauri::async_runtime::spawn_blocking(move || {
            let png_base64 = encode_preview(&captured.page)?;
            Ok(ImagePreview {
                provenance: provenance(target, captured),
                png_base64,
            })
        })
        .await
        .map_err(|_| "Browser image preview worker stopped".to_owned())?
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn accepts_only_bounded_canvas_pngs() {
            let png = |size| {
                let image = DynamicImage::new_rgb8(size, size);
                let mut bytes = Cursor::new(Vec::new());
                image.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
                format!("{PNG_PREFIX}{}", STANDARD.encode(bytes.into_inner()))
            };
            let data = png(32);
            let preview = encode_preview(&data).unwrap();
            assert_eq!(
                decode_png(&format!("{PNG_PREFIX}{preview}"))
                    .unwrap()
                    .width(),
                32
            );
            assert_eq!(
                encode_preview(&png(PREVIEW_SIDE + 1)).unwrap_err(),
                "Browser image exceeded the preview size limit."
            );
            let decoded = decode_png(&data).unwrap();
            assert_eq!((decoded.width(), decoded.height()), (32, 32));
            assert!(decode_png(&png(1001)).is_err());
            assert!(decode_png("data:image/jpeg;base64,YQ==").is_err());
            assert!(decode_png("data:image/png;base64,YQ==").is_err());
            assert!(parse_pixels(&" ".repeat(MAX_RESPONSE + 1), "https://example.org/").is_err());
            assert!(parse_pixels(
                r#"{"kind":"ready","png":"file:///private.png"}"#,
                "https://example.org/"
            )
            .is_err());
            assert_eq!(
                parse_pixels(r#"{"kind":"originRestricted"}"#, "https://example.org/").unwrap_err(),
                "This image does not allow access to its pixels."
            );
        }
    }
}

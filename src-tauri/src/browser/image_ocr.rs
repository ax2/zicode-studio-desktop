use serde::Serialize;
use tauri::WebviewWindow;

use super::capture::PageImage;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageRecognition {
    pub source: PageImage,
    pub page_url: String,
    pub document_revision: String,
    pub captured_at: String,
    pub text: String,
    pub truncated: bool,
}

#[tauri::command]
pub(crate) async fn browser_recognize_image_text(
    window: WebviewWindow,
    tab: String,
    expected_url: String,
    expected_revision: String,
    image: PageImage,
    confirmed: bool,
) -> Result<ImageRecognition, String> {
    crate::require_workspace_window(&window)?;
    if !confirmed {
        return Err("Confirm recognition for this image first.".into());
    }
    #[cfg(windows)]
    {
        windows::recognize(window, tab, expected_url, expected_revision, image).await
    }
    #[cfg(not(windows))]
    {
        let _ = (tab, expected_url, expected_revision, image);
        Err("OCR is only available on Windows".into())
    }
}

#[cfg(windows)]
mod windows {
    use super::*;
    use crate::browser::capture::{is_web_url, run};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use image::{codecs::png::PngDecoder, DynamicImage, ImageDecoder, Limits};
    use serde::Deserialize;
    use std::io::Cursor;

    const MAX_RESPONSE: usize = 6 * 1024 * 1024;
    const MAX_SIDE: u32 = 1536;
    const MAX_PIXELS: u64 = 1_000_000;
    const MAX_TEXT: usize = 8000;
    const PNG_PREFIX: &str = "data:image/png;base64,";

    #[derive(Deserialize)]
    #[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
    enum Pixels {
        Ready { png: String },
        Unavailable,
        OriginRestricted,
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

    pub(super) async fn recognize(
        window: WebviewWindow,
        tab: String,
        expected_url: String,
        expected_revision: String,
        image: PageImage,
    ) -> Result<ImageRecognition, String> {
        if expected_revision.is_empty()
            || expected_revision.len() > 128
            || image.alt.chars().count() > 160
            || !(1..=100_000).contains(&image.width)
            || !(1..=100_000).contains(&image.height)
            || !image.url.as_deref().is_some_and(is_web_url)
        {
            return Err("Invalid browser image source.".into());
        }
        let descriptor = serde_json::to_string(&image).map_err(|e| e.to_string())?;
        let script = format!("({})({descriptor})", include_str!("image_ocr.js"));
        let captured = run(
            window,
            tab,
            expected_url.clone(),
            Some(expected_revision),
            script,
            parse_pixels,
        )
        .await?;
        tauri::async_runtime::spawn_blocking(move || {
            let pixels = decode_png(&captured.page)?;
            let result = crate::ocr::extract_decoded_text(&pixels, None, None)?;
            Ok(ImageRecognition {
                source: image,
                page_url: expected_url,
                document_revision: captured.document_revision,
                captured_at: captured.captured_at,
                text: result.text.chars().take(MAX_TEXT).collect(),
                truncated: result.char_count > MAX_TEXT,
            })
        })
        .await
        .map_err(|_| "Browser image OCR worker stopped".to_owned())?
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

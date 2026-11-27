//! Read the original still image inside the same Windows limits as thumbnails.
use super::{decode_static, open_input, read_input, run_single, Result, TIME_LIMIT};
use image::{DynamicImage, ImageFormat};
use serde::{Deserialize, Serialize};
use std::{env, fs::OpenOptions, io::Read, path::Path};

pub(in crate::visual_assets) const WORKER: &str = "--zicode-visual-assets-inspect-worker";
const MAX_RESULT_BYTES: u64 = 256;

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::visual_assets) struct Specifications {
    format: String,
    width: u32,
    height: u32,
    has_transparency: bool,
}

fn inspect_bytes(bytes: &[u8]) -> Result<Specifications> {
    let format = match image::guess_format(bytes)? {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpeg",
        ImageFormat::WebP => "webp",
        _ => return Err("unsupported image format".into()),
    };
    let image = decode_static(bytes)?;
    let has_transparency = match &image {
        DynamicImage::ImageLumaA8(image) => image.pixels().any(|pixel| pixel[1] != u8::MAX),
        DynamicImage::ImageRgba8(image) => image.pixels().any(|pixel| pixel[3] != u8::MAX),
        DynamicImage::ImageLumaA16(image) => image.pixels().any(|pixel| pixel[1] != u16::MAX),
        DynamicImage::ImageRgba16(image) => image.pixels().any(|pixel| pixel[3] != u16::MAX),
        _ => false,
    };
    Ok(Specifications {
        format: format.into(),
        width: image.width(),
        height: image.height(),
        has_transparency,
    })
}

pub(in crate::visual_assets) fn inspect_file(input: &Path, output: &Path) -> Result<()> {
    std::io::stdin().read_exact(&mut [0])?;
    let specs = inspect_bytes(&read_input(input)?)?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)?;
    serde_json::to_writer(&mut file, &specs)?;
    file.sync_all()?;
    Ok(())
}

pub(in crate::visual_assets) fn inspect(input: &Path, output: &Path) -> Result<Specifications> {
    let mut command = crate::process_command::new_command(env::current_exe()?);
    command.arg(WORKER).arg(input).arg(output);
    run_single(command, TIME_LIMIT)?;
    let mut bytes = Vec::new();
    open_input(output)?
        .take(MAX_RESULT_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_RESULT_BYTES {
        return Err("image specifications worker exceeded its output limit".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb, Rgba};
    use std::io::Cursor;

    fn original(image: DynamicImage, format: ImageFormat) -> Vec<u8> {
        let mut output = Cursor::new(Vec::new());
        image.write_to(&mut output, format).unwrap();
        output.into_inner()
    }

    #[test]
    fn reads_dimensions_and_real_pixel_transparency_from_each_original() {
        let rgb = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(3, 5, Rgb([10, 20, 30])));
        let opaque = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 5, Rgba([1, 2, 3, 255])));
        let alpha = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(3, 5, Rgba([1, 2, 3, 254])));
        let alpha16 =
            DynamicImage::ImageRgba16(ImageBuffer::from_pixel(3, 5, Rgba([1, 2, 3, 65534])));
        for (image, format, label, has_transparency) in [
            (rgb.clone(), ImageFormat::Jpeg, "jpeg", false),
            (opaque.clone(), ImageFormat::Png, "png", false),
            (opaque, ImageFormat::WebP, "webp", false),
            (alpha, ImageFormat::WebP, "webp", true),
            (alpha16, ImageFormat::Png, "png", true),
        ] {
            assert_eq!(
                inspect_bytes(&original(image, format)).unwrap(),
                Specifications {
                    format: label.into(),
                    width: 3,
                    height: 5,
                    has_transparency
                },
            );
        }
        assert!(inspect_bytes(b"not an image").is_err());
        assert!(inspect_bytes(b"\x89PNG\r\n\x1a\n").is_err());
    }
}

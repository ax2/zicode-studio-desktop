use super::{create_new, Canvas, Frame, Recipe, Result};
use gif::{DisposalMethod, Encoder, Repeat};
use image::RgbaImage;
use std::{
    collections::BTreeMap,
    io::{BufWriter, Write},
    path::Path,
};

// Index zero is always transparent, even when a frame is completely opaque.
// This makes disposal clear old pixels before the next full-canvas frame.
fn indexed(image: &RgbaImage) -> (Vec<u8>, Vec<u8>) {
    let mut exact = BTreeMap::new();
    for pixel in image.pixels().filter(|p| p[3] >= 128) {
        let rgb = [pixel[0], pixel[1], pixel[2]];
        let next = exact.len() + 1;
        exact.entry(rgb).or_insert(next);
        if exact.len() > 255 {
            break;
        }
    }
    if exact.len() <= 255 {
        let mut table = vec![0; (1 + exact.len()).max(2) * 3];
        for (rgb, &index) in &exact {
            table[index * 3..index * 3 + 3].copy_from_slice(rgb);
        }
        let indices = image
            .pixels()
            .map(|p| {
                if p[3] < 128 {
                    0
                } else {
                    exact[&[p[0], p[1], p[2]]] as u8
                }
            })
            .collect();
        return (indices, table);
    }
    let opaque: Vec<u8> = image
        .pixels()
        .filter(|p| p[3] >= 128)
        .flat_map(|p| [p[0], p[1], p[2], 255])
        .collect();
    let quant = color_quant::NeuQuant::new(10, 255, &opaque);
    let mut table = vec![0, 0, 0];
    table.extend(quant.color_map_rgb());
    let indices = image
        .pixels()
        .map(|p| {
            if p[3] < 128 {
                0
            } else {
                (1 + quant.index_of(&[p[0], p[1], p[2], 255])) as u8
            }
        })
        .collect();
    (indices, table)
}

pub(super) fn write(
    path: &Path,
    recipe: &Recipe,
    canvas: &Canvas,
    mut frame_image: impl FnMut(usize, &Frame) -> Result<RgbaImage>,
) -> Result<()> {
    let width = u16::try_from(canvas.width)?;
    let height = u16::try_from(canvas.height)?;
    let mut output = BufWriter::new(create_new(path)?);
    let mut encoder = Encoder::new(&mut output, width, height, &[0, 0, 0, 255, 255, 255])?;
    if recipe.looped {
        encoder.set_repeat(Repeat::Infinite)?;
    }
    for (index, spec) in recipe.frames.iter().enumerate() {
        let image = frame_image(index, spec)?;
        let (indices, palette) = indexed(&image);
        let mut frame = gif::Frame::from_palette_pixels(width, height, indices, palette, Some(0));
        frame.delay = ((spec.duration_ms + 5) / 10).max(1) as u16;
        frame.dispose = DisposalMethod::Background;
        encoder.write_frame(&frame)?;
    }
    encoder.into_inner()?;
    output.flush()?;
    output.get_ref().sync_all()?;
    Ok(())
}

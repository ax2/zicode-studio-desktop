use super::*;
use image::Rgba;

fn frame(x: u32, width: u32, anchor_x: u32) -> Frame {
    Frame {
        x,
        y: 0,
        width,
        height: 2,
        duration_ms: 100,
        anchor_x,
        anchor_y: 1,
    }
}

#[test]
fn places_each_crop_relative_to_the_same_anchor_and_preserves_alpha() {
    let left = Rgba([240, 20, 11, 123]);
    let right = Rgba([19, 127, 255, 0]);
    let atlas = RgbaImage::from_fn(5, 2, |x, _| if x < 2 { left } else { right });
    let recipe = Recipe {
        looped: true,
        frames: vec![frame(0, 2, 2), frame(2, 3, 0)],
    };
    let canvas = recipe.layout(atlas.width(), atlas.height()).unwrap();
    assert_eq!(
        canvas,
        Canvas {
            width: 5,
            height: 2,
            origin_x: 2,
            origin_y: 1,
        }
    );
    let first = canvas.extract(&atlas, &recipe.frames[0]).unwrap();
    let second = canvas.extract(&atlas, &recipe.frames[1]).unwrap();
    let blank = Rgba([0, 0, 0, 0]);
    assert_eq!(*first.get_pixel(1, 1), left);
    assert_eq!(*first.get_pixel(2, 1), blank);
    assert_eq!(*second.get_pixel(1, 1), blank);
    assert_eq!(*second.get_pixel(2, 1), right);
}

#[test]
fn rejects_overflowing_crops_invalid_anchors_and_excessive_output() {
    let mut recipe = Recipe {
        looped: false,
        frames: vec![frame(u32::MAX, 2, 1)],
    };
    assert!(recipe.layout(5, 2).is_err());
    recipe.frames[0] = frame(0, 2, 3);
    assert!(recipe.layout(5, 2).is_err());
    recipe.frames[0] = frame(0, 2, 1);
    recipe.frames[0].duration_ms = 0;
    assert!(recipe.layout(5, 2).is_err());
    recipe.frames[0] = frame(0, 2049, 1);
    assert!(recipe.layout(4096, 2048).is_err());
    recipe.frames = (0..9)
        .map(|_| Frame {
            height: 2048,
            ..frame(0, 2048, 1)
        })
        .collect();
    assert!(recipe.layout(4096, 2048).is_err());
    recipe.frames.clear();
    assert!(recipe.layout(4096, 2048).is_err());
}

#[test]
fn godot_resources_keep_durations_order_and_relative_resource_paths() {
    let recipe = Recipe {
        looped: false,
        frames: vec![
            frame(0, 2, 2),
            Frame {
                duration_ms: 245,
                ..frame(2, 3, 0)
            },
        ],
    };
    let canvas = recipe.layout(5, 2).unwrap();
    let [(_, frames), (_, clip), (_, preview), (_, project)] =
        godot::resources(&recipe, &canvas).unwrap();
    assert!(frames.contains(r#"path="frames/frame-001.png""#));
    assert!(frames.contains(r#"path="frames/frame-002.png""#));
    assert!(frames.contains("\"duration\": 100.0"));
    assert!(frames.contains("\"duration\": 245.0"));
    assert!(frames.contains("\"speed\": 1000.0"));
    assert!(frames.contains("\"loop\": false"));
    assert!(clip.contains(r#"path="clip.tres""#));
    assert!(clip.contains("sprite_frames = ExtResource(\"1\")\nframe = 0\nautoplay"));
    assert!(clip.contains("offset = Vector2(-2, -1)"));
    assert!(preview.contains(r#"path="clip.tscn""#));
    assert!(project.contains(r#"run/main_scene="res://preview.tscn""#));
}

use super::{frame_path, Canvas, Recipe, Result};
use std::fmt::Write;

pub(super) const VERSION: &str = "Godot 4.5.1";
const ANIMATION_FPS: u32 = 1000;

pub(super) fn resources(recipe: &Recipe, canvas: &Canvas) -> Result<[(&'static str, String); 4]> {
    let mut frames = format!(
        "[gd_resource type=\"SpriteFrames\" load_steps={} format=3]\n\n",
        recipe.frames.len() + 1
    );
    for index in 0..recipe.frames.len() {
        writeln!(
            frames,
            "[ext_resource type=\"Texture2D\" path=\"{}\" id=\"{}\"]",
            frame_path(index),
            index + 1,
        )?;
    }
    frames.push_str("\n[resource]\nanimations = [{\n\"frames\": [");
    for (index, frame) in recipe.frames.iter().enumerate() {
        if index > 0 {
            frames.push_str(", ");
        }
        // At 1000 FPS the relative duration equals the desired milliseconds.
        write!(
            frames,
            "{{\n\"duration\": {}.0,\n\"texture\": ExtResource(\"{}\")\n}}",
            frame.duration_ms,
            index + 1,
        )?;
    }
    writeln!(
        frames,
        "],\n\"loop\": {},\n\"name\": &\"default\",\n\"speed\": {ANIMATION_FPS}.0\n}}]",
        recipe.looped,
    )?;

    let offset_x = -i64::from(canvas.origin_x);
    let offset_y = -i64::from(canvas.origin_y);
    // Godot 4.5.1 recalculates the first frame's duration when the frame is set.
    let clip = format!(
        "[gd_scene load_steps=2 format=3]\n\n\
         [ext_resource type=\"SpriteFrames\" path=\"clip.tres\" id=\"1\"]\n\n\
         [node name=\"Clip\" type=\"AnimatedSprite2D\"]\n\
         texture_filter = 1\n\
         sprite_frames = ExtResource(\"1\")\n\
         frame = 0\n\
         autoplay = \"default\"\n\
         centered = false\n\
         offset = Vector2({offset_x}, {offset_y})\n"
    );

    let preview_width = canvas.width.max(256) + 16;
    let preview_height = canvas.height.max(256) + 16;
    let preview_x = canvas.origin_x + (preview_width - canvas.width) / 2;
    let preview_y = canvas.origin_y + (preview_height - canvas.height) / 2;
    let preview = format!(
        "[gd_scene load_steps=2 format=3]\n\n\
         [ext_resource type=\"PackedScene\" path=\"clip.tscn\" id=\"1\"]\n\n\
         [node name=\"Preview\" type=\"Node2D\"]\n\n\
         [node name=\"Clip\" parent=\".\" instance=ExtResource(\"1\")]\n\
         position = Vector2({preview_x}, {preview_y})\n"
    );
    let project = format!(
        "config_version=5\n\n\
         [application]\n\
         config/name=\"ZiCode Animation Preview\"\n\
         run/main_scene=\"res://preview.tscn\"\n\
         config/features=PackedStringArray(\"4.5\", \"GL Compatibility\")\n\n\
         [display]\n\
         window/size/viewport_width={preview_width}\n\
         window/size/viewport_height={preview_height}\n\n\
         [rendering]\n\
         renderer/rendering_method=\"gl_compatibility\"\n"
    );
    Ok([
        ("clip.tres", frames),
        ("clip.tscn", clip),
        ("preview.tscn", preview),
        ("project.godot", project),
    ])
}

"""Verify GIF captions against native preview with Pillow and an isolated Windows profile."""
import base64
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops, ImageDraw, ImageFont


def sample_recipe():
    # Use Windows' local font only for this independent test fixture.
    font = ImageFont.truetype(str(Path(os.environ["WINDIR"]) / "Fonts/msyhbd.ttc"), 32)
    bitmap = Image.new("RGBA", (260, 94))
    ImageDraw.Draw(bitmap).multiline_text((5, 5), "早安！\nStudio GIF", fill="white",
                                        stroke_width=2, stroke_fill="black", font=font)
    stream = io.BytesIO()
    bitmap.save(stream, format="PNG")
    return {
        "libraryId": "isolated-test",
        "source": {"kind": "sequence"},
        "format": "gif",
        "recipe": {
            "looped": True,
            "frames": [dict(assetId=1, revision=1, durationMs=100, anchorX=0, anchorY=0) for _ in range(2)],
            "caption": dict(text="早安！\nStudio GIF", position="top", size="large",
                            rasterPng=base64.b64encode(stream.getvalue()).decode("ascii")),
        },
    }


def verify(probe, root, template):
    profile, output = root / "profile", root / "exports"
    profile.mkdir()
    output.mkdir()

    def run(*args, interrupt=None):
        env = dict(os.environ)
        env.pop("ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT", None)
        if interrupt:
            env["ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT"] = interrupt
        result = subprocess.run([probe, profile, *map(str, args)], env=env,
                                encoding="utf-8", capture_output=True)
        assert (result.returncode != 0) == bool(interrupt), result.stderr
        return result.stdout.strip()

    sources = []
    for index, frame in enumerate(template["recipe"]["frames"]):
        source = root / f"source-{index}.png"
        image = Image.new("RGBA", (180, 144))
        image.putpixel((index, 0), (220, 20, 30, 255))
        image.save(source)
        sources.append((source, source.read_bytes()))
        frame["assetId"] = int(run("import", source))
    template["libraryId"] = run("library-id")
    caption = template["recipe"]["caption"]
    assert caption["text"] == "早安！\nStudio GIF"
    glyph = Image.open(io.BytesIO(base64.b64decode(caption["rasterPng"]))).convert("RGBA")
    assert glyph.getchannel("A").getbbox()
    request = root / "caption.json"
    heights = {}
    for size, position in (("large", "top"), ("large", "center"), ("large", "bottom"),
                           ("small", "center"), ("medium", "center")):
        caption.update(position=position, size=size)
        request.write_text(json.dumps(template), encoding="utf-8")
        preview = json.loads(run("animation-preview", request))
        job = json.loads(run("animation-job", output, request))
        animation = Path(job["destination"]) / "animation.gif"
        with Image.open(animation) as decoded:
            assert decoded.n_frames == 2 and decoded.info["loop"] == 0
            for i in range(2):
                decoded.seek(i)
                frame = decoded.convert("RGBA")
                native = Image.open(io.BytesIO(base64.b64decode(preview["frames"][i]["base64"]))).convert("RGBA")
                assert frame.size == native.size == (180, 144)
                assert frame.getpixel((i, 0)) == (220, 20, 30, 255)
                alpha = frame.getchannel("A")
                assert not ImageChops.difference(alpha, native.getchannel("A").point(lambda a: 255 if a >= 128 else 0)).getbbox()
                alpha.putpixel((i, 0), 0)
                left, top, right, bottom = alpha.getbbox()
                assert left < right and 20 < sum(bool(a) for a in alpha.tobytes()) < 10000
                center = (top + bottom) / 2
                assert {"top": center < 58, "center": 65 < center < 79, "bottom": center > 86}[position]
                heights[size] = bottom - top
        run("animation-job", output, request, interrupt="animation-ready")
        interrupted = json.loads(run("job-status"))
        review = json.loads(run("animation-retry-plan", interrupted["id"], output))
        assert review["intent"]["recipe"]["caption"] == caption
        retry = json.loads(run("animation-retry", interrupted["id"], output))
        assert animation.read_bytes() == (Path(retry["destination"]) / "animation.gif").read_bytes()
    assert heights["small"] < heights["medium"] < heights["large"]
    assert all(source.read_bytes() == content for source, content in sources)


if __name__ == "__main__":
    probe = Path(sys.argv[1]).resolve()
    recipe = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8")) if len(sys.argv) > 2 else sample_recipe()
    with tempfile.TemporaryDirectory() as temporary:
        verify(probe, Path(temporary), recipe)
    print("Verified mixed-script caption, placements, sizes, frame changes, preview, GIF and retries.")

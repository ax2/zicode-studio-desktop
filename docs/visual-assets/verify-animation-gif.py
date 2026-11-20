"""Run the Windows native animation job and independently decode its GIF with Pillow."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(probe, root):
    profile = root / "profile"
    output = root / "exports"
    profile.mkdir()
    output.mkdir()

    def run(*args, interrupt=None):
        env = dict(os.environ)
        env.pop("ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT", None)
        if interrupt:
            env["ZICODE_VISUAL_ASSETS_PROBE_INTERRUPT"] = interrupt
        result = subprocess.run([probe, profile, *map(str,args)], env=env, capture_output=True, text=True)
        if interrupt:
            assert result.returncode != 0
            return None
        result.check_returncode()
        return result.stdout.strip()

    atlas = Image.new("RGBA", (6,2))
    atlas.putpixel((0,0), (65,0,0,255))
    atlas.putpixel((1,0), (0,0,0,127))
    atlas.putpixel((4,1), (0,0,0,128))
    source = root / "source.png"
    atlas.save(source)
    paths = [source]
    for index in range(2):
        path = root / f"slice-{index}.png"
        atlas.crop((index*3,0,index*3+3,2)).save(path)
        paths.append(path)
    original = [digest(path) for path in paths]
    ids = [int(run("import", path)) for path in paths]
    library = run("library-id")
    for sequence in (False, True):
        frames = []
        for i, duration in [(0,124),(1,245),(0,1)]:
            frame = dict(durationMs=duration,anchorX=0,anchorY=0)
            if sequence:
                frame.update(assetId=ids[i+1],revision=1)
            else:
                frame.update(x=i*3,y=0,width=3,height=2)
            frames.append(frame)
        source_ref = dict(kind="sequence") if sequence else dict(kind="atlas",assetId=ids[0],revision=1)
        intent = dict(libraryId=library,source=source_ref,recipe=dict(looped=sequence,frames=frames),format="gif")
        request = root / "intent.json"
        request.write_text(json.dumps(intent), encoding="utf-8")
        job = json.loads(run("animation-job",output,request))
        assert job["state"]=="completed"
        target = Path(job["destination"])
        assert {p.name for p in target.iterdir()}=={"animation.gif","manifest.json"}
        manifest = json.loads((target/"manifest.json").read_text(encoding="utf-8"))
        assert manifest["format"]=="gif"
        animation = target/"animation.gif"
        assert manifest["fileSha256"]=={"animation.gif":digest(animation)}
        assert animation.read_bytes()[:6]==b"GIF89a"
        with Image.open(animation) as decoded:
            assert decoded.size==(3,2) and decoded.n_frames==3
            assert decoded.info.get("loop")== (0 if sequence else None)
            for i, duration in enumerate((120,250,10)):
                decoded.seek(i)
                assert decoded.info["duration"]==duration
                image = decoded.convert("RGBA")
                assert image.getpixel((1,0))[3]==0
                if i==1:
                    assert image.getpixel((0,0))[3]==0
                    assert image.getpixel((1,1))==(0,0,0,255)
                else:
                    assert image.getpixel((0,0))==(65,0,0,255)
                    assert image.getpixel((1,1))[3]==0
        run("animation-job",output,request,interrupt="animation-ready")
        interrupted = json.loads(run("job-status"))
        assert interrupted["state"]=="interrupted" and not Path(interrupted["destination"]).exists()
        review = json.loads(run("animation-retry-plan",interrupted["id"],output))
        assert review["intent"]["format"]=="gif"
        retried = json.loads(run("animation-retry",interrupted["id"],output))
        assert retried["state"]=="completed" and digest(Path(retried["destination"])/"animation.gif")==digest(animation)
        run("animation-job",output,request,interrupt="animation-published")
        assert json.loads(run("job-status"))["state"]=="completed"
        previous = set(output.glob("gif-animation-*"))
        run("animation-job",output,request,interrupt="animation-published")
        [unverified] = set(output.glob("gif-animation-*")) - previous
        (unverified/"animation.gif").write_bytes(b"corrupt synthetic output")
        assert json.loads(run("job-status"))["state"]=="interrupted"
    assert [digest(path) for path in paths]==original

    gradient = Image.new("RGBA", (33, 33))
    for y in range(33):
        for x in range(33):
            gradient.putpixel((x,y),(x*7,y*7,(x+y)*3,0 if x==0 else 255))
    image_path = root/"many-colors.png"
    gradient.save(image_path)
    image_hash = digest(image_path)
    asset = int(run("import", image_path))
    request.write_text(json.dumps(dict(libraryId=library,source=dict(kind="sequence"),format="gif",
        recipe=dict(looped=False,frames=[dict(assetId=asset,revision=1,anchorX=0,anchorY=0,durationMs=100)]))),encoding="utf-8")
    job = json.loads(run("animation-job",output,request))
    with Image.open(Path(job["destination"])/"animation.gif") as image:
        pixels = image.convert("RGBA")
        assert all(pixels.getpixel((x,y))[3]==(0 if x==0 else 255) for y in range(33) for x in range(33))
        for x,y in [(1,1),(16,16),(32,32)]:
            assert max(abs(a-b) for a,b in zip(pixels.getpixel((x,y)),gradient.getpixel((x,y))))<48
    assert digest(image_path)==image_hash


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as run_dir:
        verify(Path(sys.argv[1]).resolve(), Path(run_dir))
    print("Verified atlas and sequence GIFs, independent pixel/timing/loop decoding, retries and source integrity.")

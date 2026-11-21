"""Verify image annotation review, ranking, backup and derived index recovery offline.

Run with the built visual-assets-probe.exe. The recognition result is a synthetic
fixture. This exercises native storage, not model inference.
"""
from contextlib import closing
from pathlib import Path
import argparse
import hashlib
import json
import sqlite3
import subprocess
import tempfile


def verify(probe, root):
    source = Path(__file__).resolve().parents[1] / "images" / "mobile.webp"
    source_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    profile = root / "before"
    profile.mkdir()

    def run(directory, *args):
        return subprocess.check_output([probe, directory, *args], encoding="utf-8").strip()

    def listing(directory):
        return json.loads(run(directory, "list"))["assets"][0]

    asset = run(profile, "import", source)
    run(profile, "tag", asset, "聊天")
    thumbnail = profile / "visual-assets" / (source_sha + ".png")
    preview_sha = hashlib.sha256(thumbnail.read_bytes()).hexdigest()
    run(profile, "vision-fixture", asset, source_sha, preview_sha, json.dumps(["聊天", "手机"]))
    draft = listing(profile)["vision"][0]
    assert not draft["approved"] and draft["previewSha"] == preview_sha
    assert not json.loads(run(profile, "semantic-search", "移动端", '["手机"]'))
    run(profile, "vision-review", asset, source_sha, draft["id"], '["手机"]', "null")

    backup = root / "backup"
    backup.mkdir()
    snapshot = run(profile, "backup", backup)
    restored = root / "restored"
    restored.mkdir()
    assert json.loads(run(restored, "restore", snapshot))["version"] == 12
    library = restored / "visual-assets"
    with closing(sqlite3.connect(library / "catalog.sqlite")) as db:
        db.execute("DROP TABLE asset_name_gram")
        db.execute("DROP INDEX vision_by_label")
        db.commit()
    hits = json.loads(run(restored, "semantic-search", "移动端", '["手机"]'))
    assert [row["id"] for row in hits] == [int(asset)]
    record = listing(restored)["vision"][0]
    assert record["approved"] and record["labels"] == ["手机"] and record["id"] == draft["id"]
    assert record["provider"] == "acceptance-fixture" and record["previewSha"] == preview_sha
    run(restored, "vision-review", asset, source_sha, record["id"], "null", json.dumps(record["id"]))
    item = listing(restored)
    assert "vision" not in item and item["tags"] == ["聊天"] and item["digest"] == source_sha
    assert hashlib.sha256((library / (source_sha + ".blob")).read_bytes()).hexdigest() == source_sha
    assert not json.loads(run(restored, "semantic-search", "移动端", '["手机"]'))
    return {"snapshotVersion": 12, "originalSHA256": source_sha, "thumbnailSHA256": preview_sha}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("probe", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="studio-vision-review-") as scratch:
        print(json.dumps(verify(args.probe.resolve(strict=True), Path(scratch))))

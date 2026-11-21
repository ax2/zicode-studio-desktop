"""Reproduce the small Chinese catalog search baseline with an existing Windows probe.

Run: python -X utf8 docs/visual-assets/measure-chinese-search.py <visual-assets-probe.exe>
Output is JSON. Literal or negative-control regressions fail the command. Semantic
cases measure retrieval quality, including misses, without declaring release readiness.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile


SAMPLES = {
    "费用明细": "cost-breakdown",
    "费用总览": "cost-dashboard",
    "权限警告": "gatekeeper-warning-zh",
    "权限放行": "gatekeeper-allow",
    "手机界面": "mobile",
    "软件包管理": "package-manager",
    "应用设置": "settings",
    "工作区": "workspace",
}
CASES = [
    ("literal", "费用", ["费用明细", "费用总览"]),
    ("literal", "权限", ["权限警告", "权限放行"]),
    ("literal", "设置", ["应用设置"]),
    ("semantic", "开销", ["费用明细", "费用总览"]),
    ("semantic", "警示", ["权限警告"]),
    ("semantic", "移动端", ["手机界面"]),
    ("semantic", "偏好配置", ["应用设置"]),
    ("negative", "海洋生物", []),
]


def measure(probe, root):
    images = Path(__file__).resolve().parents[1] / "images"
    profile = root / "profile"
    profile.mkdir()

    def run(*args):
        return subprocess.check_output([probe, profile, *args], encoding="utf-8")

    names = {}
    sources = {}
    for name, source in SAMPLES.items():
        sample = root / (name + ".webp")
        shutil.copyfile(images / (source + ".webp"), sample)
        asset_id = int(run("import", sample))
        if asset_id in names:
            raise ValueError("Probe returned a duplicate asset ID")
        names[asset_id] = name
        sources[name] = {"source": source + ".webp",
                         "sha256": hashlib.sha256(sample.read_bytes()).hexdigest()}

    rows = []
    for kind, query, expected in CASES:
        result = json.loads(run("list-timing", "0", query))
        if result["next"] is not None or result["repeatCount"] != 32:
            raise ValueError(f"Incomplete timing or result set for {query}")
        actual = [names[i] for i in result["assets"]]
        rows.append({"kind": kind, "query": query, "expected": expected, "actual": actual,
                     "firstQueryMs": result["firstQueryMs"], "repeatP95Ms": result["repeatP95Ms"]})
    return {"probeSHA256": hashlib.sha256(probe.read_bytes()).hexdigest(),
            "samples": sources, "repeatCount": 32, "queries": rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("probe", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="studio-chinese-search-") as scratch:
        report = measure(args.probe.resolve(strict=True), Path(scratch))
    print(json.dumps(report, ensure_ascii=False, indent=2))
    raise SystemExit(any(sorted(row["actual"]) != sorted(row["expected"])
                         for row in report["queries"] if row["kind"] != "semantic"))

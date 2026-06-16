#!/usr/bin/env python3
"""Export CAD baseline artifacts + static viewer from a local benchmark checkout.

Usage:
    BENCHMARK_SOURCE=~/path/to/harness python scripts/build_site.py

Only CAD baseline meshes are published to the viewer.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("BENCHMARK_SOURCE", "")).resolve()
DOCS = REPO_ROOT / "docs"
VIEWER = DOCS / "viewer"
MESHES = DOCS / "meshes" / "cad"

BASELINE_RUN = SOURCE / "baseline" / "latest"
BASELINE_CONFIG = SOURCE / "configs" / "benchmark_baseline.yaml"


def copy_baseline_metrics_and_graphs() -> None:
    dest = REPO_ROOT / "data" / "baseline"
    dest.mkdir(parents=True, exist_ok=True)
    for fname in ("metrics.csv", "config.yaml"):
        src = BASELINE_RUN / fname
        if src.exists():
            shutil.copy2(src, dest / fname)
    graphs = BASELINE_RUN / "graphs"
    if graphs.exists():
        gdest = dest / "graphs"
        if gdest.exists():
            shutil.rmtree(gdest)
        shutil.copytree(graphs, gdest)


def copy_baseline_images() -> None:
    images = DOCS / "images"
    images.mkdir(parents=True, exist_ok=True)
    graphs = BASELINE_RUN / "graphs"
    if graphs.exists():
        for png in graphs.glob("*.png"):
            shutil.copy2(png, images / png.name)


def copy_cad_meshes(mesh_names: dict[str, Path]) -> dict[str, str]:
    """Copy CAD STL files; return mesh_name -> site-relative path for viewer."""
    rel_paths: dict[str, str] = {}
    MESHES.mkdir(parents=True, exist_ok=True)
    for mesh_name, src in mesh_names.items():
        dest = MESHES / src.name
        if not dest.exists() or src.stat().st_mtime > dest.stat().st_mtime:
            shutil.copy2(src, dest)
        rel_paths[mesh_name] = f"meshes/cad/{src.name}"
    return rel_paths


def resolve_mesh_files(config: dict, run_dir: Path, metrics_rows: list) -> dict[str, Path]:
    from scripts.build_sphere_viewer import resolve_mesh_path

    sphere_root = run_dir / "sphere_outputs"
    out: dict[str, Path] = {}
    for mesh_name in sorted(p.name for p in sphere_root.iterdir() if p.is_dir()):
        out[mesh_name] = resolve_mesh_path(mesh_name, config, metrics_rows)
    return out


def build_baseline_viewer() -> None:
    sys.path.insert(0, str(SOURCE))
    from scripts.build_sphere_viewer import (  # noqa: E402
        build_mesh_data,
        load_config,
        load_csv_rows,
        metrics_lookup,
    )

    base_cfg = load_config(BASELINE_CONFIG)
    methods = list(base_cfg.get("methods", ["foam", "morphit-v", "morphit-b"]))

    base_rows = load_csv_rows(BASELINE_RUN / "metrics.csv")
    base_ok = [r for r in base_rows if r.get("success") in ("True", "true", True, "1")]
    metrics = metrics_lookup(base_rows)

    mesh_files = resolve_mesh_files(base_cfg, BASELINE_RUN, base_rows)
    mesh_rel = copy_cad_meshes(mesh_files)

    if VIEWER.exists():
        shutil.rmtree(VIEWER)
    data_dir = VIEWER / "data"
    data_dir.mkdir(parents=True)

    static = SOURCE / "scripts" / "sphere_viewer"
    for fname in ("index.html", "style.css"):
        shutil.copy2(static / fname, VIEWER / fname)

    viewer_js = (static / "viewer.js").read_text()
    viewer_js = viewer_js.replace(
        'const REPO_ROOT = new URL("../../../", import.meta.url);',
        'const SITE_ROOT = new URL("../", import.meta.url);',
    ).replace("REPO_ROOT", "SITE_ROOT")
    (VIEWER / "viewer.js").write_text(viewer_js)

    mesh_payloads: list[dict] = []

    for mesh_name in sorted(mesh_files):
        sphere_dir = BASELINE_RUN / "sphere_outputs" / mesh_name
        if not sphere_dir.is_dir():
            print(f"  skip {mesh_name}: no sphere_outputs")
            continue

        payload = build_mesh_data(
            mesh_name,
            sphere_dir,
            mesh_rel[mesh_name],
            metrics,
            base_ok,
            methods,
            fallback_sphere_dir=None,
        )
        payload["category"] = "CAD baseline"
        (data_dir / f"{mesh_name}.json").write_text(json.dumps(payload, indent=2))
        mesh_payloads.append({"name": mesh_name, "file": f"data/{mesh_name}.json"})
        print(f"  viewer data: {mesh_name}")

    sphere_counts = sorted(base_cfg.get("sphere_counts", []))
    manifest = {
        "title": "Sphere approximation benchmark viewer",
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "methods": methods,
        "method_labels": {
            "foam": "foam (AMAA)",
            "morphit-v": "MorphIt-V",
            "morphit-b": "MorphIt-B",
        },
        "sphere_counts": sphere_counts,
        "meshes": sorted(mesh_payloads, key=lambda m: m["name"]),
        "colors": {
            "cad": "#6BAED6",
            "foam": "#E07B39",
            "morphit-v": "#9467BD",
            "morphit-b": "#1F77B4",
        },
    }
    (VIEWER / "manifest.json").write_text(json.dumps(manifest, indent=2))


def write_landing_page() -> None:
    html = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sphere Approximation Benchmark</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 920px; margin: 0 auto; padding: 32px 24px;
           background: #f4f6f9; color: #1a1a2e; line-height: 1.55; }
    h1 { margin-bottom: 8px; }
    .lead { color: #5c6370; margin-bottom: 28px; }
    .card { background: #fff; border: 1px solid #d8dee9; border-radius: 10px; padding: 20px 24px;
            margin-bottom: 20px; }
    a.btn { display: inline-block; background: #1976d2; color: #fff; text-decoration: none;
            padding: 12px 20px; border-radius: 8px; font-weight: 600; margin-top: 8px; }
    a.btn:hover { background: #1565c0; }
    img { max-width: 100%; border-radius: 8px; border: 1px solid #d8dee9; margin: 12px 0; }
    ul { padding-left: 1.2rem; }
  </style>
</head>
<body>
  <h1>Sphere approximation benchmark</h1>
  <p class="lead">Compare foam (AMAA), MorphIt-V, and MorphIt-B on eight public CAD baseline meshes.
     Use the interactive viewer to step through original geometry and sphere overlays by method and sphere count n.</p>

  <div class="card">
    <h2>Interactive 3D viewer</h2>
    <p>Step through CAD → foam → MorphIt-V → MorphIt-B with arrow keys. Select object and sphere count n.</p>
    <a class="btn" href="viewer/">Open viewer →</a>
  </div>

  <div class="card">
    <h2>CAD baseline summary</h2>
    <ul>
      <li><strong>foam</strong> — often 100% surface coverage; slowest build</li>
      <li><strong>MorphIt-V</strong> — fast; strong on convex-ish parts</li>
      <li><strong>MorphIt-B</strong> — tightest extra volume; coverage drops on concave shapes (e.g. car ~68–73%)</li>
    </ul>
    <img src="images/avg_surface_coverage_by_n.png" alt="Average surface coverage vs sphere count (CAD baselines)">
    <img src="images/avg_extra_volume_by_n.png" alt="Average extra volume vs sphere count (CAD baselines)">
  </div>

  <div class="card">
    <h2>Data</h2>
    <p>Raw metrics: <code>data/baseline/metrics.csv</code></p>
    <p>Full write-up: <a href="../README.md">README.md</a></p>
  </div>
</body>
</html>
"""
    (DOCS / "index.html").write_text(html)


def main() -> None:
    if not SOURCE.is_dir():
        raise SystemExit("Set BENCHMARK_SOURCE to a local benchmark harness checkout.")

    print(f"Source: {SOURCE}")
    print("Copying CAD baseline metrics and graphs…")
    copy_baseline_metrics_and_graphs()
    copy_baseline_images()
    print("Building viewer (CAD baselines only)…")
    build_baseline_viewer()
    write_landing_page()
    print(f"\nDone. Site root: {DOCS}")
    print("Viewer entry: docs/viewer/index.html")


if __name__ == "__main__":
    main()

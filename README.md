# Sphere approximation — benchmark results

Comparison of **foam (AMAA)**, **MorphIt-V**, and **MorphIt-B** for approximating CAD meshes with collision spheres (target: Isaac cuMotion offline planning).

## Live interactive viewer

Open the **3D viewer** from the site landing page (`docs/index.html`) after deploying static hosting.

Step through **CAD → foam → MorphIt-V → MorphIt-B** with ← → keys. Select one of eight CAD baseline meshes and sphere count n.

---

## Conclusion (CAD baselines)

| Method | Coverage | Extra volume | Speed |
|--------|----------|--------------|-------|
| **foam** | Often 100% on baselines | Highest | Slowest |
| **MorphIt-V** | Strong on simple/convex parts | Moderate | Fast (~seconds) |
| **MorphIt-B** | Drops on concave parts (car ~68–73%) | **Lowest** | Fast (~seconds) |

**foam** is the safest choice when surface coverage matters more than build time. **MorphIt-B** minimizes extra collision volume but leaves gaps on concave geometry — risky for motion planning.

VSSA was evaluated and **excluded** (too slow, fragile mesh prep, benchmark stalled on grid runs).

---

## Methods

| Method | Strength | Weakness |
|--------|----------|----------|
| **foam** | Best coverage on difficult shapes | Slow; indirect sphere count (depth/branch) |
| **MorphIt-V** | Fast, good on simple CAD | Inconsistent on concave / thin features |
| **MorphIt-B** | Tightest extra volume | Low coverage on concave / complex shapes |
| **VSSA** | Strong SOV minimization (paper) | Grid benchmark stalled; mesh prep + tuning burden |

Metrics (ε = 1 mm surface tolerance): `surface_coverage_pct`, `extra_volume_pct`, `outside_volume_pct`, `runtime_s`.

---

## CAD baseline (`data/baseline/metrics.csv`)

Eight models: bracket, car, cylinder, curve, foot, hub, mini_cow, nut at n=8, 12, 16, 24, 32.

Aggregate plots: `data/baseline/graphs/`, mirrored under `docs/images/` for the landing page.

---

## VSSA — excluded

| Issue | Detail |
|-------|--------|
| Too slow | Benchmark stalled on `vssa / bracket / n=8` |
| Mesh prep | Separate watertight manifold OBJ required |
| Fragile | GCC patches, normal sensitivity |

---

## Repository layout

```
data/
  baseline/metrics.csv, graphs/   # CAD benchmark
docs/                           # static site
  index.html                    # landing + summary
  viewer/                       # Three.js interactive viewer (CAD only)
  images/                       # aggregate CAD plots
  meshes/cad/                   # STL inputs for viewer
scripts/
  build_site.py                 # refresh site from local benchmark outputs
```

---

## Rebuilding the site

This repo holds **frozen** benchmark exports. To refresh CAD baseline data, re-run the benchmark harness locally and export:

```bash
BENCHMARK_SOURCE=~/path/to/benchmark-checkout python3 scripts/build_site.py
```

The build script exports **CAD baselines only**.

---

## Static site hosting

Deploy the `docs/` folder via GitHub Pages, internal nginx, or similar.

1. Push this repo to `main`
2. GitHub → **Settings → Pages** → Deploy from branch `main`, folder **`/docs`**
3. Viewer URL: `https://<org>.github.io/Sphere-Benchmarking/viewer/`

---

## Production pipeline

Isaac cuMotion deployment (foam → XRDF → docker) lives in a separate private production repo.

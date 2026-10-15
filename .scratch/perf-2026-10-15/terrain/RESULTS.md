# Terrain LOD and retained heap — revision 2

Before: `935cc47c6b0521a9b9927adc8e784452cbece9b8`. Tested implementation: `9c302ae88f98ea922d0319dbf0801e66d98c5813`. The previous compact-layout report remains in [RESULTS-v1.md](RESULTS-v1.md).

## What changed

The previous LOD excluded road-refinement meshes, which contain most terrain triangles, and permanently pinned whole chunks after any contact query. The new selector operates on 16×16-lattice-cell patches inside submission chunks, including the dense road geometry. Each patch has stitched full / approximately half / quarter / eighth index ranges. Every patch perimeter vertex survives at every level; incomplete cells and holes retain their original triangles.

Full detail is preserved within 100 m of the camera, with a 120 m coarsening threshold. Contact/prop queries protect only intersecting patches before sampling the original final heights, rather than pinning an entire 600 m tile. Static support pins remain for the tile lifetime. Screen-space error still includes geometric diagonal crossings and normal/colour interpolation error, with the existing Potato–Ultra budgets and 20% hysteresis. This is conservative support protection, not a claim that all visited patches will later unpin.

Patch AABBs are culled against the current camera frustum. Larger submission tiles (1,200 m fine/refined, 3,000 m coarse, subdivided at 65,535 vertices) therefore reduce draw calls without drawing every off-screen patch inside their bounds. Three.js chunk frustum culling remains enabled. Selection reuses vectors, frustum planes, level views, update-range objects and the active Uint16 index buffer. It uploads indices only when selection or patch visibility changes; it creates no per-frame geometry, arrays or attribute objects.

Immutable Uint16 LOD source ranges stay on the CPU. The GPU receives only a reusable active index buffer. The default pack stores the source ranges once as the mesh index, and reconstruction allocates the active buffer. `userData.terrainLodPatches` contains version 2 patch bounds/ranges; existing `terrainDecode`, normalized flags and full-range `terrainLod[0]` remain. No new attribute type or optional codec dependency is introduced.

The heap leak was the public `heightC` arrow closing over the builder's shared lexical context. That kept the temporary height/vertex Maps and position/normal/colour/urban JavaScript arrays alive after upload. A module-scope sampler factory now retains only terrain and its final height field. Quantized geometry and exact final contact heights are preserved.

## Fixed-pose renderer submissions

Same 960×600, 60° FOV, 16 km far plane and High preset as revision 1. These are **terrain-only** scenes with the same diagnostic Lambert material, without roads, water, props or vegetation obscuring the comparison. Source camera coordinates are in JSON. The before images are the matching quantized-baseline images committed in the before SHA. The original pre-quantization call counts are included to check that revision 2 also reverses the earlier draw-call increase.

| Map / pose | Triangles before → after | Reduction | Calls original → before → after | Evidence |
|---|---:|---:|---:|---|
| riviera / start | 281,604 → 80,224 | 71.5% | 17 → 18 → 11 | [before](lod2-before-riviera-start.png) / [after](lod2-after-riviera-start.png) / [LOD overlay](lod2-after-riviera-start-debug.png) |
| riviera / mid | 445,348 → 81,331 | 81.7% | 20 → 22 → 17 | [before](lod2-before-riviera-mid.png) / [after](lod2-after-riviera-mid.png) / [LOD overlay](lod2-after-riviera-mid-debug.png) |
| riviera / overview | 1,626,055 → 577,926 | 64.5% | 82 → 86 → 44 | [before](lod2-before-riviera-overview.png) / [after](lod2-after-riviera-overview.png) / [LOD overlay](lod2-after-riviera-overview-debug.png) |
| penteli / start | 745,770 → 125,184 | 83.2% | 13 → 18 → 13 | [before](lod2-before-penteli-start.png) / [after](lod2-after-penteli-start.png) / [LOD overlay](lod2-after-penteli-start-debug.png) |
| penteli / mid | 2,516,065 → 465,345 | 81.5% | 66 → 75 → 41 | [before](lod2-before-penteli-mid.png) / [after](lod2-after-penteli-mid.png) / [LOD overlay](lod2-after-penteli-mid-debug.png) |
| penteli / overview | 3,043,666 → 613,240 | 79.9% | 100 → 111 → 53 | [before](lod2-before-penteli-overview.png) / [after](lod2-after-penteli-overview.png) / [LOD overlay](lod2-after-penteli-overview-debug.png) |
| megara / start | 120,736 → 22,796 | 81.1% | 15 → 15 → 12 | [before](lod2-before-megara-start.png) / [after](lod2-after-megara-start.png) / [LOD overlay](lod2-after-megara-start-debug.png) |
| megara / mid | 94,217 → 12,759 | 86.5% | 12 → 12 → 9 | [before](lod2-before-megara-mid.png) / [after](lod2-after-megara-mid.png) / [LOD overlay](lod2-after-megara-mid-debug.png) |
| megara / overview | 129,419 → 46,440 | 64.1% | 25 → 25 → 12 | [before](lod2-before-megara-overview.png) / [after](lod2-after-megara-overview.png) / [LOD overlay](lod2-after-megara-overview-debug.png) |

Overlay: green = full; yellow = half; orange = quarter; purple = eighth. It shows the dense road corridors actually coarsening at distance. Whole-patch culling also removes off-screen submissions; triangle reductions include both LOD and this finer culling. Generated and default baked-restored groups produce identical fixed-pose counts.

Motion captures follow 67 m of the start route in 90 steps. Inspect the videos and accompanying first/middle/last frames: [Riviera](lod2-after-riviera-motion.webm), [Penteli](lod2-after-penteli-motion.webm), [Megara](lod2-after-megara-motion.webm). Software rendering controls wall-clock playback speed; these are visual-transition evidence, not frame-rate benchmarks. Existing cut-outs visible in the baseline remain visible. The source terrain palette and material were not changed by this revision. These captures exercise the common decoding material; removal of Penteli's separate legacy hillside shader override is owned by the parallel world-simplification task, outside this revision.

## GPU buffers and CPU storage

Decimal MB. GPU bytes count production vertex attributes plus the maximum active index capacity, not only the indices selected in one frame. CPU-only index ranges are reported separately, rather than hidden in the heap figure. Typed-array backing stores are external to V8 heapUsed; CPU and GPU geometry storage are distinct copies and must not be confused.

| Map | GPU geometry MB before → after | CPU-only LOD indices MB after | All CPU ArrayBuffers MB before → after | JS heap + ArrayBuffers MB before → after | Chunks before → after |
|---|---:|---:|---:|---:|---:|
| riviera | 30.990 → 30.789 | 22.757 | 49.09 → 67.63 | 288.92 → 107.63 | 120 → 59 |
| penteli | 45.435 → 44.980 | 33.859 | 68.50 → 96.89 | 385.86 → 138.53 | 116 → 54 |
| megara | 2.024 → 1.932 | 1.394 | 6.02 → 6.15 | 36.04 → 24.98 | 26 → 12 |

The CPU index working set increases to avoid uploading inactive LOD ranges to the GPU. Releasing builder data more than offsets that increase. No original Float32 position/normal/colour arrays survive solely for collision. The existing sparse Float32 contact grids retain exact final rendered heights; their backing bytes are:

| Map | Refined contact MB | Coarse contact MB |
|---|---:|---:|
| riviera | 6.696 | 0.181 |
| penteli | 9.095 | 0.516 |
| megara | 0.411 | 0.125 |

## Retained JS heap breakdown

Each map runs in a fresh Node process, with forced GC at each stage. The same harness/imports run on both SHAs. These large savings apply to retained source construction (main-thread fallback, or a live generator worker). A downloaded bake never owned the builder scratch, and generated-world workers already terminate after transfer; this is not a claim of the same heap saving in an already-restored main thread. This avoids the previous multi-map harness retaining prior iteration data. Values below are managed heap only; stage columns after modules are incremental contributions. The terrain increment includes contacts, mesh objects and LOD metadata, not ArrayBuffer backing storage.

| Map | Modules MB B → A | Map increment MB B → A | Road network increment MB B → A | Terrain increment MB B → A | Total heap MB B → A |
|---|---:|---:|---:|---:|---:|
| riviera | 11.39 → 11.40 | 3.75 → 3.73 | 2.43 → 2.42 | 222.26 → 22.44 | 239.83 → 40.00 |
| penteli | 11.39 → 11.40 | 2.88 → 2.88 | 0.99 → 0.99 | 302.10 → 26.38 | 317.36 → 41.64 |
| megara | 11.39 → 11.40 | 2.52 → 2.52 | 0.16 → 0.16 | 15.95 → 4.74 | 30.02 → 18.83 |

Independent Riviera heap-snapshot diagnostics corroborate the ownership fix (shallow retained bytes, not process heapUsed; harness/module overhead is included in “other”):

| Snapshot category | Before MB | After MB |
|---|---:|---:|
| other managed objects/code/strings | 20.62 | 19.25 |
| Map/Set and other internal tables | 95.58 | 4.89 |
| JS array element storage | 88.42 | 3.38 |
| boxed numbers | 23.29 | 1.63 |
| typed-array and buffer wrappers | 10.78 | 12.33 |
| native backing stores | 48.83 | 67.65 |

The before snapshot identifies builder context bindings `heights` (58.72 MB Map table), `vertices` (29.36 MB Map table), and `pos` / `col` / `nor` / `urb` (86.02 MB combined array backing storage), excluding their boxed values. **None of those large builder context bindings remains in the after snapshot.** See [lod2-heap-summary.json](lod2-heap-summary.json). Native backing stores are deliberately shown separately from managed heap.

## CPU costs and limitations

Process CPU ms, single observations on a busy shared VPS. GPU times from SwiftShader are not used. Source construction adds patch preprocessing; the baked path avoids that generation work. The selector benchmark visits every chunk repeatedly at a fixed pose and excludes WebGL uploads. Changing poses can add index copies/uploads, so the stationary number is not a whole-frame cost.

| Map | Source map + network + terrain CPU ms B → A | Cached decode + restore CPU ms B → A | Stationary selector CPU µs B → A |
|---|---:|---:|---:|
| riviera | 23794.6 → 52498.6 | 872.3 → 1468.5 | 64.9 → 939.3 |
| penteli | 25787.3 → 64724.3 | 1877.6 → 1440.0 | 91.5 → 2293.6 |
| megara | 2779.8 → 3775.8 | 257.3 → 218.7 | 79.5 → 265.1 |

The cached fixture uses gzip of the unshuffled default ASR1 pack, then gunzip, synchronous decode and terrain restoration. It is not a production transfer-size or whole-game boot claim. The reliable improvements are submitted triangles/draw calls and retained memory, with increased source-build/selection work explicitly reported. Static prop/contact pins can reduce LOD savings in populated gameplay; the fixed-pose comparisons deliberately retain the prior terrain-only fixture. No FPS improvement is claimed.

## Validation

Six gates run from a clean archive of the tested SHA, with npm detached and exit markers. Logs are in `lod2-gates/`.

- npm-test: PASS.
- physics: PASS.
- events: PASS.
- syntax: PASS.
- imports: PASS.
- worker-dry-run: PASS.

The suite covers road/terrain conformance, beach-above-water, tow placement, prop/render-surface grounding, physics regression and rival races. The supplementary [active-contact check](lod2-contact-check.json) samples 32 distant Megara patches after LOD selection; every exact sampled triangle is present in the active draw buffer, with maximum height difference 1.8e-15 m. New tests exercise patch-local contact protection, substantial distant coarsening, retained seam vertices, immutable source indices through the default pack, reused runtime buffers, stable-camera hysteresis and off-screen patch removal. No push or deployment was performed.

## Reproduction and codec contract

From clean archives of each SHA, with dependencies linked:

- Run `node --expose-gc .scratch/perf-2026-10-15/terrain/lod2-measure.mjs <map> <output.json>` separately for Riviera, Penteli and Megara. Copy the measurement harness from this revision into the baseline archive; it handles layouts without patches.
- Run captures through `bash tools/browser-slot.sh node .scratch/perf-2026-10-15/terrain/lod2-capture.mjs lod2-after`; camera inputs are read from `lod2-after.json`.
- Optional `TERRAIN_HEAP_SNAPSHOT=<path>` writes a V8 snapshot after the build. `lod2-heap-summary.py` documents the diagnostic grouping and context-binding checks.
- Preserve mesh `userData.terrainLodPatches` opaquely alongside `terrainDecode` / `terrainLod`, bounds, drawRange and normalized flags. The serialized index contains immutable source ranges; the loader constructs the active draw index. All vertex array types are unchanged from the compact-layout commit.

Each submission chunk owns its buffers, bounds and patch metadata. Contact protection releases with that chunk. Generation and contact installation still build the complete map; this is a tile-friendly representation, not a streaming scheduler.

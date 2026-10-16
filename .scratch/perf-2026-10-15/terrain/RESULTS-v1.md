# Terrain geometry performance — 2026-10-15

Before: `ae241145355f0b0181062bef38207cc326b7762e`. Tested implementation: `d10a6ea4ada510701555f877fa1194df62e174b8`. The benchmark archive uses the same terrain/map sources as that candidate; intervening prod commits changed unrelated release/guardrail work.

## Implementation

- 17 bytes per vertex, previously 40: Uint16 XYZ + per-chunk offset/scale; Float32 height residual; normalized Int8 XYZ normals; normalized Uint8 RGB and urban weight. The residual preserves every original Float32 height exactly. X/Z lattice coordinates also round-trip exactly. World-space procedural UVs remain derived in the shader: zero UV buffer bytes.
- Uint16 indices in bounded tiles (at most 60,003 vertices), collision-free tile coordinate keys. All LOD index ranges share one buffer, and tile bounds/layout/ranges survive the existing ASR1 worker and baked paths. The current codec gains only Int8 support; no optional asset codec is required.
- Full / roughly half / quarter / eighth triangle levels for complete non-road patches. Centre fans retain every perimeter vertex, including beside holes and adjacent LODs. Road-refinement tiles and low shoreline patches remain full detail. Screen-space error includes exact geometric overlay crossings plus footprint-scaled normal/color/urban interpolation error. Potato/Low/Medium/High/Ultra budgets: 12/8/5/3/1.5 pixels; 20% error hysteresis and 250/300 m near-detail hysteresis.
- Grounding queries pin intersecting tiles to full detail before returning their final-triangle height. Pins persist for the tile lifetime. This preserves existing static prop placement and wheel/contact heights. There is no distant alternative collision heightfield. The trade-off is deliberately limited LOD savings in populated tiles.
- Each mesh retains Three.js frustum culling and decoded world-space bounds. Runtime LOD selection reuses scratch vectors and changes drawRange only: no new objects, buffers, geometry uploads or additional LOD draw calls per frame. Serialized decoded bounds avoid rebuilding them on download restore.

## Measurement scope

Terrain-only diagnostic scenes, identical fixed camera coordinates and 960×600 / 60° FOV / 16 km far plane, High LOD preset. Start, route midpoint and overview positions are recorded in JSON. Screenshots use the same Lambert diagnostic material, lighting and terrain inputs, without roads, water, buildings or props obscuring geometry. These are terrain draw counts, not whole-game frame counts. Road/prop correctness is checked separately by the tests. Prop-populated gameplay can pin more tiles and therefore reduce LOD savings further.

All bytes below are decimal MB or exact byte counts in JSON. Geometry includes all allocated attributes and all LOD indices, not just the active level. JS heap is Node heapUsed after forced GC, excluding ArrayBuffer/GPU storage. CPU times are process CPU, not wall time; single-shot shared-VPS observations are noisy and are not evidence of a general load-speed improvement. SwiftShader GPU timings are intentionally omitted.

## Geometry and retained JS heap

| Map | Geometry MB before → after | Reduction | Chunks before → after | JS heap MB before → after |
|---|---:|---:|---:|---:|
| riviera | 58.092 → 30.990 | 46.7% | 116 → 120 | 237.72 → 238.37 |
| penteli | 90.292 → 45.435 | 49.7% | 105 → 116 | 331.58 → 332.59 |
| megara | 3.515 → 2.024 | 42.4% | 26 → 26 | 45.59 → 46.38 |

Base triangles are unchanged: riviera 2,078,540, penteli 3,053,918, megara 129,876. More chunks on Riviera/Penteli are the cost of guaranteeing Uint16 indices; this can increase draw calls while improving culling granularity.

## Actual renderer submissions at fixed poses

| Map / pose | Triangles before → after | Calls before → after | Screenshots |
|---|---:|---:|---|
| riviera / start | 281,604 → 281,604 | 17 → 18 | [before](before-riviera-start.png) / [after](after-riviera-start.png) |
| riviera / mid | 445,348 → 445,348 | 20 → 22 | [before](before-riviera-mid.png) / [after](after-riviera-mid.png) |
| riviera / overview | 1,627,271 → 1,626,055 | 82 → 86 | [before](before-riviera-overview.png) / [after](after-riviera-overview.png) |
| penteli / start | 745,770 → 745,770 | 13 → 18 | [before](before-penteli-start.png) / [after](after-penteli-start.png) |
| penteli / mid | 2,576,973 → 2,516,065 | 66 → 75 | [before](before-penteli-mid.png) / [after](after-penteli-mid.png) |
| penteli / overview | 3,049,874 → 3,043,666 | 100 → 111 | [before](before-penteli-overview.png) / [after](after-penteli-overview.png) |
| megara / start | 120,736 → 120,736 | 15 → 15 | [before](before-megara-start.png) / [after](after-megara-start.png) |
| megara / mid | 94,217 → 94,217 | 12 → 12 | [before](before-megara-mid.png) / [after](after-megara-mid.png) |
| megara / overview | 129,771 → 129,419 | 25 → 25 | [before](before-megara-overview.png) / [after](after-megara-overview.png) |

The near views preserve the full surface. The final appearance-error guard rejects the visible large color facets found during initial LOD inspection. Small shading changes from byte normals/colors and permitted distant LOD remain; the paired images expose them. Existing terrain cut-outs visible in the diagnostic are present before the change.

## Terrain load CPU and headless benchmark

Source path: map JSON + DEM decode, RoadNetwork construction and terrain build. Cached-pack fixture: gzip of the default unshuffled ASR1 pack, gunzip, synchronous decode and terrain restore (not a claim about production shuffled transfer sizes or total game boot). The headless pose fixture inventories buffers, culls chunks and invokes their LOD callbacks; its setup/inventory allocations are included, so it is not a pure runtime-frame cost. Runtime selection itself allocates no objects.

| Map | Map decode CPU ms B → A | Terrain build CPU ms B → A | Decode + build CPU ms B → A | Cached-pack decode + restore CPU ms B → A | Headless pose fixture CPU µs B → A |
|---|---:|---:|---:|---:|---:|
| riviera | 532.1 → 534.1 | 27477.6 → 23843.0 | 28009.7 → 24377.1 | 1052.8 → 937.9 | 130.5 → 149.6 |
| penteli | 329.7 → 312.3 | 25120.2 → 23238.3 | 25449.9 → 23550.6 | 1243.8 → 1372.3 | 102.2 → 102.1 |
| megara | 267.1 → 260.0 | 1283.4 → 1460.5 | 1550.4 → 1720.5 | 91.1 → 156.1 | 59.8 → 66.8 |

CPU/heap observations are mixed: the reliable win is resident geometry storage. LOD preprocessing and layout reconstruction add work, while conservative road/prop/appearance protection limits triangle savings. Do not infer an FPS gain from these results.

## Validation

Clean `git archive` of the implementation SHA above, with detached npm test and exit markers. See `gates/` for the logs and exact exits.
- npm-test: PASS.
- physics: PASS.
- events: PASS.
- syntax: PASS.
- imports: PASS.
- worker-dry-run: PASS.

`npm test` includes road/terrain and beach-above-water conformance, tow/grounding, render-surface/prop support, rival race completion, and the new integer layout / stitch / pin / screen-error / hysteresis tests. Standalone physics regress is also required. `shader.json` confirms successful real WebGL draws for standard terrain, farmland and Lambert variants. No push or deployment was performed.

## Reproduction and streaming boundary

Run `node --expose-gc .scratch/perf-2026-10-15/terrain/measure.mjs <output.json>` from a clean archive with dependencies linked. Capture through `bash tools/browser-slot.sh node .scratch/perf-2026-10-15/terrain/capture.mjs <before|after>` after copying the matching metrics to `<label>.json`. The capture server supplies an identity material wrapper on the baseline commit, where the compact-layout module does not exist. `before-final.json` / `after-final.json` contain CPU/inventory measurements; `before-browser.json` / `after-browser.json` contain actual renderer counts and browser heap snapshots.

Each tile owns its vertex/index buffers, decode metadata, bounds and LOD ranges. Contact pins are lifetime-local and release with the tile. This is a streamable representation, not a streaming scheduler: source generation and contact-grid installation still build the complete current map.

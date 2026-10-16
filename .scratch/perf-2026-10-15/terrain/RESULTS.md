# Terrain performance and watertight boundaries — revision 3

Before: `8940394cbbf49e766f1467d4f9cd431df155b52a`. Tested source: `7992658c5b1727e199984d3e176f69bb3104966d` (parent includes the documentation-only `239defc`). [Revision 2](RESULTS-v2.md) and [initial layout](RESULTS-v1.md) retain the earlier measurements.

## Outcome and implementation

The selector uses a fixed 32-patch far queue, one far chunk index splice per update, precomputed chunk spheres, squared-distance screen-space error, and chunk frustum rejection before the error test. A sparse 100 m spatial index immediately refines nearby patches; nearby changes take priority over far work. Stationary camera/configuration checks return without scanning patches. Mirror/probe passes reuse the primary camera selection. The existing quality budgets and 20% hysteresis remain. Frame-time buffers, index views and dirty-chunk storage are preallocated. Initial selection and teleports over 250 m intentionally perform a visible-chunk sweep; the driving measurements exclude startup/teleports.

Build time is reduced with dense Float64 slope-solver storage, precomputed neighbours and a typed binary heap that preserves the original arithmetic/order. LOD construction uses direct regular-grid fans and a conservative affine-residual error bound instead of quadratic triangle-edge intersections. The bound includes height, normal, colour and urban-factor interpolation. No material code changes, codec dependency, asynchronous API change, or new attribute type is required.

Terrain gaps came from inconsistent boundary heights between the coarse, fine and road-refined grids. The finer grid now supplies shared boundary vertices and heights; coarse boundary triangles are split with upward-facing, coverage-preserving triangulation. Refined road vertices remain unchanged. Transition triangles share fine submission chunks. The contact sampler reads the exact compact final triangles, including transitions, with sparse typed-array bins; it keeps no extra Float32 position surface.

Trade-off: this revision removes per-frame patch frustum compaction and culls at chunk granularity. It draws more triangles than revision 2, while retaining the original requested ≥40–60% reduction at the large-map mid/overview poses. Seam repairs add geometry/contact storage. Riviera uses smaller refined chunks to limit off-screen work; Penteli groups its fine mesh into larger chunks to avoid an extra start-line draw call. These costs are explicit below.

## CPU and map build

Fresh Node processes on this shared VPS, GC before retained-memory snapshots. Build CPU includes source-map decode, road-network setup and terrain generation. Browser/GPU wall times are not performance evidence under SwiftShader.

| Map | Decode + network + build CPU before → after | Original pre-LOD baseline | Stationary selector before → after (µs) | Driving mean / p99 / max CPU (µs) |
|---|---:|---:|---:|---:|
| megara | 3.95 → 2.02 s | — | 68.6 → 0.20 | 4.44 / 28.80 / 220.29 |
| riviera | 51.77 → 18.77 s | 23.8 s | 914.2 → 1.19 | 9.30 / 44.63 / 209.19 |
| penteli | 63.23 → 22.86 s | 25.8 s | 3172.7 → 0.71 | 9.23 / 57.58 / 123.28 |

Driving follows 1,500 route poses at 250 km/h / 60 Hz. A native `CLOCK_THREAD_CPUTIME_ID` clock measures the selector on the JS thread, avoiding scheduler delays and background-thread CPU. Warm-up precedes 1,399 measured moving frames; JSON retains every sample. Penteli meets the ≤150 µs worst-case target. Megara/Riviera have isolated higher CPU samples, shown rather than discarded. The simpler all-process stationary measurement in map JSON includes runtime/background noise; this table uses the warmed selector trace for after values.

## Fixed camera submissions

Terrain only, High, 960×600, 60° FOV, 16 km far plane. Camera coordinates are in each JSON. Generated and default raw-baked reconstruction produce identical submissions. Diagnostic Lambert shading makes geometry comparable; full-scene wedge captures below use the unchanged production terrain material.

| Map / pose | Triangles original → before → after | Reduction vs original | Calls original → before → after | Matched evidence |
|---|---:|---:|---:|---|
| megara / start | 120,736 → 22,796 → 105,253 | 12.8% | 15 → 12 → 12 | [before](final-before-megara-start.png) / [after](final-after-megara-start.png) / [LOD](final-after-megara-start-debug.png) |
| megara / mid | 94,217 → 12,759 → 82,788 | 12.1% | 12 → 9 → 9 | [before](final-before-megara-mid.png) / [after](final-after-megara-mid.png) / [LOD](final-after-megara-mid-debug.png) |
| megara / overview | 129,419 → 46,440 → 49,909 | 61.4% | 25 → 12 → 12 | [before](final-before-megara-overview.png) / [after](final-after-megara-overview.png) / [LOD](final-after-megara-overview-debug.png) |
| riviera / start | 281,604 → 80,224 → 182,930 | 35.0% | 17 → 11 → 15 | [before](final-before-riviera-start.png) / [after](final-after-riviera-start.png) / [LOD](final-after-riviera-start-debug.png) |
| riviera / mid | 445,348 → 81,331 → 239,938 | 46.1% | 20 → 17 → 15 | [before](final-before-riviera-mid.png) / [after](final-after-riviera-mid.png) / [LOD](final-after-riviera-mid-debug.png) |
| riviera / overview | 1,626,055 → 577,926 → 691,772 | 57.5% | 82 → 44 → 70 | [before](final-before-riviera-overview.png) / [after](final-after-riviera-overview.png) / [LOD](final-after-riviera-overview-debug.png) |
| penteli / start | 745,770 → 125,184 → 450,793 | 39.6% | 13 → 13 → 13 | [before](final-before-penteli-start.png) / [after](final-after-penteli-start.png) / [LOD](final-after-penteli-start-debug.png) |
| penteli / mid | 2,516,065 → 465,345 → 783,195 | 68.9% | 66 → 41 → 37 | [before](final-before-penteli-mid.png) / [after](final-after-penteli-mid.png) / [LOD](final-after-penteli-mid-debug.png) |
| penteli / overview | 3,043,666 → 613,240 → 675,219 | 77.8% | 100 → 53 → 46 | [before](final-before-penteli-overview.png) / [after](final-after-penteli-overview.png) / [LOD](final-after-penteli-overview-debug.png) |

LOD overlay: green full, yellow half, orange quarter, purple eighth. Static captures document geometry and level selection; they are not a claim about GPU frame rate.

## Retained memory and geometry

Decimal MB. GPU geometry here is the byte size of uploaded attributes plus active index buffers, not driver allocation. JS heap and ArrayBuffers are separate Node memory counters after forced GC.

| Map | Geometry MB before → after | JS heap MB before → after | ArrayBuffers MB before → after | Heap + buffers MB before → after |
|---|---:|---:|---:|---:|
| megara | 1.93 → 2.09 | 18.91 → 19.41 | 6.15 → 6.52 | 25.06 → 25.92 |
| riviera | 30.79 → 32.47 | 40.15 → 46.02 | 67.63 → 70.36 | 107.77 → 116.38 |
| penteli | 44.98 → 47.35 | 41.78 → 49.77 | 96.89 → 100.95 | 138.66 → 150.72 |

The revision-2 retention fix remains: builder Maps/temporary JS arrays are released. Original retained heap+buffers were approximately Riviera 289 MB / Penteli 386 MB. The increase from revision 2 is the sparse selector index and real transition/contact data, not retained full-precision mesh copies.

| Map / revision | Render attribute/index buffers MB | Immutable LOD source indices MB | Refined contact heights MB | Coarse/fine triangle-bin metadata MB | Other ArrayBuffers MB |
|---|---:|---:|---:|---:|---:|
| megara / before | 1.93 | 1.39 | 0.41 | 0.12 | 2.29 |
| megara / after | 2.09 | 1.40 | 0.41 | 0.45 | 2.17 |
| riviera / before | 30.79 | 22.76 | 6.70 | 0.18 | 7.21 |
| riviera / after | 32.47 | 22.81 | 6.70 | 1.32 | 7.06 |
| penteli / before | 44.98 | 33.86 | 9.10 | 0.52 | 8.44 |
| penteli / after | 47.35 | 33.97 | 9.10 | 2.56 | 7.98 |

Other buffers include the source DEM, road-network input and runtime/module data. Contact heights preserve the exact final Float32 height values; normals/positions/colours retain their existing compact layouts.

## Wedge evidence and regression coverage

- Riviera quarter route: [before](final-wedge-before-riviera.png) / [after](final-wedge-after-riviera.png).
- Penteli mid route: [before](final-wedge-before-penteli.png) / [after](final-wedge-after-penteli.png).
- Boundary audit found gaps up to 25.58 m. Before rays passed through a gap and hit the underside of farther terrain; after front-face and double-sided nearest intersections agree. This was not a material decoder problem or all LODs being rendered together.
- Synthetic coverage tests verify preserved area, upward winding, continuous shared heights, unchanged finer vertices and exact ray/contact agreement. Cell-derived boundary extraction is checked against exposed triangle edges. Real-map road tests include the known failing screenshot sightlines.
- Dense slope-solver output is checked exactly against the old implementation on 50 sparse randomized grids. Selector tests cover bounded work, stationary skips, auxiliary cameras, index contents and hysteresis.

## Clean archive gates

- npm: 0
- physics: 0
- events: 0
- syntax: 0
- imports: 0
- wrangler: 0
- Baked riviera equality test: 232.60 s (lead-reported before: 881 s; aspirational target <120 s).
- Baked penteli equality test: 153.61 s.

Gate logs and exit markers are in `final-gates/`. The full npm run includes beach, tow, props, road/terrain, physics and rival coverage; the separate physics/events gates are also required. No push or deploy was performed (Wrangler was dry-run only).

The landing integration preserves upstream tile GPU sharing, notices and vehicle changes through `6c89a4a`. A broader audit also found small pre-existing interior coverage voids (314 Penteli cells); their separate correction and whole-map coverage guard are in progress. The large sightline wedges above are fixed in this source.

# Athens physical-surface stage 1 — 2026-10-18

The road-height selection blocker is repaired in the generator. This is a finite three-cell development regression set, not the connected Athens world. Nothing is added to the player map picker; the four current maps are untouched. The owner decision is recorded as **Athens open world resumed; dev-flagged until owner activates**.

The fix blends all overlapping same-layer road influences and all segments within a road continuously. A deterministic global eight-metre lattice, filtered symmetrically before clipping, supplies the road/shoulder planes. The tessellator includes those plane diagonals so centimetre-wide polygon slivers cannot turn a curved height sample into a wall. Global support and query halo keep adjacent cells consistent. Emitted contacts supply graph and spawn heights. Affine grades survive the filter; the final graph also retains the existing 20% grade ceiling. Layered roads are still rejected explicitly rather than silently flattened.

## Physical evidence

| Cell | Asphalt triangles >30° | Maximum asphalt | Maximum shoulder step | Maximum shoulder slope | Maximum graph grade |
|---|---:|---:|---:|---:|---:|
| Glyfada [4,25] | 0 / 5,718 | 8.682° | 3.271 cm | 7.455° | 13.084% |
| Glyfada [5,25] | 0 / 6,194 | 8.430° | 3.006 cm | 6.856° | 14.264% |
| Riviera [8,36] | 0 / 2,841 | 11.754° | 4.868 cm | 11.018° | 19.435% |

781,879 six-metre shoulder samples include exposed junction boundaries, sampled every <=2 m along the boundary and every 0.25 m outwards. Zero missing emitted contacts within the fixture bounds; coarse/fine fallback is disabled for this audit. The 6,921 samples outside finite fixture bounds are explicitly excluded; adjacent regional coverage is still required for a connected-world claim. Asphalt slope checks cover every asphalt contact triangle. Rendered top, fine and contact triangle sets are identical.

The solve changes original profile sample elevations by RMS 0.302 / 0.331 / 0.411 m for the three cells (maximum 1.227 / 1.248 / 1.781 m). It preserves the grade bound and affine grades, not every original DSM-derived station height. Spawn/tow and graph heights are resampled onto the final emitted road. See [source-profile displacement](source-profile-displacement.json).

The adjacent Glyfada pair passes exact shared-edge signatures. 2,048 contact comparisons along the seam have maximum height difference 2.18e-8 m. All 280 anchors support a 14 x 3 m vehicle body wholly on public road with 3 cm margin and no building overlap. Anchor/contact disagreement stays below 0.000002 m. No anchor or road is emitted for a different layer.

[Surface, seam, graph and byte measurements](stage1-audit.json), [anchor body/contact audit](anchors.json), [source SHA-256 verification](source-verification.json), [bake inputs and timings](bake-provenance.json).

## Extent and bytes

Three 512 m cells cover 0.786432 km² and contain 16.553 km of unique clipped roads, 422 directed edges, 241 graph nodes and 11 turn rules. The Glyfada pair is adjacent; the Riviera cell is separate. The packed development fixtures total **2,357,640 bytes (2.25 MiB)** and remain under `.scratch/athens-resume-2026-10-18/development-world/`; the release allowlist excludes this directory and the manifest is `developmentOnly: true`, `releaseReady: false`. No raw OSM, DEM or regional DB is committed.

Measured packet residency per cell is 1.63–3.46 MiB including GPU geometry, contact indexes, backing arrays and serialized metadata estimate. Array backing alone is 1.10–2.32 MiB, contact indexes 0.21–0.37 MiB, GPU geometry capacity 0.30–0.74 MiB. Conservative resident reservations are 6.06–12.71 MiB and transient reservations 12.55–26.35 MiB. These are byte-accounting measurements/reservations, not total JS heap or process peak measurements. Browser/driver memory, traffic and player physics are not included.

## Verification and visual inspection

Core overlap/tie/support/hairpin/global-plane regressions run in `npm test`, together with synthetic asphalt, shoulder, missing-contact and profile-grade failures. The packer now rejects physical failures before publishing its entries index. `ATHENS_WORLD_SPOOL=/path/to/three-cells.ndjson node --test tools/world-gen/conformance.test.mjs` runs the real-data gate. Existing road-terrain-level and tow-road-placement tests remain in the normal suite. Targeted Node tests: 11 pass; Python geometry/ingestion tests: 26 pass; real-data conformance test: pass. Full `npm test` passed on clean `git archive` candidate `4d33763c0e6ffe23bd3e1839d8bf67476f11fb86`: 1,573 passed, 7 skipped, zero failed across all four groups (1,239.5 seconds on the shared host). The opt-in real-cell conformance gate passed separately. This tested commit is retained as a parent of the integration commit so subsequent unrelated UI changes are not mistaken for the tested snapshot. The additional standalone physics regression passed all 1,261 checks; browser import validation passed for 265 modules. Additional integration verification is recorded in the durable handoff.

## Inspected screenshots and offline browser measurements

Inspected [Glyfada overview](glyfada-probe-glyfada-overview.png), [street](glyfada-probe-glyfada-street.png), [junction](glyfada-probe-glyfada-junction.png), [Riviera coastline context](riviera-probe-riviera-coastline.png), [Riviera street](riviera-probe-riviera-street.png), and the [Glyfada](glyfada-probe-glyfada-mobile.png) / [Riviera](riviera-probe-riviera-mobile.png) phone-size views. Roads and junctions have continuous tops and shoulders without the former vertical slivers. The fixture edges visibly terminate in empty space because neighbours are absent. The coastline view deliberately shows the coastal cell context: coast clipping/water are not emitted yet and must be added in stage 2. Sparse colour variation and plain OSM boxes retain the low-poly style.

| Single-cell probe | Local fetch/inflate | First render | Desktop render CPU median / p95 | Phone-size, 4× CPU throttle median / p95 | Reported desktop JS heap |
|---|---:|---:|---:|---:|---:|
| Glyfada [4,25] | 249 ms | 672 ms | 0.6 / 10.6 ms | 5.1 / 37.5 ms | 9.89 MiB |
| Riviera [8,36] | 92 ms | 587 ms | 0.4 / 4.9 ms | 1.4 / 11.8 ms | 7.59 MiB |

Measurements use 60 render submissions per mode, 1280×800 desktop and 390×844 phone viewport, DPR1, on shared-VPS **SwiftShader**. These are CPU submission samples, not end-to-end frame/GPU timings; the slow Glyfada phone p95 does not establish mobile playability. Reported JS heap is not total CPU/backing/process memory. Local load includes decompression, decode, validation and scene construction, without WAN latency. No player car, traffic, collisions or whole-world streaming is running. Both pages reported zero errors; browser and private random-port server were closed after capture. Raw measurements: [Glyfada](glyfada-probe-browser.json), [Riviera](riviera-probe-browser.json).

## Stage 2 inventory — approval required before baking

[Read-only inventory](inventory.json) and [storage calculation](storage-estimate.json) propose a conservative continuous rectangle x=0..9, z=25..36: **120 cells / 31.457 km²**, plus **7 known building-owner dependency cells**. It contains **276.065 km of road**, **6,389 directed graph edges**, **5,814 building owners**, **2,611 explicit vegetation points** and **21.514 km of coastline**, including offshore pieces. Vegetation area scatter is not yet counted and must be capped by quality tier. A directed graph path connects the two fixture areas, but turn-aware legal driving remains to be verified.

Two layered roads intersect cell [7,29]. The current ground-only emitter refuses that cell; stage 2 must first solve the layer/clearance problem. Building dependency closure may add a few cells or require separating scenery ownership from mandatory ground loading.

Storage request: **1.5 GiB incremental peak disk reservation**, including one <=720 MiB clean archive, <=64 MiB current-cell spool/decode scratch, 256 MiB local structure/evidence allowance, <=192 MiB final packed assets, one <=192 MiB publication/validation copy and 112 MiB margin. No source downloads or regional database copies. Process one cell at a time and delete its spool after validation. At the largest current fixture size, 127 cells would compress to 118 MiB; allowing 50% for coastline, vegetation, structures and density variation gives 177 MiB, rounded to a proposed **192 MiB shipped-asset ceiling**. This is an estimate and ceiling, not a measured complete-world size. Stop and re-estimate if exceeded.

The shared mobile budget is unchanged: 64 MiB resident stream, 64 MiB transient, concurrency one, all subsets of JS/GPU totals. Current conservative reservations permit only five dense fixture cells; nine would reserve 114.4 MiB. Stage 2 must split/reduce payloads or reconcile reservations against measured retained CPU/GPU/decode storage and prioritise mandatory ground/contact before scenery. A nine-cell safety set requires <=7.11 MiB per admitted cell. Do not raise the cap. The mobile agent confirmed that nine measured largest-cell packets total 31.15 MiB, or 38.94 MiB with a provisional 25% allowance, so current manifest over-reservation is the immediate admission obstacle. Resident JS backing/contact/metadata is 2,856,689 bytes per largest cell; its 772,668 GPU bytes belong to the separate GPU budget and must not be counted again in total JS. Stage 2 should separate resident admission from the existing decode/transient ceiling and keep 27,627,386 bytes transient with concurrency one until overlap peaks are measured. Full desktop and throttled-phone game frame time, traffic, process peak and network load measurements are stage-2 gates; this offline fixture cannot establish them.

The mobile agent's fresh legacy Riviera construction probe still retains approximately 393 MiB JS heap/backing and 253 MiB scene geometry/textures, already above phone targets. The Athens load path must replace/unload legacy map geometry, contacts, buffers and owned GPU resources before admitting streamed cells; 64 MiB is not an extra allowance on top. Shared vehicle/assets/render targets still count in total budgets. Physical mobile tools are unavailable on this host. A SwiftShader touch/motion check at approximately 0.09 fps cannot certify phone 30 fps or a complete lap.

No stage-2 bake is authorized until the lead confirms this storage inventory. No player-facing activation is proposed yet: the connected-world prerequisite has not been met.

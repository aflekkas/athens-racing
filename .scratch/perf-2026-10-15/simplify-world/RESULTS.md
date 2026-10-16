# Simplified world evidence — 2026-10-15

Baseline: 80713013bb92c92475378058d7ceb51c8c6f0733. Measured source: 16a61bbfe02ca02bf23fdd6a25ec36dbc60a620c (frozen candidate; final production commit adds only evidence, changelog notes and the corrected release WebP to this measured source). Comparison also includes the terrain agent’s independently landed patch-LOD/batching changes between baseline and this candidate; reductions are combined, not solely attributable to art changes.

Owner-directed visual change: vegetation and all beach furniture removed; mountains retained with calm earth/sand colours; mapped building footprints become plain, flat-roof block extrusions (≤40 triangles); street objects and articulated pedestrians become blocky versions of real objects. No car, cockpit or vehicle-wheel geometry changed. Generated building infill disabled. Guardrails, racing signs, roads, traffic, pedestrian policies and road/ground contacts retained.

## Method

Real buildMapWorld scene, high quality, uncached generated world (?nobake), 960×600 fixed camera poses, same camera/lighting harness for both versions. Final capture explicitly selects the Effects Off water material through simplifyScenery; its blue output is independent of sky/reflection inputs, tested with an uninitialized sky cube. Baseline used the original water shader with the uninitialized reflection input. Controlled hemisphere/directional afternoon and night lighting, plain sky background. All scene LODs remain enabled: counts are conservative populated-world/frustum counts, not gameplay distance-LOD counts. No moving simulation, so traffic/pedestrians remain at initial state. SwiftShader timing is not a GPU benchmark. Whole-world totals count every instantiated geometry including available LODs; bytes count unique geometry buffers plus instance matrices/colours, excluding textures. Full camera coordinates and render counters are in before-browser.json and after-browser.json.

Owner screenshot exact location could not be established; owner-candidate is route quarter-distance, explicitly unverified. Baseline Penteli has a material override/quantized-decoder defect visible as sky-coloured ground gaps; removed override fixes this without changing elevation buffers.

## Whole-world geometry

| Map | Triangles before → after | Reduction | Geometry bytes before → after | Reduction |
| --- | ---: | ---: | ---: | ---: |
| riviera | 15684074 → 6082647 | 61.2% | 446959416 → 398651222 | 10.8% |
| penteli | 9354377 → 4632426 | 50.5% | 142523366 → 126701974 | 11.1% |
| megara | 5359496 → 2208183 | 58.8% | 66240010 → 51792413 | 21.8% |

## Fixed-pose rendered counts

| Map / pose / light | Calls before → after | Triangles before → after |
| --- | ---: | ---: |
| riviera / start / afternoon | 390 → 126 | 1735160 → 688868 |
| riviera / start / night | 380 → 116 | 1665894 → 619602 |
| riviera / mid / afternoon | 228 → 83 | 1606325 → 654703 |
| riviera / mid / night | 213 → 68 | 1472535 → 520913 |
| riviera / overview / afternoon | 2223 → 937 | 9347636 → 3271195 |
| riviera / overview / night | 2223 → 937 | 9347636 → 3271195 |
| riviera / owner-candidate / afternoon | 1000 → 451 | 4273386 → 1487154 |
| riviera / owner-candidate / night | 995 → 446 | 4245166 → 1458934 |
| penteli / start / afternoon | 152 → 60 | 1615588 → 422928 |
| penteli / start / night | 152 → 60 | 1615588 → 422928 |
| penteli / mid / afternoon | 823 → 286 | 5818248 → 1765610 |
| penteli / mid / night | 823 → 286 | 5818248 → 1765610 |
| penteli / overview / afternoon | 1306 → 404 | 7995867 → 2465738 |
| penteli / overview / night | 1306 → 404 | 7995867 → 2465738 |
| penteli / owner-candidate / afternoon | 524 → 191 | 3564628 → 1331132 |
| penteli / owner-candidate / night | 524 → 191 | 3564628 → 1331132 |
| megara / start / afternoon | 110 → 77 | 2650787 → 550679 |
| megara / start / night | 110 → 77 | 2650787 → 550679 |
| megara / mid / afternoon | 84 → 52 | 1474305 → 335422 |
| megara / mid / night | 84 → 52 | 1474305 → 335422 |
| megara / overview / afternoon | 175 → 120 | 4108992 → 989105 |
| megara / overview / night | 175 → 120 | 4108992 → 989105 |
| megara / owner-candidate / afternoon | 82 → 55 | 1666832 → 366479 |
| megara / owner-candidate / night | 82 → 55 | 1666832 → 366479 |

## Texture library

Requests 32 → 16; source WebP bytes 3193122 → 1772090 (44.5% reduction); decoded RGBA base-level estimate 61865984 → 35651584 (42.4% reduction). Excludes mipmaps, compression and HTTP headers; source bytes are local file totals, not a network trace. Codec agent will independently prune generated KTX outputs after rebasing.

Retained TX: asphalt/paver/concrete diff,nor,arm; ground diff,nor; sand/rock diff; leather nor,arm; water.

## Verification

Clean-archive npm test, physics (433/433), events (11/11), syntax (285 modules), browser imports (224 modules), and staging dry-run gate logs and exit markers are under `.scratch/simplify-world/gates/`. Focused budget, bare-beach, hillside, Penteli, tunnel, blue-water and label-fit tests are included. Owner guard is wired into npm test. Budgets live in src/world-art-direction.js. Beach stair flights retain 18 collision-aligned steps with a separate 256-triangle budget.

## Screenshots

Paired PNGs and contact sheets are in .scratch/simplify-world/. All 3 maps × start/mid/overview/owner-candidate × afternoon/night × before/after. Release WebP derives from after-riviera-start-afternoon.png. Corrected start views were inspected in both lighting conditions: the sea is blue and the complete RIVIERA RUN · START label fits. Exported label atlases accompany the world captures.

## Known pre-existing terrain caveat

The terrain owner and lead confirmed sky-coloured distant terrain wedges are present in baseline 935cc47 captures, before this simplification. They remain visible in `.scratch/simplify-world/after-penteli-mid-afternoon.png` (far left) and `after-riviera-owner-candidate-afternoon.png` (right hillside). The terrain owner will address that separate defect after this lands. This change preserves terrain geometry and elevation/contact data.

Visual inspection: all 48 before/after world captures were reviewed through the three paired contact sheets; corrected Riviera start day/night and Penteli/Megara road-level captures were also viewed at full size. `labels-contact.png` contains the exported speed, direction and event atlases reviewed for text fit. The release WebP was separately inspected.

# Psychiko Faros Circuit v3 — 2026-10-19

The active course supersedes all historical courses below. It is **5,732.284 m**, two race laps, start/finish on the Faros at-grade signal approach. A/B rings and their short internal connectors stay fully open; every other public side-street exit is closed only during a race. All six raced rings and every network ring are one-way CCW; reverse racing stays disabled.

[Implementation D report](../../../.scratch/psychiko-realism/impl-d/README.md) contains the exact turn/way list, naming decisions, field/profile statistics, fixed-world-pose Low/High/full-game performance, clean-archive gates and limitations. [Route overlay](../../../.reference/psychiko-realism/impl-d/route-overlay.webp) (local-only, git-ignored) and seven matched game/Street View panes (local-only in `.reference/psychiko-realism/impl-d/`) supplement the headless onboard frame strip. The release picture is the native game canvas at 1280 × 800, WebP quality 75, without harness UI.

New local records use `.faros-v3`; native/Worker board versions use `:faros-v3`. Existing route fingerprints keep old ghosts and incompatible multiplayer clients out. All map/terrain/route/profile/preview outputs are rebuilt twice and the second pass must be byte-identical. Spawn-road data and both the map selector and named Faros/Elikonos free-roam spawns are refreshed.

The final gates run on a clean archive of the committed candidate with existing node_modules symlinked. They include npm test (only the three explicitly accepted upstream failures), 1,261 physics regressions, syntax/import graphs, source validator, focused Psychiko/ring checks, a full production-physics AI lap with zero off-road/island/clockwise frames, and Wrangler staging **dry-run**. See the report's gate table/logs; no push, PR edit or deployment is performed.

---

# Psychiko realism verification — 2026-10-19

Worktree `psychiko-realism`, branch `vas-per/psychiko-realism` (base `8351f10`). No push or deployment. Headless only: one SwiftShader Chromium at a time, each stopped by its own handle; evidence (small `.webp`/JSON) in the ignored `.scratch/psychiko-realism/impl-a/`.

## Result

- **Elevation:** one Copernicus GLO-30 field (sigma-20 m) for lap, streets, junctions, rings and terrain. Lap 178.5–239.4 m (was 185.0–239.9), ascent 79.0 m/lap (was 61.9), peak 20 m grade 12.2% up / 13.1% down (was 8.4% / 8.4%), 60 m 12.5%; runtime conformance is a no-op (validator). Steepest street Ouranou 30.2% over 20 m, matching the elevation research; no side-street step exceeds the field grade by 6% over 6 m (was 25–45% next to the lap). Terrain clears every road and shoulder (rendered-terrain scan); race closures follow the street slope.
- **Direction:** no reverse Psychiko course anywhere (setup, events, server, lobby). Racing line, every network ring part and a 6,000-frame free-roam traffic simulation never move clockwise; no civilian runs against a one-way lap street (Areaki approaches included). Eleftherias is a ring (rim pieces only; approaches stay two-way). Arrows, give-way lines and P-1/P-40 signs at every public ring entry and mini-roundabout 351945852; Athens College 31270034 untouched. Border island 31486890 no longer self-intersects.
- **Coverage:** 25is Martiou 97722996 and Stefanou Delta 97723003/790219496 restored (448 network road parts, 62.31 km; was 445, 62.16 km). 15 municipal building relations (50 ≤10-vertex blocks, courtyards open), Stefanou Delta stadium 3000647 and tracks, Attiko Alsos 1741088. Kifisias tunnels 25117418/113339568/113339581 still omitted (no grade separation).

## Checks (clean `git archive` of the candidate)

| Check | Result |
|---|---|
| `npm test` | 2,240 / 2,253 pass, 10 skipped, 3 fail in 2 files: `garage-cards` (browser bounds) and `traffic-race` (Riviera afternoon / rush hour). The **same three fail on clean 8351f10** (2,233 / 2,246). |
| Physics regression | **1,261 passed, 0 failed** |
| Browser imports / syntax | 291 modules / 372 modules |
| `validate.mjs`, events, ghost lap | pass; 12 / 10 pass |
| Offline rebuild `route.mjs && build.mjs && build-detail-records.mjs` | `map.json`, `terrain.bin`, `route.json` and every other map bundle byte-identical |

## Performance (identical harness and poses, `.scratch/psychiko-realism/coverage/bake-baseline.mjs` + `perf-browser.mjs`, 960×600)

| Class | Pose | Draw calls before → after | Triangles before → after |
|---|---|---|---|
| Low | start | 228 → 229 | 1,640,257 → 1,645,963 (+0.35%) |
| Low | mid | 312 → 313 | 922,640 → 928,789 (+0.67%) |
| Low | overview | 1,808 → 1,811 | 1,739,436 → 1,747,416 (+0.46%) |
| High | start | 231 → 233 | 1,597,691 → 1,601,473 (+0.24%) |
| High | mid | 319 → 319 | 883,866 → 886,891 (+0.34%) |
| High | overview | 1,836 → 1,839 | 2,131,490 → 2,144,164 (+0.59%) |

Side-road pack 1,074,658 → 1,087,238 triangles (+1.2%; three restored streets, 1.5 cm road chord tolerance on Psychiko's hills); terrain pack 1,135,069 → 1,135,513 triangles. Downloads (gzip): terrain.bin 130 → 160 KB (same 361×381 grid, more real relief), roads pack 27.95 → 28.62 MB, terrain pack 7.69 → 8.07 MB, map.json 378 → 390 KB. In-game fixed-pose detail budget (Psychiko mid): 407 → 406 draw calls, +0.65% triangles.

# Psychiko drawn-loop verification — 2026-10-15 (historical)

Worktree: `t3-ff227117`, branch `psychiko-track`. No push or deployment. All browser captures used headless Chromium; the private server used port 8117 and was stopped with its browser after capture. Other worktrees' servers were untouched.

## Result

- `psychiko-race`: **5,960.933287659299 m/lap**, two laps (**11,921.866575318598 m**), three rivals.
- `free:psychiko`: shared untimed free roam with traffic/street life; **82,280.73 m / 564 parts** of surrounding surface roads, plus the primary route. The original **4,285.748891 m** course remains drivable and its source route/DEM are preserved. It is not a second race event.
- `psychiko-tt`: one lap (**5,960.933287659299 m**), disabled.
- **92 outgoing junction half-edges / 92 roadworks closures**. One short connector has two route-facing mouths; an independent graph-degree test caught the need to count both.
- **3,507 mapped buildings**. No Street View scenery changes from the separate research folder.

## Checks

All final checks passed:

| Check | Result |
|---|---|
| `npm test` | **688 passed, 1 existing skip, 0 failed** across 689 Node test cases; rival simulation also passed all three route scenarios |
| Physics regression | **172 passed, 0 failed** |
| Event framework | **11 passed** |
| Focused Psychiko tests (included in npm test) | **9 passed** |
| Surrounding-network tests (included in npm test) | **11 passed**, reproducing all four saved networks |
| Syntax | **210 modules** |
| Browser imports | **172 modules** |
| Maps traversal/physical drive/unload | All **4 maps** passed, plus circuit seam/gantry checks |
| Resource ownership checks | Both checks passed |
| Psychiko and Penteli source validators | Passed |
| Offline Psychiko rebuild | `route.mjs && build.mjs && validate.mjs` reproduced map JSON and terrain binary byte-for-byte |
| Riviera/Megara/Penteli bundles | All **6** original map/terrain file SHA-256 hashes unchanged |
| Cloudflare staging dry-run | Passed; no authentication/login, push or deployment |
| Actual packaged split download | Reassembled/decoded **78 road meshes / 1,007,879 triangles**, same Psychiko grid and metadata |

The collision test runs real vehicle physics at 90 km/h at three lateral positions against every closure, then repeats the paths with the colliders absent: **276 blocked / 276 open runs**. Separate tests cover race → free → race visual/collider changes, collision-hash invalidation and clearance from the full raced carriageway. The source-coverage test explicitly inventories the three unsupported tunnel ways below rather than silently claiming they render.

The expanded roads compress to **26,267,861 bytes**, just above Cloudflare's per-file cap. Packaging splits that unchanged gzip stream into **20,971,520** and **5,296,341** byte files. Existing smaller map bakes retain their original single-file format. The loader has a split-download test, including recovery from a missing piece; an additional check decoded the actual generated deployment files.

## Headless evidence

All files are ignored local artifacts under `.scratch/psychiko-v2/`:

- `route-overlay.png`: final smoothed OSM route in cyan over the supplied red drawing; personally inspected alongside `match1.png` and the original photograph.
- `race-start.png`: primary race at the Diamantidou timing line.
- `roadworks-junction.png`: solid water-filled barriers, striped rail, cones and `ΕΡΓΑ · ΚΛΕΙΣΤΟ` sign across a side street.
- `free-roam-side-street.png`: car on asphalt approximately **150.71 m** off the primary route, without closures.
- `minimap.png`: cropped in-game minimap showing the surrounding streets.
- `browser-report.json`: final live game reports **92 visible/colliding race blocks**, **0 free-roam blocks**, civilian traffic enabled with **12 active vehicles**, and **0 page errors**.
- `final-browser-proof.log`, `npm-final.log`, `physics-regress.log`, `events.log`, `syntax.log`, `imports.log`, `maps.log`, `map-resources.log`, `network-tests.log`, `psychiko-tests.log`, `validate.log`, `penteli-validate.log`, `wrangler-final.log`, `deploy-split-proof.log`, `reproduce-result.log`, `unchanged-result.log`, `final-bundle-sha256.txt`.

Software-rendered Chromium was slow under concurrent local workloads. Earlier capture attempts timed out or lost the page; final captures used paused animation and direct production-scene rendering and completed successfully. This is visual/collision evidence, not a hardware-GPU frame-rate benchmark.

## Remaining limits

The photographed, thick freehand drawing is approximately georeferenced; the exact connected OSM street/roundabout choices are an interpretation rather than a survey. Three short northern residential ways have no explicit OSM surface tag and are inferred paved. The closed fictional course intentionally reverses some one-way segments.

The shared at-grade road system omits three Kifisias tunnel ways along the eastern edge, outside the drawn loop: `25117418`, `113339568`, `113339581` (two touch the municipal boundary). Their underpasses require a separate grade-separated reconstruction. All other selected public source ways have rendered road parts or are on the primary course. Facades, widths, gardens and planting remain representative; the separate `.scratch/psychiko-streetview/` research has not been applied.

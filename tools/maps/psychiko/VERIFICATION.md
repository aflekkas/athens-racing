# Psychiko drawn-loop verification — 2026-10-15

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

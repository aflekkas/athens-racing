# Psychiko realism implementation C

Branch `vas-per/psychiko-realism`, base `1a5dfbd6`; implementation commit `bf48a56f`. Local commits only; no push, PR or deployment. All browser captures use headless Chromium/SwiftShader. Work and temporary archives remain inside this worktree.

## Changes

- A9/A8 avenues have staggered mature pine/broadleaf footway rows at roughly 7.5 m spacing. Trunks stay outside the race carriageway; crowns overlap above it. Geometry stays merged into the existing streamed canopy cells.
- The lap's surveyed solid paint has two 12 cm lines, 24 cm clear separation and continuous, lightly worn ink. D8/T10 keep dashed lane dividers; unmarked classes and rings stay unmarked.
- Kerb parking continues beside the start grid, entirely outside its lanes, with gantry/mouth/ring/crossing gaps. Whole oriented bodies are checked against the race lane and islands; tree-pit bays stay clear. Eleven cars fit beside the first 130 m after exclusions. Residential kerb parking retains a usable central carriageway.
- A square / B square / Kamara / Areaki / Eleftherias receive respectively 13 / 11 / 8 / 5 / 14 mature trees plus shrub beds and interrupted low perimeter hedges. Positions are estimates from the survey notes inside the actual inset polygons, with clear centre/path corridors. Other surveyed public islands also receive appropriate planting. Gated college planting is unchanged.
- Ring goosenecks stand on the outer kerb. Generic lap lamps are omitted on ring arcs. Full-size painted circulation arrows are 4.2 m × 1.5 m, retaining CCW tangents; mini-roundabout arrows keep their original size.

## Survey-matched views

Left panes: game, High preset, headless; right panes: **Street View © Google**, reference only. Latitude/longitude, heading and horizontal FOV match the saved stations; camera height is an approximate 2.5 m. Imagery remains in research evidence and is never read by the builders or shipped by deployment.

- [S07, Diamantidou start straight](sbs-S07.webp)
- [S16, Benaki](sbs-S16.webp), [S03, Pavlou Mela](sbs-S03.webp)
- [S20, Taygetou](sbs-S20.webp), [S21, Vasileos Pavlou](sbs-S21.webp), [S22, Kyprou](sbs-S22.webp), [S23, A square](sbs-S23.webp)
- [Kamara](sbs-R25053106-2.webp), [Eleftherias](sbs-RELEF-2.webp), [Areaki](sbs-R634346640-2.webp), [B square](sbs-R25053533-2.webp)
- [P0414, Diamantidou/Samara](sbs-P0414.webp), [P0483, Benaki](sbs-P0483.webp), [P1025, Taygetou](sbs-P1025.webp)
- [Full-game fixed mid camera, before/after](fullgame-mid-before-after.webp)
- [Five square gardens, overview](island-gardens.webp) · [capture metadata](harness/gardens.json)

Capture metadata: [stations](harness/stations.json), [station renders and zero browser errors](harness/final.json). The harness is adapted from impl-b with the same production `buildMapWorld`, camera poses and render settings.

## Performance

[Measured Low/High comparison](performance.json), [before](harness/perf-before.json), [after](harness/perf-after.json). Fixed 960×600, SwiftShader, no traffic/player/HUD/post, race closures enabled. Low uses its real 0.8 pixel ratio, 1,000 m draw distance and chunk scale 3; High uses 1.0, 2,000 m and scale 1.5. Timing/FPS is not representative on SwiftShader under concurrent gate load, so no FPS claim.

| Preset | Pose | Calls before → after | Triangles before → after | Triangle delta |
|---|---|---:|---:|---:|
| Low | start | 231 → 231 | 1,514,466 → 1,520,333 | +0.39% |
| Low | mid | 315 → 315 | 854,289 → 855,210 | +0.11% |
| Low | overview | 1,812 → 1,812 | 1,650,297 → 1,650,253 | −0.003% |
| High | start | 238 → 238 | 1,613,838 → 1,624,735 | +0.68% |
| High | mid | 323 → 323 | 886,267 → 888,368 | +0.24% |
| High | overview | 1,841 → 1,841 | 2,092,803 → 2,093,547 | +0.04% |

The separate **full-game** fixed mid camera reproduces the supplied 399–410-call baseline exactly. [Before](detail-before.json), [final](detail-final.json), [canonical gate](detail-budget-clean.log):

| Time / camera | Detail | Calls before → after | Triangles before → after |
|---|---|---:|---:|
| Day chase | Off | 399 → 399 | 740,799 → 740,799 |
| Day chase | On | 408 → 408 | 797,881 → 798,838 |
| Night chase | Off | 401 → 401 | 741,759 → 741,759 |
| Night chase | On | 410 → 410 | 798,841 → 799,798 |
| Day cockpit | Off | 362 → 362 | 734,303 → 734,303 |
| Day cockpit | On | 372 → 372 | 799,773 → 800,326 |
| Night cockpit | Off | 364 → 364 | 735,263 → 735,263 |
| Night cockpit | On | 374 → 374 | 800,733 → 801,286 |

Maximum full-game triangle growth is **+0.12%**; all measured call growth is **0%**, below the +5% / +10% limits. Full-game terrain selection is reset before every capture; its representation/cameras differ from the baked-world Low/High harness, so their absolute totals are not interchangeable. The requested `.scratch/psychiko-realism/impl-a/detail-budget.mjs` was rerun after implementation; `.scratch/detail-pass/budgets.json` is refreshed and force-added.

## Gates and rebuild

Source gates ran on a clean archive of implementation tree `6a59e6caa44c6ac4d94a01923afa7b1494aca3b9` (the tree of `bf48a56f`), with a symlink to the existing dependencies. The final budget refresh was copied into that archive and its focused budget gate rerun; it changes only measured JSON values. Evidence/report additions do not change runtime source.

| Gate | Result | Evidence |
|---|---|---|
| `npm test` | 252 files; 2,288 pass, 3 accepted failures, 12 skipped; no other failures | [log](npm-test.log) |
| Physics regression | **1,261 passed, 0 failed** | [log](physics.log) |
| Browser imports | **299 modules pass** | [log](browser-imports.log) |
| Syntax | **380 modules pass** | [log](syntax.log) |
| Psychiko validator | **Pass** | [log](validator-clean.log) |
| Psychiko + roundabout focused tests | **41 pass, 0 fail**, including whole-body parking clearance and CCW circulation | [log](focused-clean.log) |
| Rendered Psychiko terrain regression | **Pass** (included in npm test; also passed initial combined 41-test run) | [npm log](npm-test.log) |
| Detail budget | **Pass**, final map hash and captured metrics | [log](detail-budget-clean.log) |
| `npx wrangler deploy --env staging --dry-run` | **Pass**, custom bake and worker build, dry-run exits without deployment | [log](wrangler-dry-run.log) |

The dry-run also reports an existing duplicate `menu` key warning in untouched `src/main.js`; the worker build completes successfully.

The three accepted failures are the browser-evidence assertion in `garage-cards.test.mjs` and the two Riviera cases in `traffic-race.test.mjs`. Both failing files were independently reproduced on clean `origin/staging` **79194f0b**: [garage](staging-garage.log), [traffic](staging-traffic.log). No other test failures are accepted.

`route.mjs`, `build.mjs`, `tools/build-detail-records.mjs` and `preview.mjs` were run twice. The second rebuild is **byte-identical** for `map.json`, `terrain.bin`, `raw/route.json` and `assets/maps/psychiko.svg`: [SHA-256 hashes](rebuild-hashes.json), [first build](rebuild-first.log), [second build](rebuild-second.log). `node tools/build-spawn-roads.mjs` was rerun; output is unchanged. Road topology, raced widths and one-way policies are unchanged. Rebuilt bundle/bake sizes: [before](harness/bundle-before.json), [after](harness/bundle-after.json).

Reproduce captures from this worktree: `TAG=after node .scratch/psychiko-realism/impl-c/harness/bake-baseline.mjs`, then `TAG=after node .../harness/perf-browser.mjs`; `TAG=final node .../harness/shots.mjs`, then `python3 .../harness/compose.py final`. Run one headless browser job at a time. The repository browser-slot shell wrapper requires `flock`, which is absent on this Mac; jobs here were serialized directly. The capture harness records its Node/browser PIDs and closes its own server/browser in `finally`.

## Limits and cleanup

Tree species, exact trunks, garden paths and parking occupancy remain class-level approximations; Google imagery supplies reference evidence, not game geometry/textures. The existing low-poly car/tree style, building setbacks and some wide junction aprons remain visibly simplified. Safe race-width parking sits partly on the footway; it does not reproduce cars occupying the live race lane. The large island arrows and garden overview views supplement the tangent station cameras.

Removed both temporary clean archives (~742 MB each before deploy output), the 36 MB local bake, raw PNG frames, duplicate detail captures and intermediate logs. Kept only the linked WebP evidence, gate logs, measured JSON and small reproducible harness. Every headless browser/server started by the harness closed in `finally`; no unrelated process was signalled. Disk before: `df -h /` reported 89 GiB available, 12% capacity; after cleanup: 87 GiB available, 12% capacity. Retained evidence size: 2.1 MB. No task temp directory remains.

# Penteli width and guardrails

Implementation: `d3acd1f90745e12200b62751d27c9da3a51bb14c`.
Network correction: `bc0fd52ad422ff72ac4f797ff637d948bf95f6e9`.
Final code: `979080892b6aa3b9b22834ddb71912ec48b5aad4` (two-sided concrete faces,
LOD assertions, repeatable build/capture tooling).
Work was authored in an archive under `/tmp`, using a private Git index and
`commit-tree`/compare-and-swap `update-ref`; the shared index and checkout were untouched.

## Width and source limits

Before: constant **6.8 m**. After: **7.2 m** normally, smoothly reaching **7.799 m**
on tight bends (up to 0.6 m allowance). Cached OSM route ways have two-lane tags
but no explicit width. Numeric width tags take precedence; otherwise lane count
and highway class determine width. The allowance is a reconstruction, not a
surveyed measurement. Source tags and mapped bridges are retained in the bundle.

`route-invariants.json` verifies unchanged route X/Z/Y, stations, start/finish,
speeds, lane/divider arrays, events and marks. Markings, terrain, signs, rival
clearances and the existing tow corridor read `route.edge()`. The network was
re-extracted after widening to remove overlapping race-road fragments.

## Barrier rules

28 runs, **2,532 m total** across both sides: **2,384 m steel**, **148 m concrete**.
Sample rendered terrain at 8, 16 and 24 m beyond the asphalt edge; let slope be
(drop16 - drop8) / 8. Protect drops when (drop8 > 1.8 m and slope > .22),
(drop16 > 4 m and slope > .28), or (drop24 > 8 m and slope > .32).
An outside curve above .012 /m curvature also qualifies with drop16 > 2.5 m
and slope > .15. Preserve the photographed station04 constraint.

Add 12 m approach protection and remove isolated short runs. Keep the town start,
Agios Petros fork, mapped junction mouths and intersecting side-road surfaces
open. Steel sits 0.9 m beyond asphalt (2.6 m at the photographed pull-off); its
6 m ends flare outward 0.5 m and turn down into the ground. Posts every 4 m.
All bases use the rendered terrain height. OSM bridges 124519741 and 127528596
have representative New Jersey parapets on both sides. Unknown culverts and
stone walls are not invented. Added placements/materials are not a surveyed
Greek highway inventory.

Production Ground rail limits provide solid contact; normal velocity is removed
with restitution while tangential velocity is retained. `contact-report.json`
checks 20 actual placement sites with production Vehicle + PenteliGround.

## Evidence

Matched production-renderer fixture frames (fixed camera, light and two Mini
models; no HUD or live AI):

- `before-hairpin.png` / `after-hairpin.png`: s=3920 m; width 6.8 → 7.497 m.
- `before-valley.png` / `after-valley.png`: s=6900 m; width 6.8 → 7.2 m.
- `before-two-cars.png` / `after-two-cars.png`: s=4500 m; width 6.8 → 7.2 m.
- `after-bridge.png`: final concrete parapets at s=2405 m.
- `placement-debug.png`: complete top-down placement map.
- `placement.json`: coordinates, stations, sides, materials and hazard reasons.
- `capture-report.json`: renderer counts, exact camera/target coordinates and errors.

The capture script runs through `tools/browser-slot.sh`, one browser job at a
time, exporting renderer PNGs with `toDataURL`. Both phases use the same car
models and lighting. The source before map/scenery are saved alongside this file.
All eight final PNGs were visually inspected.

The initial capture report predates the network correction and corrected car
orientation and is superseded by the final frames/report.

## Performance and other maps

Beams/parapets are merged by material into 240 m world cells. 557 steel posts use existing
CellInstances. Beam distance is 1800 m at the reference tier, posts 700 m; the
existing preset distance/detail policy scales both (including Potato). Collision
uses the existing O(1) two-metre station arrays. No per-frame terrain placement
queries or individual beam draw calls were added. Final beam/parapet geometry is **17,724 triangles in 31 chunks**. Net fixture
draw calls before → after: hairpin 130 → 129, valley 232 → 240, side-by-side
197 → 203 (these include vegetation and terrain changes). No FPS claim is made
on the loaded SwiftShader host.

Riviera already generates coastal/drop W-beams. Its six-metre drop probe overlaps
the conformed re-entry apron, so non-coastal drops deserve a separate wider-probe
audit. Megara already has mapped tyre-wall runs and concrete boundaries. Neither
map was changed.

## Verification

The bc0fd52 clean archive passed all three required gates. Final code gates all passed,
run again from `git archive HEAD` of 9790808 in
`/tmp/penteli-rails-release.7xQFjM` (dependencies symlinked).

- Focused Penteli placement/width/network tests pass.
- Production collision checks pass at 20 rail sites.
- Actual production gridSlot code passes 32 slots across both race directions,
  including a 2.2 m vehicle footprint; checkpoint frames remain finite
  (`grid-checkpoint-report.json`).
- Physics regression: 369 passed, 0 failed (`physics-regress-release.log`).
- Browser import graph: 191 modules (`browser-imports-release.log`).
- Final Penteli terrain audit: 1,043,060 samples; road clearance minimum
  0.03698 m, max shoulder step 0.12517 m, max slope 0.56565. The complete
  final npm gate also passes terrain checks on Riviera and Megara.
- `npm-test.log` is the initial failed reproducibility gate that caught the stale
  side-road network. `npm-test-final.log` is the passing corrected gate before the concrete-face
rendering follow-up. `npm-test-release.log` is the exact final-code gate.

`initial-rails-tests.log` retains fixture-development failures; `focused-final.log`
is the passing ten-test Penteli suite after those fixtures were corrected.

Final result: **all three required gates pass on frozen code 9790808**.
`validation.json` records command exits and final terrain metrics; all final npm
TAP stages have zero failures, and the rival race gate passes. The evidence
commit only adds artifacts, so it does not change the validated runtime.

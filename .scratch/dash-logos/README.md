# Dashboard / brand badge evidence

Baseline: see `base-sha.txt`; candidate code: see `code-sha.txt`.

The capture fixture instantiates the production `CarModel` and `Cockpit`
for all 18 garage entries. It uses the game's default stationary cockpit
camera: `body.localToWorld(cockpit.eye + (0,.02,0))`, including trim
ride height, pitch -.045 rad, vertical FOV 66°,
1440×900 viewport, straight steering. It deliberately uses a plain background
and fixed studio lighting so the cluster and mountings remain comparable;
these are WebGL renders of the real meshes, not painted mockups. No HUD or
moving driver is added. Every before/after cockpit frame uses the same camera.

- `before-*-cockpit.png`: original layout, ignition bulb check.
- `after-*-cockpit.png`: new layout, same ignition bulb check (all 13 bulbs lit).
- `after-*-settled.png`: healthy engine after the bulb check; only the applied
  parking brake and selected low beams are lit.
- `after-*-hub/front/rear/wheel.png`: actual badge mountings, close inspection views.
- `before-contact-sheet.png`, `after-contact-sheet.png`: all default cockpit views.
- `badges-contact-*.png`: hub / front / rear contact sheets.
- `after-*-audit.json`: raycasts from the default eye to the 13 symbol centres,
  reporting any opaque cabin object in front of them and checking all four
  icon corners against the camera frustum. Inspect alongside the
  screenshots; centre visibility alone is not a sufficient clipping check.

Reproduce from an archived commit with dependencies linked/installed:
`bash tools/browser-slot.sh node .scratch/dash-logos/capture.mjs after`.
Before mode serves the retained baseline sources (including the unchanged
warning-light state machine), not the current implementation.

Artwork provenance and configuration: `assets/brand-badges/CREDITS.md`.
The task’s original lineup has 18 model entries and 12 brands. Mazda is not currently in the
garage; its SVG and MX-5 mapping are included for future use. No physics,
warning activation rules, camera settings or quality settings were changed.
The steering column moves down 7 cm; the binnacle sits on the dashboard so
its face clears the rim and the GR Yaris fascia from the default eye.

Final visibility audit: 18 cars, 234 active symbol centres, zero opaque cabin
occlusions, all 936 icon corners inside the default viewport. Contact sheets
were manually inspected, including full badge silhouettes and left cap text.

The follow-up commit preserves the other cars’ existing authored badge mounts:
only the curved Porsche/GR Yaris panels and Huracán hood require surface seating.
This avoids moving intact badges onto nearby grille bars. Focused catalogue,
geometry orientation, lamp logic, layout and fallback tests plus syntax/import
checks were rerun on an archive of the final HEAD.

## Validation result

All six required gates ran on the clean commit archive recorded in
`release-gates/tested-sha.txt`. Physics, events, syntax, browser imports and
staging deploy dry-run passed. `npm test` failed only at the Riviera terrain
case: `dry Astir sand submerged at 497.2,2810.8: -1.2544212752587114`.
That exact failure reproduces without this work on unchanged parent
`b585492124778bc09a5c6080ec5a1da223164904`; see `parent-terrain.log`.
It is unrelated to the cockpit/badge files. The final three-line authored-mount
exception was checked on a fresh `git archive HEAD`: 24 focused tests, syntax
and browser imports all pass, followed by final exterior captures.

No push or deployment was performed. All commits used a private index and
compare-and-swap updates of prod; the shared checkout/index were not modified.
Exact historical replay is available by archiving `base-sha.txt` and copying
this capture script into it. Current captures deliberately cover the original
18 cars; unrelated native-fleet additions landed concurrently.

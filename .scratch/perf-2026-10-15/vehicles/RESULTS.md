# Vehicle low-poly evidence

Baseline source: `9e5e85f9b7cccf4ba907a87672250051029d9430`. Isolated vehicle benchmark snapshot: `237fe895dcebd83caa1d3f0ba1fea704f615564c`. The final landing preserves later world, suspension, tile and notice work; tested source snapshots are listed below. The isolated benchmark intentionally holds world/UI code fixed while other agents change them.

All 70 current configurations total 3,132,522 → 185,319 exterior triangles (94.1% fewer), counting one model of each trim. Resident vehicle geometry is 359,044,892 → 21,942,664 bytes (93.9% less). These are catalogue sums, not race totals. Wheels, collision dimensions and exhaust anchors match the baseline fixture. Enclosed occupants and hands are removed; bikes alone retain a blocky rider silhouette.

The headless physics workload runs 3,600 identical 1/60-second steps for every configuration. Final position, speed and gear match exactly for all 70. Process CPU time was 28,578 ms before and 30,175 ms after on the shared VPS; this is not evidence of a CPU speedup. Vehicle rendering changes do not alter the physics solver. SwiftShader GPU frame timings are not used as performance evidence.

[Full triangle/geometry table](../../lowpoly-vehicles/TRIANGLES.md) · [CSV](../../lowpoly-vehicles/triangles.csv).

Before/after contact sheets use identical front 3/4 and rear 3/4 cameras. Cockpit cameras show the baseline seated view and the geometry-derived final POV. Each sheet contains four configurations, except sheet 18, which has two. All 18 before and 18 final after studio sheets were personally inspected. The camera mask audit passes all 70 configurations with 85.6–97.1% clear view; audited runtime source hashes match the integrated vehicle candidate.

- Sheet 01: [before](../../lowpoly-vehicles/before-01.png) · [after](../../lowpoly-vehicles/after-01.png)
- Sheet 02: [before](../../lowpoly-vehicles/before-02.png) · [after](../../lowpoly-vehicles/after-02.png)
- Sheet 03: [before](../../lowpoly-vehicles/before-03.png) · [after](../../lowpoly-vehicles/after-03.png)
- Sheet 04: [before](../../lowpoly-vehicles/before-04.png) · [after](../../lowpoly-vehicles/after-04.png)
- Sheet 05: [before](../../lowpoly-vehicles/before-05.png) · [after](../../lowpoly-vehicles/after-05.png)
- Sheet 06: [before](../../lowpoly-vehicles/before-06.png) · [after](../../lowpoly-vehicles/after-06.png)
- Sheet 07: [before](../../lowpoly-vehicles/before-07.png) · [after](../../lowpoly-vehicles/after-07.png)
- Sheet 08: [before](../../lowpoly-vehicles/before-08.png) · [after](../../lowpoly-vehicles/after-08.png)
- Sheet 09: [before](../../lowpoly-vehicles/before-09.png) · [after](../../lowpoly-vehicles/after-09.png)
- Sheet 10: [before](../../lowpoly-vehicles/before-10.png) · [after](../../lowpoly-vehicles/after-10.png)
- Sheet 11: [before](../../lowpoly-vehicles/before-11.png) · [after](../../lowpoly-vehicles/after-11.png)
- Sheet 12: [before](../../lowpoly-vehicles/before-12.png) · [after](../../lowpoly-vehicles/after-12.png)
- Sheet 13: [before](../../lowpoly-vehicles/before-13.png) · [after](../../lowpoly-vehicles/after-13.png)
- Sheet 14: [before](../../lowpoly-vehicles/before-14.png) · [after](../../lowpoly-vehicles/after-14.png)
- Sheet 15: [before](../../lowpoly-vehicles/before-15.png) · [after](../../lowpoly-vehicles/after-15.png)
- Sheet 16: [before](../../lowpoly-vehicles/before-16.png) · [after](../../lowpoly-vehicles/after-16.png)
- Sheet 17: [before](../../lowpoly-vehicles/before-17.png) · [after](../../lowpoly-vehicles/after-17.png)
- Sheet 18: [before](../../lowpoly-vehicles/before-18.png) · [after](../../lowpoly-vehicles/after-18.png)

Frozen vehicle snapshot `237fe895` passed all six clean-archive gates: npm test, 433 physics regressions, events, syntax, browser imports and staging deployment dry-run. Exit markers and logs are in `gates-237fe895/`. The intermediate combined-world `44df9b9` run was superseded during terrain validation by the required latest-parent rebase and a bike-lighting correction. Final source snapshot `1f0badc154f3b9ef33f6ab2b57a998fb2e24208b` is based on `8940394`, retaining its commercial/bike suspension data and exact parent physics solver. Per lead instruction, affected final gates are physics, owner guards, syntax/imports and focused vehicle/camera tests (plus events). Garage, title, chase and cockpit screenshots have been captured and personally inspected. The final studio refresh and all 32 matched Riviera cockpit pairs are complete and reviewed.

## Riviera race scene

Identical player and chase-camera coordinates, 25 active traffic vehicles and two rivals. Random number consumption changes with removed drivers, so individual traffic appearance can differ. These snapshots use the same world and UI baseline. The after scene precedes the final removal of hidden Mercedes/shaped-cabin furniture; final runtime model counts above include that cleanup.

| Measurement | Before | After |
|---|---:|---:|
| Draw calls | 684 | 570 |
| Rendered triangles | 1,946,314 | 1,525,312 |
| geometryBytes | 491,604,378 | 210,541,490 |
| textureBytes | 118,704,128 | 116,256,768 |
| heap | 793,000,000 | 462,000,000 |
| requests | 250 | 250 |
| transferBytes | 5,495,724 | 5,427,794 |
| encodedBytes | 5,422,224 | 5,354,294 |

Texture bytes are estimated logical RGBA allocation; JS heap is a sampled browser value. Neither is GPU timing. Both browser captures reported no game JavaScript errors.

[Before chase](../../lowpoly-vehicles/before-race-traffic.png) · [After chase](../../lowpoly-vehicles/after-race-traffic.png) · [Before cockpit](../../lowpoly-vehicles/before-cockpit-race.png) · [After cockpit](../../lowpoly-vehicles/after-cockpit-race.png) · [Garage](../../lowpoly-vehicles/after-garage.png)

Seat height and Seat position controls exist in Settings → Camera, each ±8 cm, saved per configuration with reset. The current owner-restored title has no car hero; the shared preview studio still renders garage thumbnails and retains dark exterior glass.

## Combined world integration check

Snapshot `44df9b9aa7eb19f40e8fca2bdcf3cac33167407c` rebases identical vehicle/camera runtime files onto `5c72f29b95fc8b5eda05b5f3299da484715e0c02`, including the separate world simplification. The combined same-pose race rendered 803,690 triangles in 415 calls with 25 traffic vehicles and two rivals, and no game JavaScript errors. These figures include the world changes and are not attributed solely to vehicles.

[Integrated chase](../../lowpoly-vehicles/integrated-world/after-race-traffic.png) · [Integrated cockpit](../../lowpoly-vehicles/integrated-world/after-cockpit-race.png) · [Integrated garage](../../lowpoly-vehicles/integrated-world/after-garage.png). All three personally inspected.

The controlled older-world camera sweep produced one Superb colour frame with a large dark obstruction; a fresh same-source pair did not reproduce it. Its source remains unconfirmed, and the original/probe logs are retained by the camera evidence bundle. An independent `44df9b9` integrated-world Superb run also passed with no JavaScript errors; [daytime cockpit](../../lowpoly-vehicles/integrated-superb/after-cockpit-race.png), [night cockpit](../../lowpoly-vehicles/integrated-superb/after-cockpit-night.png) and [chase](../../lowpoly-vehicles/integrated-superb/after-race-traffic.png) were all personally inspected and showed no block. The vehicle opaque-mask audit excludes transparent weather overlays; it is not a full-scene obstruction proof.

During the world sweep, all four native bikes exposed a `setCarLights` crash: they have a headlamp material but no separate DRL material. The correction guards only the optional DRL assignment, preserving bike headlamp output. Fleet guards now exercise day/night transitions for every configuration. The final focused suite passed 157 tests, with one expected git-author check skipped in the clean archive. Final refreshed rendered masks match the corrected file and rebased catalogue hashes; both POV tests pass all six cases, including independent PNG recount and exact source/fragment hashes. All 140 mask PNGs and all 140 fixture colour PNGs are byte-identical to the prior reviewed fixture set. Earlier controlled captures retain their explicitly recorded source provenance; geometry and camera anchors did not change.

Final affected gates on source snapshot `1f0badc1`: 1,141 physics regressions passed; focused suite 157 passed/one expected git-history skip; events, syntax (296 modules), browser imports (231 modules), and all six POV tests passed. Logs and exit markers are in `gates-final-rebase/`. The final fixture-only overlay SHA256 is `60787bd496e524200cbbd6b19eed3f869595a6ef9ff3bf77ec1732abdc475ce2`. Later parent `3f43a7f` also contains tile-buffer sharing and compact notices. The main.js merge preserves those notices without changing the audited cockpit-camera fragment; final integration guards cover the merged source.

## Complete camera and Settings evidence

The final bundle contains all 70 fixture pairs and 32 controlled Riviera pairs (31 garage entries plus MINI hardtop), eight world contact sheets, 18 fixture contact sheets and all mask/table/provenance records. Camera owner and integration owner reviewed all eight world sheets and both Settings screens. All default masks are 85.5959–97.0978% clear; all 32 world rows have no auxiliary flags. Resumed bike captures use the corrected optional-DRL handling and the parent suspension solver.

[Camera evidence index](../../pov-camera/README.md) · [Visual review and anomaly record](../../pov-camera/visual-review.md) · [Adjusted Settings](../../pov-camera/seat-settings-adjusted.webp) · [Reset Settings](../../pov-camera/seat-settings.webp).

The Settings browser test saved height +0.08 m and position −0.08 m under the current configuration, verified stored values and reset both to zero. Final evidence archive SHA256: `12f3234473ea1c0212749f0158083640f99310005fe1d924af4b557f49b2758a`; all 468 manifest hashes independently verified. The camera publication hold was explicitly lifted after review.

The per-configuration physics identity comparison above applies to the controlled vehicle-only benchmark pair. Final landing retains the separately authorized `a92d24d` suspension changes and passes its expanded 1,141-regression suite. Shared vehicle primitives and cockpit visibility form one fleet-wide change, so they land atomically after complete fleet validation.

Final latest-parent integration snapshot `097ff79bed6ccfcd560bb2bcd60917aa2cc8abbf` (parent `3f43a7f`) passed 168 tests plus one expected archive git-author skip, syntax and browser imports. This set includes both POV guards, every vehicle budget/night-light transition, notices, camera controls, release assets, world owner rules and test wiring. Logs are in `gates-landing/`. Final landing adds only this report, gate logs and the evidence viewer to that tested source tree.

## Owner correction: visible cockpit structure, 2026-10-16

The ghost cockpit regression is corrected with a connected low-poly shell, visible rotating branded steering wheel, mounted mirrors/wipers and a small tiled windscreen texture overlay. This deliberately restores visible geometry. It is not a draw-call reduction claim. All 70 configurations remain at or below 828 visible interior triangles; each car wheel is 110 triangles. Default clear view is 82.6446–92.8583% including the structure.

Matched Riviera camera pose comparisons use a6471544 cockpit runtime before and the new candidate after, in the same 87558ec world. The exact-source audit and full release gates retain parent f525f45; final integration also retains b09b85c (tyre-grip HUD removal) and 87f0d64 (building colour shading), with affected checks plus physics repeated in a fresh archive. Full provenance, all 32 world pairs, two rain pairs and counts are in [cockpit-structure](../../cockpit-structure/README.md).

| Rain main scene | Draw calls before → after | Triangles before → after |
|---|---:|---:|
| 911 | 194 → 219 | 673022 → 673264 |
| SVJ | 188 → 210 | 672478 → 672684 |

The windscreen overlay itself remains one draw and decreases from eight to two triangles, with one shared 128×128 alpha tile and no per-drop objects. These counts reset renderer.info and render the main scene, excluding mirror/post/UI passes. No GPU timing or FPS claims on SwiftShader.

[911 before](../../cockpit-structure/before-carrera-rain.webp) · [911 after](../../cockpit-structure/after-carrera-rain.webp) · [SVJ before](../../cockpit-structure/before-aventador_svj-rain.webp) · [SVJ after](../../cockpit-structure/after-aventador_svj-rain.webp) · [all 70 triangle/mask rows](../../cockpit-structure/TRIANGLES-AND-MASKS.md) · [all scene counts](../../cockpit-structure/SCENE-COUNTS.md).


## Authored cockpit restoration — 2026-10-16

Owner chose distinct original interiors over the thin generic shell. Cockpit budget is 12,000 triangles; actual current cockpit counts are 144–1,834. Exterior/LOD/wheel geometry and gameplay anchors remain unchanged. No GPU/FPS claim. Eight matched day-only pairs were requested by the lead wrap-up; rain runtime is unchanged and its texture/wiper tests pass. Every config and exact counts: [all vehicles](../../real-interiors/EVERY-VEHICLE.md). Matched pictures: [world sheets](../../real-interiors/sheets/).

# Matched Riviera render counters

One main-scene render at the same start pose, FOV 66°, time 8.25 s. These are deterministic draw calls/triangles, not SwiftShader GPU or FPS estimates. Day comparisons keep the same vehicle, pose and FOV. The restored seated eye changes the frustum, so scene-count differences include the resulting visibility changes. Rain sweep was omitted under the lead wrap-up instruction. The world weather code is unchanged by this pass.

| Vehicle | Day calls before → after | Day triangles before → after |
|---|---:|---:|
| mini | 182 → 198 | 625228 → 627334 |
| carrera | 186 → 202 | 625476 → 627114 |
| aventador_svj | 182 → 202 | 625368 → 626998 |
| cle | 186 → 203 | 625428 → 627384 |
| e36 | 187 → 203 | 625520 → 627044 |
| gtv | 189 → 205 | 625536 → 627240 |
| bus | 175 → 180 | 616966 → 617868 |
| delivery | 162 → 168 | 625074 → 625910 |

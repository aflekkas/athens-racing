# Penteli road cuts, branches and roadside inventory

Research/review: 2026-10-14. Route: Dionysos → Agios Petros → Karakanta, 9,896 m timed distance (292 m run-in/run-out). Stations below use the full route axis, not distance after the timing start. No Street View imagery is included in game assets.

## Street View references personally opened

Existing public-UI captures were reopened for this implementation. The complete original URLs, camera coordinates, bearing and capture dates are in [street-stations.json](maps/penteli/street-stations.json). Reference PNGs remain in ignored `.scratch/penteli-v2/street-01.png` through `street-08.png`, with Google's attribution intact.

| Station | Panorama / date | Observations used |
|---|---|---|
| 01, s≈292 | [2MT9yOoFrrh7jTVT2wtWiA](https://www.google.com/maps/@?api=1&map_action=pano&pano=2MT9yOoFrrh7jTVT2wtWiA), Sep 2025 | Dionysos pines, villas, dirt/gravel margin and a paved side junction; no continuous village pavement established. |
| 02, s≈1600 | [d5CVp-txO8YCTgIjmnhqaA](https://www.google.com/maps/@?api=1&map_action=pano&pano=d5CVp-txO8YCTgIjmnhqaA), Sep 2025 | Low scrub, burned snags, narrow shoulder, localized rock cutting; no continuous rail. |
| 03, s≈3156 | [YDTT-dxz_iWZ_CeRIlJz3w](https://www.google.com/maps/@?api=1&map_action=pano&pano=YDTT-dxz_iWZ_CeRIlJz3w), Sep 2025 | Open valley, regrowth, gravel pull-off and cut side. |
| 04, s≈4558 | [HYEvYN4RquswrnetVb6rfQ](https://www.google.com/maps/@?api=1&map_action=pano&pano=HYEvYN4RquswrnetVb6rfQ), Sep 2025 | Steel W-beam on the left/outside of the approach, broad gravel pull-off, exposed uphill slope on right. |
| 05, s≈5730 | [CBRmgMFbVObdEfr1mudfrQ](https://www.google.com/maps/@?api=1&map_action=pano&pano=CBRmgMFbVObdEfr1mudfrQ), Sep 2025 | Broad real Agios Petros fork, natural rock inside the turn and a white boundary beyond. |
| 06, s≈6668 | [kmrwLnKHqnpLbxKDeqzACw](https://www.google.com/maps/@?api=1&map_action=pano&pano=kmrwLnKHqnpLbxKDeqzACw), Mar 2026 | Layered left rock cutting; open rocky right verge without a continuous guardrail. |
| 07, s≈8142 | [N2hJziUPWyB3t-RQ8YJxCA](https://www.google.com/maps/@?api=1&map_action=pano&pano=N2hJziUPWyB3t-RQ8YJxCA), Mar 2026 | Burned pines, low regrowth, exposed mountain sightline. |
| 08, s≈10158 | [kU3Ao9lbwcrO8-UlaPUq2w](https://www.google.com/maps/@?api=1&map_action=pano&pano=kU3Ao9lbwcrO8-UlaPUq2w), Mar 2026 | Spring access, deciduous grove, low stone boundary; not Penteli town centre. |

The guardrail inventory is deliberately evidence-limited: s=4400–4760 on the left, offset 2.6 m beyond the asphalt edge. The panorama establishes the rail and pull-off; its exact start/end stations are modelling estimates. Removed the former automatic rail-on-every-DEM-drop rule. Ground consumes the same `assets.rails` samples as the W-beam renderer for solid lateral collisions. Existing cut walls, mapped quarry exposures, villas, trees and chapel are retained. No additional kiosk or bridge rail is asserted from these eight views.

## Road engineering and junctions

`src/road-cut.js` protects every DEM cell touched by the main road plus 3 m verge, with a safety margin; side roads receive the same protection. The minimum of all intersecting road envelopes wins at hairpins. A three-cell transition blends cut and fill into the DEM. `terrain.js` excludes coarse underlay triangles already covered by the detailed mesh: the previous unconditional inclusion allowed those triangles to pierce the road even when detailed terrain was clear. The narrow gravel shoulder now has a cut/fill tie to that terrain. All four corners are checked against the global nearest leg to prevent the tie spanning a hairpin. These are reconstructed engineering shapes, not measured road-cut surveys. Route positions, grades and racing gates are unchanged.

The existing OSM network is the authoritative drivable branch surface, including contacts. The duplicate decorative EP29 strip has been removed. Branch mouths exclude vegetation, retaining walls, rails and verge ribbons.

- [OSM way 224029663](https://www.openstreetmap.org/way/224029663): unused Nea Makri continuation, 831.89 m in the surrounding network.
- [OSM way 101785908](https://www.openstreetmap.org/way/101785908): upper mountain gravel branch, 570.35 m.
- [OSM way 926267606](https://www.openstreetmap.org/way/926267606): 25.46 m connecting arm, joins the exact endpoint of 101785908; not a 25 m dead end.
- Short Dionysos service/driveway ways end at actual properties or join the street network; they are not artificially extended across private lots. Town streets such as Vomou Dionysou extend 722 m.

Saved OSM provenance: `tools/maps/penteli/road-network-source.json.gz`; © OpenStreetMap contributors, ODbL. Branches remain off-course. No route extension or shortcut changes the timing path.

## Signs and village placement

`road-sign-layout.js` derives approach direction boards and give-way placements from actual OSM arms, warning/chevron positions from route curvature, and a Dionysos village board. Faces share one procedural atlas and use spatial instances; poles are instanced. Greek/Latin destination names and directions are geographic reconstructions, **not transcriptions or surveyed positions of photographed signs**. No invented kilometre distances are added. Yield signs serve branches, not the main race road. Speed repeaters reuse the HUD's existing OSM/default limit profile. Reverse-facing inferred boundary signs now announce the zone entered, rather than the zone left. Observed/mapped limits are not changed.

Dionysos s≈170–760 is only a candidate range for village activity; pedestrian owners must require flat forecourts/building/POI evidence, exclude carriageway/verge and all branch mouths. There is no evidenced continuous sidewalk to authorize pedestrians along this road. Agios Petros is a chapel/fork, Karakanta a spring access, and this route never reaches Penteli town centre.

Riviera audit: 16 existing speed signs (2 mapped nodes, 14 inferred), no mapped speed cameras; route builder already has direction/place boards and cliff chevrons. Its direction/name atlas was Latin-only; it is now Greek + Latin. Existing Riviera sign placement, speed data and batching are preserved. This is a code/data audit, not a new Street View survey of every Riviera sign.

## Verification

`node tools/penteli-clearance-audit.mjs <report.json>` audits actual rendered triangle planes, including coarse terrain and the new cut/fill verge, at ≤2 m longitudinal and 1 m cross-road spacing. It includes the main carriageway plus 3 m verge and every side road plus 2 m verge. A missing terrain hit fails the gate.

Initial main-route audit: 465 / 68,133 samples above the road; 124 on asphalt, 301 caused by the coarse mesh; maximum +4.457805 m at s=6662, u=-6.4. Corrected combined mesh audit: 0 / 68,133 route samples and 0 / 160,601 branch/verge samples, zero missing samples. A narrower independent branch carriageway audit changed 116 / 105,882 (maximum +1.233867 m) to 0 / 105,882. These denominators differ because the final mesh audit also includes branch verges.

Artifacts and final clean-archive/test results are recorded in `.scratch/penteli-v2/`. The eight source images above have been opened; final game comparisons and timing results are recorded after capture, not inferred from this numerical audit.

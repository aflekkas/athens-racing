# Riviera and Tower source audit — reference inspection pending

The hosted source contains an OSM-derived tall building at the Riviera Tower
site. It does not establish faithful architecture. Nine exact points on the
Vouliagmeni–Loumbarda circuit are now tied to source ways and ready for a
matched Street View inspection. No new browser, third-party capture, runtime
edit, building edit, terrain edit or world publication occurred in this stage.

## Tower: presence, source form and primary project reference

Authenticated cell `-1,21`, SHA-256
`13ebbb53967d5fe7919e2c9d1f128298725d8feee757e619e18f0e134efe6e19`,
144,848 compressed bytes, source `athens-east-development` revision
`2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39`,
contains **building:w1480412293:0**. Its base is4.610027m, extrusion160m,
roofY164.610027m. The seven-corner footprint is2451.611m², bounds59.886m east–west
by59.356m north–south. Vertex-mean centre isworld[-289.168429,10814.121000],
about16.009m from the previously recorded nominal tower coordinate. This is
an identified generic model, not a claim about its exact displayed facade.
The cell body was rehashed in this audit; no per-feature extraction date exists
in its metadata. Do not date it from an unrelated generator-wide source date.

The current [official OSM whole-way response](https://api.openstreetmap.org/api/0.6/way/1480412293/full)
succeeded HTTP200, wayv2, source timestamp2026-06-28T14:09:16Z. Tags are
`name=Riviera Tower`, `building=construction`, `construction=residential`,
`building:levels=50`, `ele=200`, with **no height tag**. Response SHA-256
`7ab058ab2b6acf8fab42c963d0bb08156d65f5144220178acff845479de29617`.
The current source footprint has36distinct vertices and2475.091m² projected
area: the emitted seven-corner footprint has0.949% less area. This comparison
does not establish which historical way version supplied the emitted cell.

The repo's generic `model.py:building_height` uses explicit height first,
otherwise levels×3.2m;50×3.2=160m is consistent with this block. This is a
root-cause inference, not recovered historical extraction provenance.
[OSM ele](https://wiki.openstreetmap.org/wiki/Key:ele) means elevation above sea
level; it must not be read as a building-height replacement. Footprint
simplification to4–14corners and generic facades also limit identity fidelity.
No named custom Riviera Tower model was found in the earlier inventory audit.

The [developer project page](https://theellinikon.com.gr/en/our-news/progress-of-works/riviera-tower-green-skyscraper),
[structural designer TTA](https://www.ttaengineers.com/projects/BUILDINGS/RIVIERA-TOWER-in-ELLINIKON/)
and [contractor Bouygues](https://www.bouygues-construction.com/en/sectors/luxe/residentiel-luxe/riviera-tower)
identify a200m/50-storey design. This supports a planned-height/form mismatch
requiring design review, not an automatic global floor-height change. Exact
facade, balcony, podium and planted-terrace geometry was not visually inspected
in this no-browser pass. Published design imagery is not construction evidence.
The developer page currently gives first-half2027 as the expected finish and
its dated progress cards include Q12025/19thfloor; the contractor page still
says expected2026. These are conflicting project-page statements, not today's
verified construction stage. Completion and occupancy remain unverified.

The Tower centre isat least about9.2km from this circuit's nearest sampled
route point (9207.673m to its start; samples<=4m apart). A completed race along
Vouliagmeni–Loumbarda would not prove the Tower's local rendering. Separate
nearby reference candidates are recorded numerically. Two closest roads are
OSM service ways977816178 and798390901; their site access and panorama coverage
are unverified. Prefer checking the residential way174698180 candidate
37.8833452,23.7279216,look-at heading242.96° (119.906m from centre); its current
v6 tags include one-way/asphalt/both-sidewalks/**lane_markings=no**. This is a
reference candidate, not permission to enter a construction site or a promised
panorama. Coverage, date, actual camera pose and line of sight need inspection.

## Riviera: exact profile samples and Street View readiness

This is the existing **10337.229709m Vouliagmeni–Loumbarda route**, not urban
Vouliagmenis Avenue. Its source-bound snapshot isworldrevision
`80055f9208753e2d6fa8658b31c90216d22c650f7f33588ebd5178d1a6b804a1`.
The local compile replays the existing root physical-query proof; it is not a
measurement of today's master terrain or a surveyed elevation profile.
`profile-and-tower.json` binds the root proof/definition hashes, every source
cell/hash, exactworldXYZ/yaw/grade/width/layer/surface and panorama URL.

| Route station m | Latitude, longitude | Source contact Y m | Local grade | Current OSM way | Street View readiness |
|---|---|---:|---:|---|---|
| 0.0 | 37.8125368, 23.7819581 | 5.941 | 0.10% | w459160388 v19 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8125368,23.7819581&heading=162.39&pitch=0&fov=90) |
| 500.0 | 37.8084501, 23.7835593 | 9.218 | 1.73% | w328525144 v19 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8084501,23.7835593&heading=133.78&pitch=0&fov=90) |
| 1500.0 | 37.8016984, 23.7872432 | 15.732 | 0.46% | w924494889 v3 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8016984,23.7872432&heading=214.62&pitch=0&fov=90) |
| 3000.0 | 37.8038721, 23.7974766 | 17.532 | -9.73% | w87543250 v17 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8038721,23.7974766&heading=29.84&pitch=0&fov=90) |
| 4500.0 | 37.8158342, 23.8011166 | 6.226 | 0.04% | w1268971815 v2 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8158342,23.8011166&heading=18.69&pitch=0&fov=90) |
| 6000.0 | 37.8225287, 23.8135176 | 5.455 | 0.01% | w656858082 v8 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8225287,23.8135176&heading=80.60&pitch=0&fov=90) |
| 7500.0 | 37.8126900, 23.8234381 | 14.721 | -1.90% | w1264763697 v4 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8126900,23.8234381&heading=148.16&pitch=0&fov=90) |
| 9000.0 | 37.8144621, 23.8312140 | 16.383 | -8.17% | w483246714 v17 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8144621,23.8312140&heading=101.09&pitch=0&fov=90) |
| 10337.2 | 37.8205260, 23.8376461 | 3.405 | 1.23% | w328367783 v24 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.8205260,23.8376461&heading=112.78&pitch=0&fov=90) |

Every linked panorama is **ready to inspect only**. None was opened in this
pass; no imagery date, panoID, visible median, paint colour, retaining wall,
vegetation or photo fidelity is claimed. The heading conversion is clockwise
from geographic north, `-worldYaw`, with +x east/+z south. Future inspection must
record the actual selected panorama pose/date; nearest-panorama snapping can
move onto another street. Compare the actual game pose, not the requested URL.

Nine sampled model points match their current source way centreline to within
0.132m (seven within0.001m). Source road correspondence supports location
readiness; it does not verify visible geometry or slope. The steep local
snapshot grades at station3000(-9.73%) and9000(-8.17%) have been sent to terrain
as review candidates, without a current-world defect or requested height fix.

Current whole-way OSM metadata distinguishes directional structure:

- Start,w459160388v19: one-way,2lanes,right-side sidewalk.
- Station500,w328525144v19: one-way,3lanes,`turn:lanes=left|through|through`.
- Stations1500/3000,w924494889v3/w87543250v17: two-way,4total lanes,2forward+2backward.
- Station4500,w1268971815v2: one-way,2lanes.
- Station6000,w656858082v8: one-way,3lanes.
- Stations7500/9000/finish,w1264763697v4/w483246714v17/w328367783v24:
  two-way,4total lanes,2+2. All selected roads are tagged asphalt,lit,maxspeed50.

The infrastructure owner confirms directional lane counts/dividers are already
consumed by shared procedural generation, but `turn:lanes` has no parser/arrow
emitter. The station500 left/through/through metadata therefore identifies a
source-supported missing arrow capability. It does not specify exact arrow
placement, paint colour, median width or a current visual regression. Those
need matched imagery and a shared procedural fix owned by infrastructure.
The width-query cross-section20.962m at that junction may include intersecting
surfaces; it is not a three-lane width or median measurement. No place-specific
paint patch or road widening is proposed. Tower-adjacent `lane_markings=no`
was sent separately to infrastructure for its existing shared-policy audit.
Its follow-up check confirms that this exact residential/one-way source with no
lane count already defaults to one4.8m lane with no centre/lane/edge paint.
Therefore **no current emitted marking defect is proved on w174698180**.
`road_section.py` does not consume the no-markings tag; a synthetic two-lane
variant still emits a dashed divider, exposing a generic ignored-tag policy
gap only. This does not establish actual two-lane width, road access or a
place-specific visual defect; source/runtime remained frozen during gates.

## Verification, ownership and limits

- Replayed native compile of one existing route against authenticated stored
  query proof:PASS; no rival-plan rebuild, full suite, bake or browser launch.
- Current official OSM reads13/13HTTP200;10whole-way responses have all referenced
  node coordinates,3candidate-road tag responses intentionally omit nodes.
  This is bounded selected-way coverage, not full route restriction closure.
- Nine source-coordinate matches9/9 within0.132m; Tower cell SHA recheckPASS.
- Primary pages inspected as text; architect project URL was inaccessible to
  the web tool. No third-party media downloaded/committed or shown inline.
- Exact no-browser/source-only scope does not close Riviera/Tower visual
  fidelity, current construction state, terrain acceptance or the original
  all-problems task. No runtime behavior changed; no game screenshot is claimed
  for this source-only update. The parent consolidates PROBLEMS/CHANGELOG.
- Infra received road/arrow findings; terrain received source profile points.
  An attempted infill thread address was invalid; the parent received the
  factual Tower/generic-height finding for forwarding. No overlapping edits.
- Tools/model: Codex gpt-6.1-sol; Cogenly terminal; official OSM API; web source
  tool for primary project pages; native compile/RouteRuntime for source samples.
  No third-party artwork generation, manual geometry or physical-guard changes.
- Source numeric data: ©OpenStreetMap contributors, ODbL1.0. Exact response hashes,
  versions, timestamps and observed read times are retained in current-osm.json.
  Read time does not imply per-feature extraction time for hosted source cells.
- Cleanup: no owned processes/browser; no new raw media or cell copies.
  Tasktemp source/fixture101MB stays shared until loader/terrain release. Disk49%
  before this stage; final disk reading recorded in handoff. Revert this report
  commit to roll back; no production asset/world/catalogue was changed.

## Follow-up: three representative panoramas actually inspected

On2026-10-23 a separate parent-authorized single-slot reference-only turn opened
three real Google Street View panoramas using native Cogenly preview. All three
visually rendered without a sign-in block. The browser tab and owned slot
holder were closed inside the <=3minute grant; no proxy or browser remains.
No screenshots were saved, committed or embedded in reports. Google imagery
was viewed for reference only. The original nine-point readiness record above
is superseded **only for these three points**; the other six are uninspected.
Exact requested/actual coordinates, heading, panoID, date, source edge and
snapping offsets are recorded in `streetview-three.json` beside the prior
numeric receipts.

### Station500 — February 2025

[Actual panorama](https://www.google.com/maps/@?api=1&map_action=pano&pano=KBCcJcBthVSZMUEvOXBVXg&heading=133.78&pitch=0&fov=90), Google Street View, 20 Leof. Poseidonos, Vouliagmeni.
Actual coordinate **37.8084272,23.7835815**, heading133.78°,
pano`KBCcJcBthVSZMUEvOXBVXg`. The requested point snapped3.207m;
local tangent offsets are3.168m along and
0.495m to the route's right. These are coordinate
comparisons, not surveyed road/camera elevations or lane assignments.

- White directional arrows: left-turn indication in left lane and through arrows in adjacent lanes.
- Dashed white lane dividers.
- Low grassy raised median to left; kerbed planted strip to right separates frontage/service lane.
- Bus-stop shelter, parked cars and bollards on right frontage; traffic lights ahead.

Exact arrow metric placement/size not measured Paint/median observations apply only to this visible frame.

### Station3000 — March 2026

[Actual panorama](https://www.google.com/maps/@?api=1&map_action=pano&pano=JUJPy3OJppeb4rjqL6VzgQ&heading=29.84&pitch=0&fov=90), Google Street View, Leof. Poseidonos, Vari.
Actual coordinate **37.8038198,23.7974806**, heading29.84°,
pano`JUJPy3OJppeb4rjqL6VzgQ`. The requested point snapped5.835m;
local tangent offsets are-4.876m along and
3.205m to the route's right. These are coordinate
comparisons, not surveyed road/camera elevations or lane assignments.

- Double continuous white centre lines and dashed same-direction lane divider.
- White edge line; no raised central divider visible in this frame.
- Grassy rocky hillside on left; shrubs and trees at right edge; open water in distance.

Visual profile not a numerical grade measurement Roadside form beyond visible field not established.

### Station9000 — April 2026

[Actual panorama](https://www.google.com/maps/@?api=1&map_action=pano&pano=PhwxmbPlrawGmVRQNETblA&heading=101.09&pitch=0&fov=90), Google Street View, EO91, Decentralized Administration of Attica.
Actual coordinate **37.8145330,23.8311829**, heading101.09°,
pano`PhwxmbPlrawGmVRQNETblA`. The requested point snapped8.351m;
local tangent offsets are-4.199m along and
-7.218m to the route's right. These are coordinate
comparisons, not surveyed road/camera elevations or lane assignments.

- Tall exposed rock cutting immediately left.
- White edge line, dashed same-direction divider and double continuous white centre lines.
- Metal roadside guardrail right; sea and scrub-covered land visible.
- Street-light poles and triangular warning signs visible.

Snap is about8m from requested model point Same driving lane/carriageway not established; camera heading may look against capture vehicle travel Numerical gradient, rock-face dimensions and guardrail clearance not measured.

The station500 view supplies direct visual support for directional arrows in
the reviewed source-tag vicinity. It does not by itself prove exact arrow
placement or a final-world emitted regression. Infrastructure owns any shared
procedural implementation. The two profile-hotspot views establish roadside
character and reference coverage, but do not validate -9.73%/-8.17% source
snapshot grades. Image perspective/camera attitude is insufficient for that.
At station9000 the ~8m snap could change the road-side or driving-lane view;
a future game comparison must match actual panorama pose, not assume the
requested centreline is the camera lane. No Tower panorama was inspected in
this three-point turn. Full-nine coverage, current-day construction, exact
geometry/height and matched own-game fidelity remain open.

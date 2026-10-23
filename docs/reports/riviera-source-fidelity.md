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

## Follow-up: remaining six targets and Tower candidate inspected

A second parent-authorized native-preview reference turn on2026-10-23 visually
rendered all remaining six prepared Riviera targets and the Tower candidate.
It used one browser slot for less than four minutes. The tab and owned slot
holder were closed before reporting; no proxy, browser, heavy gate or runtime
edit was left active. No third-party captures were saved or committed.
`streetview-six-and-tower.json` records actual URLs, snapped coordinates,
headings, image dates and per-frame observations.

Together with `streetview-three.json`, **all nine selected Riviera target
panoramas have now actually rendered and been visually inspected**. This is
nine sampled points, not continuous-route or full-area coverage, and not a
matched game-fidelity claim. The earlier readiness/three-only statements are
historical stages superseded by these receipts.

| Target station m | Actual panorama coordinate | Heading | Capture date | Snap distance m | Panorama |
|---|---|---:|---|---:|---|
| 0 | 37.8125439,23.7819712 | 162.39° | Feb 2025 | 1.390 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=-Q86p3R6vM9U8uO3npin0g&heading=162.39&pitch=0&fov=90) |
| 1500 | 37.8017592,23.7872164 | 214.62° | Mar 2026 | 7.170 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=-Q4LJP3zWncCJM9ywppwkw&heading=214.62&pitch=0&fov=90) |
| 4500 | 37.8158149,23.8011240 | 18.69° | Mar 2026 | 2.241 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=dyhznTkriDfB7H8d84gN0g&heading=18.69&pitch=0&fov=90) |
| 6000 | 37.8225767,23.8135329 | 80.60° | Feb 2025 | 5.507 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=WBFWEHcrZvP9lssSKhjphQ&heading=80.60&pitch=0&fov=90) |
| 7500 | 37.8127206,23.8235521 | 148.16° | Apr 2026 | 10.570 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=9jBwfsGvezfQqXmYi4_J_w&heading=148.16&pitch=0&fov=90) |
| 10337.229708621433 | 37.8205853,23.8376377 | 112.78° | Apr 2026 | 6.646 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=itnk5E8PZouJUWnxNq98LQ&heading=112.78&pitch=0&fov=90) |
| Tower | 37.8832955,23.7279485 | 242.96° | Apr 2026 | 6.015 | [Inspect](https://www.google.com/maps/@?api=1&map_action=pano&pano=3oyte2cVix7kdzQXwFpi5g&heading=242.96&pitch=10&fov=90) |

The visible frames show distinct streetscape classes:

- **0:** Two same-direction lanes divided by dashed white line; Broad kerbed grassy central median with repeated palms; opposite carriageway left; Mature trees and pedestrian railing along waterfront right; Multi-storey frontage and parked cars beyond opposite carriageway.
- **1500:** Double continuous white centre lines with dashed same-direction divider; Exposed rock cutting and low vegetation left; Metal guardrail right; unpaved shoulder and sea beyond; Street-light poles along visible section.
- **4500:** Urban frontage, low commercial building on right and apartments left; Narrow kerbed central island planted with palms; Dashed white divider and parked vehicles along right kerb; Overhead utility wires and street-light poles visible.
- **6000:** Three apparent same-direction lanes with dashed white dividers and solid white edge lines; Opposing carriageway separated by tree/grass strip and metal barriers; Right metal guardrail; open low vegetation/earth plot and scrub hill beyond; No measured lane widths or barrier clearance.
- **7500:** Exposed rock cutting close left with narrow kerbed shoulder; Double continuous white centre lines, dashed lane divider and solid white edge; Metal guardrail and sea right; street lighting; Visible vehicle approaches the camera; capture travel direction must not be assumed from view heading.
- **10337.229708621433:** Signal-controlled junction with channelising island, signs and white road markings; Blue bus-stop shelter and shrubs left; Side road, shrubs, low structures and hills to right; Utility poles, overhead wires and street lights visible.
- **Tower:** Tall exposed construction body with repeated projecting floor/balcony edges; Vertical external hoist/scaffold-like equipment visible on facade; Crane right; site hoarding and concrete barriers foreground; Tree cover at lower levels; tower top cropped out of the frame.

Station7500 snapped10.570m and visibly includes a vehicle approaching the
camera. Heading is a viewing direction, not proof of the capture car's travel
direction or a legal driving lane. As with the prior station9000, future game
matching must use actual panorama cameraXZ and record player pose separately.
No lane width, rock-face height, guardrail clearance or numerical road grade
was measured from these images.

The Tower frame is **April2026 construction evidence at that date**: exposed
slabs/balcony edges, external hoist/scaffold-like vertical equipment, a crane,
site hoarding and concrete barriers. Its upper part is cropped. No visible
floor count or height is asserted, and this does not establish current-day
completion, final facade or occupancy. The planned200m/50-storey primary
references and OSM `ele=200` remain separate from the observed construction
form. No numerical height was inferred from either that tag or the picture.

## Offline preparation for three matched own-game baselines

`matched-three-preparation.json` now pins the first three actual panorama
cameraXZ/headings (stations500,3000,9000), source cell hashes and old immutable
world80055f. It does **not** use the originally requested centreline point as
the camera position. No game job was run in the reference chunk.

The preparation specifies a1280×800 viewport,90° horizontal FOV and derived
64.010766° vertical FOV. This follows the requested panorama FOV and is not
lens calibration. Camera pitch0/roll0 is a level-horizon assumption, not a
surveyed attitude. Eye height2.5m above emitted contact is an explicit
assumption with1.6/2.5/3.0m sensitivity settings, not a measured Google camera
height. Actual cameraY is deliberately unresolved until an authenticated
source contact can be queried at the exact snapped cameraXZ. If it is absent,
the view must fail closed; no substituted route-centre Y or invented drape.

The later game job must explicitly pin its source code commit, bind actual
world/cell/contact identity, record floating origin and actual camera world/
localXYZ/quaternion/FOV, and render after a positive physics/visual step with
loading opacity0. Actual car/player pose and motion are separate facts; a
matched scenery camera is not proof of legal lane assignment or race driving.
Each own-game JPG must be sent immediately with scenario/build/status metadata.
This prepared baseline is source-bound development evidence, not acceptance of
the final terrain or a photorealistic comparison. No image comparison is claimed
until those real game views are captured and inspected.

Checks:7/7new panorama metadata/URL/date bindings and9/9combined sampled-target
coverage records;3/3prepared-camera projection/heading/FOV bindings. No full
npm/physics/import/syntax gates were run for this documentation/numeric receipt
update. No runtime, generator, building, source-world or catalogue changed.

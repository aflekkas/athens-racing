# Penteli map: sources and fidelity notes

Built 2026-10-13. This is a real-road reconstruction, not the official Anavasi Dionysou race course.

## Route chosen

**Dionysos → Agios Petros → Karakanta**, 9,896 m timed distance, with 292 m of start run-up and 292 m of finish run-out. Start at Dionysou × Vomou Dionysou, follow paved provincial road EP29 around the north/back of Penteli, turn right at Agios Petros onto EP5 toward Palea Penteli, and finish near Karakanta spring/pass. OSM calls both roads Dionysou; route selection uses the connected road graph and provincial road references, not name matching.

The first 5.45 km rolls through a shallow valley. The final 4.44 km is mainly climbing. Game elevations are about 476 → 715 m, with 315 m accumulated ascent and 76 m descent. We deliberately preserve the real early descent. Continuing from the fork toward Nea Makri/Marathon would descend toward the coastal plain, so we chose the Penteli branch. Ntrafi/Drafi and Ntaou Pentelis are different southern/eastern settlements; Rapentosa waterfall/quarry tracks are not substituted for the paved road.

- Exact fork: [OSM node278007766](https://www.openstreetmap.org/node/278007766), 38.0719843°N,23.9345426°E.
- Chapel: [OSM way368804380](https://www.openstreetmap.org/way/368804380), around38.0720891°N,23.9343704°E. Older GeoNames results place the name west of the actual road fork.
- Karakanta spring: [OSM node1172662193](https://www.openstreetmap.org/node/1172662193), 38.0670148°N,23.9008502°E.
- [Local Athens HHH driving instructions](https://www.athenshash.com/Main_HTML/resources-hare.htm) independently describe approaching from Dionysos and turning right toward Paleio Penteli at Agios Petros.
- [Municipality of Penteli mountain-bike routes](https://penteli.gov.gr/%CE%BF%CF%81%CE%B5%CE%B9%CE%BD%CE%AE-%CF%80%CE%BF%CE%B4%CE%B7%CE%BB%CE%B1%CF%83%CE%AF%CE%B1-mountain-bike/) distinguish this asphalt corridor from the adjoining dirt roads and trails.
- [PEPA2019 event](https://www.pepa.gr/index.php/topics/topic/1839) describes a7.5km Aetorachis–Agios Petros climb. Its start was not independently geocoded and is not asserted to be in Dionysos town. Our course is not that event.

## Planimetry and land cover

Primary [OpenStreetMap API](https://api.openstreetmap.org/api/0.6/map) XML extracts, fetched2026-10-13, converted to `raw/osm.json`. Original extent and partial southwest scenery coverage are recorded in `osm3s.coverage_note` and `research.md`. The selected route has complete source nodes. Main ways:222736614,507294913,127528594,124519741,124518687,124517416,127528596,127528595,224029663,838986165,124517366,224029848. Main roads are tagged secondary/asphalt/two lanes; bridge segments inherit their adjacent paved roadway.

- License: [© OpenStreetMap contributors, ODbL](https://www.openstreetmap.org/copyright).
- The route is resampled at1m, horizontally smoothed with Gaussianσ3m, then resampled at2m. This removes polyline kinks while retaining real hairpins.
- Width6.8m is a visual modelling estimate for the two-lane road, not a surveyed measurement. Scenery details use source footprints/land-cover where present and procedural dressing between them. Individual pine species are visual approximations rather than a botanical survey.
- White quarry surfaces come from mapped quarry/rock polygons. Off-route quarry access tracks do not become race shortcuts.

## Elevation

[EU-DEM v1.1,25m source resolution](https://www.opentopodata.org/datasets/eudem/), queried through [OpenTopoData](https://api.opentopodata.org/v1/eudem25m). Two distinct sample sets:

1. Terrain:123×128 samples at100m, bilinear API samples.219 null coastal cells at the far eastern edge use−5m per the existing game convention; no inland missing values. The rendered route corridor stays inland.
2. Road:438 direct API samples at24m station spacing, saved with WGS84 coordinates in `raw/route-dem.json`.

Raw road samples contain implausible31–46% slopes near cuttings, especially around s6552–6624m. The drivable road uses linear interpolation and a Gaussianσ120m longitudinal filter, without flattening the course or imposing the Riviera7% grade cap. Maximum deviation from the raw samples is17.52m; maximum model grade15.5%. This is a DEM reconstruction, not surveyed civil-engineering road levels. The proof plot exposes raw and filtered data together.

The10m terrain.bin grid is an interpolation/carving grid, not a claim of10m source DEM accuracy. Road cutting blends out over37m beyond the immediate7m half-corridor.

## Satellite and fire context

[Esri World Imagery export](https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=23.886%2C38.06%2C23.941%2C38.10&bboxSR=4326&imageSR=4326&size=1600%2C1164&format=jpg&f=image), EPSG4326, west23.886/south38.06/east23.941/north38.10,1600×1164. Reference only, retained in ignored `.scratch/penteli/`; not shipped as game textures. Imagery acquisition date not established. Attribution: Esri and World Imagery providers.

Satellite imagery shows largely tawny exposed slopes and dark low regrowth, with more mature vegetation near town. [Penteli municipality2024 fire chronology](https://penteli.gov.gr/xroniko_fotias/) and [NASA MODIS24August2024 burn-scar image](https://modis.gsfc.nasa.gov/gallery/individual.php?db_date=2024-09-03) support regional fire context. They do not establish precise roadside burn polygons. The subsequently inspected September2025/March2026 Street View panoramas directly confirm burned standing trees and low regrowth on the selected road; individual reconstructed trees remain representative, not surveyed placements.

## Street-level inspection and visual evidence

Public Google Maps Street View is the preferred source. Eight camera stations are snapped to actual OSM nodes in `.scratch/penteli/stations.json`. The public UI is inspected in a single browser session through `tools/browser-slot.sh`. Raw Street View PNGs and URL/date metadata stay in ignored `.scratch/penteli/`; attribution remains visible. The Static API was also probed and correctly requires an API key; no key is needed for the public Maps UI. The first KartaView probe used invalid bounding-box parameters and returned restricted access. Correct public `/2.0/photo/` calls using latitude, longitude, zoomLevel=15 and join=sequence returned HTTP200/apiCode601 (‘The request has an empty response’) at the town start, fork and pass. These empty responses do not establish regional coverage; the public viewer remains a separate check.

The headed public-UI control at Syntagma (37.97553, 23.73481) successfully rendered a real July 2014 panorama credited to Oleg Andriychuk. Google retained hidden “No Street View imagery” text in the page despite the visible panorama; text-only failure detection was therefore discarded. The nearest-panorama Maps URLs API form requires no key. The KartaView public viewer loaded a base map without visible image markers in this route extent; Mapillary loaded green coverage lines on the Penteli/Nea Makri road, but no individual Mapillary photo was inspected in that first viewer pass.

All eight route panoramas were successfully captured through the public Maps UI and personally inspected on2026-10-13. Full URLs, panorama IDs, actual snapped coordinates, requested OSM nodes and headings are recorded in `street-stations.json`. Images and attribution remain in ignored `.scratch/penteli/street-01.png` through `street-08.png`.

| Station | Source date | Inspected features |
|---|---|---|
|01 · Dionysos start|September2025|Dense mature pines, paved side junction, weathered asphalt and double white line.|
|02 · EP29 bends|September2025|Burned fine-branched snags, low regrowth, rocky cut, narrow verge, double centre and edge lines.|
|03 · Low valley|September2025|Low scrub, exposed slopes, rough gravel shoulder and two-lane asphalt.|
|04 · Eastern approach|September2025|Outer steel guardrail and gravel pull-off, exposed uphill slope.|
|05 · Agios Petros fork|September2025|Broad paved junction, natural rock face inside turn, white retaining boundary beyond junction, coastal-plain view.|
|06 · Main ascent|March2026|Substantial natural layered rock cutting on uphill/left side, white edge markings, exposed rocky downhill verge.|
|07 · Upper ascent|March2026|Burned standing pines, low regrowth, open sightline across the slope.|
|08 · Karakanta|March2026|Spring access, large deciduous grove, low stone boundary, open downhill views.|

The Penteli-specific road surface preserves the 6.8 m carriageway estimate and route heights. All eight panoramas support double solid white centre lines; paint is continuous with slight surface variation rather than the heavily chipped generic material. Narrow, irregular gravel margins replace the broad generic shoulder and kerb strips. Barrier runs, rock cutting extent, trees and facade dimensions are reconstructed estimates; the comparison sheets are evidence for review, not a claim of photogrammetric fidelity.

Evidence gate: `comparison-01.png` through `comparison-08.png` must each contain an actual street image plus the corresponding live game render, with both source and game metadata explicitly marked `visually_verified: true` after inspection; `satellite-overlay.png` and `elevation-profile.png` must be visually reviewed. Missing or inaccessible imagery must be reported explicitly, never replaced with synthetic source images.

## Reproduce

1. Restore/fetch primary OSM extracts into `raw/osm.json` (see `fetch_osm.py`).
2. `node tools/maps/penteli/route.mjs`
3. `python3 tools/maps/penteli/fetch_dem.py` and `python3 tools/maps/penteli/fetch_dem.py --route-only`
4. `node tools/maps/penteli/build.mjs`
5. `node --import ./tools/physics-test/register.mjs tools/maps/penteli/validate.mjs`
6. Capture eight public Street View and live-game stations with the browser slot wrapper, then run `proof.py` with numpy/matplotlib/Pillow to draw geographic evidence and paired sheets.

Events bundled: `penteli-tt` (elapsed-time TT), `penteli-race` (three AI rivals), `penteli-descent-tt` (reverse TT). All use closed road traffic=0. Reverse is a descent from Karakanta followed by the genuine rolling return to Dionysos.

### Scenery implementation limits

The panorama-driven visual pass uses a Penteli-only terrain material, including in LOW graphics where the generic pipeline otherwise replaces terrain textures with flat vertex colours. Mottled olive maquis, golden grasses and grey limestone vary with slope and multi-scale noise. Dense instanced broadleaf scrub and scattered rocks provide roadside volume; no route or DEM heights are changed. The palette represents a dry-season reconstruction, with the leafless Karakanta grove specifically evidenced by the March 2026 panorama. A single simulation season cannot reproduce both source dates exactly.

Station04 directly supports the left guardrail run near the outer bend; other engineering placements remain terrain-based estimates. Station06 supports the layered left-hand natural cutting; its visible face follows the existing clamped terrain and DEM top. The Karakanta grove is reconstructed as branching deciduous planes from station08 and the 2021 landmark photographs; individual trunk positions and dimensions are estimates. The unused Marathon branch has a separately smoothed visual surface anchored at the junction, without changing the drivable stage.

The chapel plan is the actual OSM footprint; the narrow terracotta gable, cream entrance, stone porch columns and flat adjoining stone compound are refined from the inspected 2021 Boskovits photographs. Dimensions and entrance subdivision remain visual estimates. Rails, drains and low retaining walls are inferred from DEM cuts and drops, not surveyed barrier runs. Fork sign destinations are reconstructed from geography, not transcribed from a source photograph. The unused EP29 continuation is drawn from source way224029663, so the Marathon/Nea Makri fork remains visible. Villas use actual mapped footprints; facade details are illustrative. Mature tree distribution is reduced to match the sparse satellite reference. Burned snags and regrowth follow observed road corridors; individual positions are procedural. The photographed kandylaki at Agios Petros is documented but its exact placement remains unresolved.


## Additional public photo references inspected, 2026-10-13

[ΤΑΞΙΔΕΥΟΝΤΑΣ / D. Boskovits, “Πεντέλη: 4 εξωκκλήσια.”](https://dboskovits.blogspot.com/2021/02/4.html), published **2021-02-01**, provides firsthand photos of the actual Agios Petros chapel and Karakanta spring. Photos were visually inspected and retained only as research evidence in ignored `.scratch/penteli/references/`, with original image URLs and location clues in `dboskovits-photos.json`. The precise image capture day is not established; publication predates the August 2024 fire.

- Agios Petros exterior (`dboskovits-00.jpg`, `-56.jpg`, `-57.jpg`, `-62.jpg`): cream/plastered entrance beneath a terracotta-tile gable, timber roof/beam structure, stone porch pillars, adjoining rough stone masonry and doorway, flagstone courtyard, mature pines, pergola and flags. Named-location anchor: OSM chapel way368804380 around38.0720891°N,23.9343704°E. These are landmark views, not road-facing camera stations.
- Karakanta (`dboskovits-01.jpg`, `-10.jpg`, `-11.jpg`): broad low stone fountain wall, paved approach, picnic benches, large plane trees and shaded planted surroundings. Named-location anchor: OSM drinking-water node1172662193 at38.0670148°N,23.9008502°E. These support finish-area landmark treatment, not an exact asphalt cross-section.
- Remaining end-of-trip chapel interior images do not count as roadway evidence. The article's mention of four asphalt kilometres returning to Agios Petros describes the ride, not the viewpoint of every accompanying photograph.

[OrestisTrips, motorcycle trip via Penteli and Marathon lake](https://orestistrips.blogspot.com/2021/11/motorcycle-ride-to-amfiaraeion-ancient.html), posted in **November 2021**, contains twelve downloaded Penteli-area photos (`orestis-00.jpg`–`-11.jpg`). Original image URLs, creator attribution and caption context are in `orestis-photos.json`. `-08.jpg` and `-09.jpg` show actual asphalt, a double white center line, white edge lines and roadside shrubs; their precise coordinates remain unverified. Earlier Athens-facing viewpoints are on Penteli's southern side, outside the chosen stage. Its standalone roadside fountain differs from the larger Karakanta park fountain. These photos are general visual references and do **not** establish eight matched route stations.

The article embeds [OrestisTrips's 157.7-second motorcycle clip](https://3speak.tv/watch?v=orestistrips/dgajmcmn) and [79.1-second static “silence” clip](https://3speak.tv/watch?v=orestistrips/ivylhsty). Public author metadata retrieved through the Hive API dates the static clip to2021-05-22 and gives38.0608°N,23.8968°E, southwest of our finish; its raw metadata is in the same ignored reference folder. 3Speak pages/video endpoints returned403 or timed out in this environment, so no video frames were viewed and no playback timestamps are asserted. The motorcycle metadata's “Sounio” label conflicts with its listed northern coordinates, so it is not used to georeference the route.

A publicly indexed [Agios Petros drone video](https://www.youtube.com/watch?v=3u63-ATjLHQ) is a potential aerial landmark reference. Playback was not obtained here. The creator asks for redistribution via YouTube with attribution; it is not treated as road-level coverage.

These are publicly accessible creator-published sources, not an established reusable texture library. No photographs/video are shipped as game textures, and no free redistribution license is asserted. These supplementary landmark sources do not themselves establish the eight road stations; the separate Google panoramas recorded above provide that coverage.


## Final visual and runtime verification · 2026-10-13

All eight final live-game frames were captured at the recorded snapped panorama coordinates with horizontal FOV 90 degrees and camera-bearing error below 0.01 degrees. The final pass uses clear afternoon conditions at LOW quality, so its terrain texture and vegetation remain available on the software renderer. The capture's page/console error list is empty, and switching Penteli → Megara → Penteli completed with no errors. The temporary server and browser closed together afterward. Every source image, game frame, paired comparison, geographic overlay and elevation plot was personally reviewed.

Evidence paths: `.scratch/penteli/comparison-01.png` through `comparison-08.png`, `satellite-overlay.png`, `elevation-profile.png`; source and game metadata are alongside them. Full tracked source references are in `street-stations.json`. `proof.py` only assembles pairs after both images are marked visually verified. Earlier failed shader/server captures are not the final evidence.

Validation: `npm test` passed; the physics regression reported 62 passed / 0 failed; the bundle validator passed; a Three.js CPU check confirmed finite upward-facing road geometry and unchanged route XYZ/terrain H arrays. Both shipped data files remain byte-identical to the geometry approved before this visual pass (map SHA256 `7f262e515fdbe594dfacc2bc8ff386151098ba50ed13ccd4b281f6857b1f8f35`; terrain SHA256 `68a13575cf4b1ff36f2fa1e606dc49f3c18527b65cf9ff517fd991316e030cbb`).

Remaining limits are visible rather than hidden: vegetation uses repeated procedural templates, the coarse terrain cannot reproduce every ditch/rock-cut profile, the fork's tight stage sweep differs from the real broad asphalt junction, the fountain enclosure and small shrines are not fully modelled, and distant urban detail is sparse. Source images span September 2025 and March 2026; the game is a single seasonal reconstruction, not photogrammetry.

## Width and barriers (2026-10-15)

The cached `road-network-source.json.gz` has `lanes=2` on most route ways and no explicit `width` tags. The earlier uniform 6.8 m estimate is superseded by 7.2 m for secondary roads, with a smooth allowance of up to 0.6 m at tight apexes. This stays a reconstruction within the requested two-lane scale, not a surveyed width. `widths.mjs` prefers numeric OSM width, then lanes and highway-class defaults; it also records source tags and the two bridge ranges in the map bundle. Neither route axis nor timing stations change.

The photographed station04 steel run remains a source constraint. Additional W-beam runs are inferred from the rendered terrain at 8/16/24 m beyond the carriageway edge, requiring a downhill slope and drop; outer curves use a lower drop threshold. Twelve-metre approach extensions avoid isolated hazard samples. Mapped mouths, side-road surfaces and the Agios Petros fork retain gaps. Steel ends flare outward and turn down over 6 m. Posts and beams use the rendered ground height. OSM bridges 124519741 and 127528596 receive short concrete New Jersey parapets on both sides; their material is representative, not photo-verified. Unknown culverts and stone walls are not invented.

Width feeds the existing markings, terrain envelope, prop/sign offsets, AI, spawn and tow corridor through `route.edge()`. Collision uses the existing solid rail limits and tangential sliding response. Geometry is merged by material in 240 m cells; posts are instanced. Both use the graphics preset's distance scaling.

Other-map audit: Riviera already generates W-beams from coastal proximity and a >2.2 m drop at 6 m, with junction gaps. Its six-metre probe overlaps the new terrain re-entry apron, so non-coastal embankments merit a separate wider-probe audit. Megara already has mapped tyre-wall paths plus concrete boundaries; no mountain-rail policy was applied to the circuit. Neither map was changed.

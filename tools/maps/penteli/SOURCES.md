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

Satellite imagery shows largely tawny exposed slopes and dark low regrowth, with more mature vegetation near town. [Penteli municipality2024 fire chronology](https://penteli.gov.gr/xroniko_fotias/) and [NASA MODIS24August2024 burn-scar image](https://modis.gsfc.nasa.gov/gallery/individual.php?db_date=2024-09-03) support regional fire context. They do not establish precise roadside burn polygons; do not represent procedural sparse vegetation as a surveyed post-fire map.

## Street-level inspection and visual evidence

Public Google Maps Street View is the preferred source. Eight camera stations are snapped to actual OSM nodes in `.scratch/penteli/stations.json`. The public UI is inspected in a single browser session through `tools/browser-slot.sh`. Raw Street View PNGs and URL/date metadata stay in ignored `.scratch/penteli/`; attribution remains visible. The Static API was also probed and correctly requires an API key; no key is needed for the public Maps UI. KartaView's photo API probe returned restricted access and is not claimed as a viewed source.

Evidence gate: `comparison-01.png` through `comparison-08.png` must each contain an actual street image plus the corresponding live game render; `satellite-overlay.png` and `elevation-profile.png` must be visually reviewed. Missing or inaccessible imagery must be reported explicitly, never replaced with synthetic source images.

## Reproduce

1. Restore/fetch primary OSM extracts into `raw/osm.json` (see `fetch_osm.py`).
2. `node tools/maps/penteli/route.mjs`
3. `python3 tools/maps/penteli/fetch_dem.py` and `python3 tools/maps/penteli/fetch_dem.py --route-only`
4. `node tools/maps/penteli/build.mjs`
5. `node --import ./tools/physics-test/register.mjs tools/maps/penteli/validate.mjs`
6. Capture eight public Street View and live-game stations with the browser slot wrapper, then run `proof.py` with numpy/matplotlib/Pillow to draw geographic evidence and paired sheets.

Events bundled: `penteli-tt` (elapsed-time TT), `penteli-race` (three AI rivals), `penteli-descent-tt` (reverse TT). All use closed road traffic=0. Reverse is a descent from Karakanta followed by the genuine rolling return to Dionysos.

### Scenery implementation limits

The chapel plan is the actual OSM footprint; its3.3m height, plaster and gabled tile roof are conservative illustrative massing pending street-level verification. Rails, drains and low retaining walls are inferred from DEM cuts and drops, not surveyed barrier runs. Fork sign destinations are reconstructed from geography, not transcribed from a source photograph. The unused EP29 continuation is drawn from source way224029663, so the Marathon/Nea Makri fork remains visible. Villas use actual mapped footprints; facade details are illustrative. Mature tree distribution is reduced to match the sparse satellite reference. No precisely placed burned snags or named roadside shrines are invented.

# Megara Circuit source record

Researched and retrieved 2026-10-13. This is a georeferenced reconstruction, not a laser-scanned or surveyed circuit. The current bundle retains source scale and location.

## Geometry and elevation

- **OpenStreetMap:** [motor circuit way 70043234](https://www.openstreetmap.org/way/70043234), downloaded through the [OSM map API](https://www.openstreetmap.org/api/0.6/map?bbox=23.360,37.984,23.369,37.990). Snapshot: `raw/map.osm`; JSON extracts: `raw/context.json`, `raw/raceway.json`. ODbL, © OpenStreetMap contributors. Motor circuit is a 79-vertex closed ring; kart circuit [70043225](https://www.openstreetmap.org/way/70043225) is separate. Its 83 mapped vertices (including the duplicate closure) are exported without shape alteration as projected numeric `[x,z]` pairs in `circuit.kartRoute`, for the southeast kart-track scenery. Way 70043231 is an eastern circuit shortcut, **not the pit lane**.

### Offline circuit access inclusion

`tools/world-gen/regions/megara.json` explicitly includes only OSM motor raceway way **70043234** as the playable closed circuit. The source snapshot tags it `highway=raceway`, `sport=motor`, `access=private`; its use here represents the known racing game venue, not a public road designation. The importer verifies this exact way, the source hash and the 1,999.599799 m / 2,001-sample derived centreline. Kart way **70043225** and shortcut **70043231** remain scenery or restricted source roads. All other private or conditional OSM ways retain restricted graph flags. A route file cannot enlarge this inclusion list.
- **EU-DEM v1.1:** [OpenTopoData EU-DEM endpoint](https://api.opentopodata.org/v1/eudem25m?locations=37.987,23.364). `raw/dem.json` stores the 31 × 31 grid at 120 m sampling over a 3.6 km square. The source DEM has nominal 25 m cells, but this stored grid is coarser. Bilinear interpolation creates the runtime 10 m grid; the route vertical profile is smoothed. Track heights are approximately 7.1–11.1 m ASL. These are regional ground elevations, not measured kerb heights or banking.
- **Esri World Imagery:** [export request](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=23.359,37.9825,23.369,37.9915&bboxSR=4326&imageSR=4326&size=1600,1600&format=jpg&f=json). The server expands the requested extent: the actual 1600 × 1600 image is longitude **23.359–23.369**, latitude **37.982–37.992**. Metadata is `.scratch/megara/references/satellite-georef.json`. This imagery is for visual reference and verification only; it is not bundled as a game texture. © Esri and its imagery contributors.

### Length and width limitations

The projected raw OSM ring is 1996.21 m and the smooth runtime centreline **1999.60 m**. Published nominal length is **2100 m**. The reconstruction deliberately does not enlarge the track by 5% merely to match that published figure: doing so would misalign it with the actual aerial image and mapped facilities. The difference may reflect nominal measurement, configuration or source mapping; its cause has not been established.

[RacingCircuits.info](https://www.racingcircuits.info/europe/greece/athens-circuit.html) reports the 2.1 km nominal circuit and approximately 11–12 m width. [Guido de Carli's circuit archive](https://www.gdecarli.it/php2/circuit.php?var1=413&var2=2) attributes 11.15 m minimum / 12.6 m maximum to the historic official website. The old `athenscircuit.gr` hostname did not resolve during this research. The game uses **11.5 m constant nominal width**, not falsely precise measured width variation.

Periodic chord-weighted Hermite interpolation passes through the OSM centreline, then is resampled uniformly at approximately 1 m. The minimum radius from the runtime smoothed curvature is approximately 13.6 m. Small-radius details between source vertices are interpolation, not survey measurements. Racing-line lateral offsets are zero, giving AI a continuous safe centreline to optimize independently.

## Street View rule: attempts and results

Google Street View was tried first in the collaborative browser, without an API key. For the direct panorama probes below, `preview_snapshot` returned the text **“No Street View imagery available here.”**, while the inspected screenshots showed a black panorama canvas, not a readable error banner. The resolved URLs contained `0a` and an empty panorama identifier. Google Maps can expose hidden fallback text in its DOM even when imagery is available: these results therefore establish only that **no panorama was successfully inspected in this attempt; coverage remains unverified**.

- [North circuit boundary, 37.98903, 23.3628](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.98903,23.3628&heading=160&pitch=0&fov=90)
- [Public road north of circuit, 37.9913, 23.3609](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.9913,23.3609&heading=150&pitch=0&fov=90)
- [Western access road, 37.9849, 23.3594](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.9849,23.3594&heading=90&pitch=0&fov=90)
- [Public approach southwest, 37.98398, 23.35924](https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=37.98398,23.35924&heading=40&pitch=0&fov=90)

Evidence: `.scratch/megara/references/streetview-no-coverage.png` (legacy filename; the image shows a black canvas and **does not prove absent coverage**). No API-key request appeared. The earlier area-wide no-coverage interpretation is withdrawn.

A second controlled browser session on 13 October 2026 revisited the southwest public approach and northern public road. Both exact coordinates again resolved to `0a` URLs with no panorama identifier and black canvases. In the same browser, the Syntagma control rendered a genuine September 2017 panorama credited to Gabriele D'Ambrosio. These screenshots were personally inspected: `streetview-access-road.png`, `streetview-north-public.png`, and `streetview-syntagma-control.png` under `.scratch/megara/references/`; requested/final URLs are in `streetview-verification.json`. This confirms that the browser could render Street View, but **no panorama resolved at the two exact Megara probe points**. It does not establish absence of coverage on every nearby road. Verified track-level evidence comes from the photographs and onboard frames below.

[Mapillary](https://www.mapillary.com/app/?lat=37.987&lng=23.364&z=15) was inspected: coverage lines appeared on the northern motorway, but no circuit/access-road imagery was selected. KartaView's public photo bbox endpoint returned `400 Restricted access!`. Neither was used as a claimed track-level source.

## Verified ground-level photographs

Downloaded references remain in `.scratch/megara/references/` for local review, with original watermarks. They are not shipped as game assets.

- [BIKEIT, Megara track day, 28 May 2023](https://www.bikeit.gr/reportaz/item/34517-reportaz-track-day-motosykletwn-megara-28-5-2023). Individual gallery files `gallery-01.jpg`, `05`, `09`, `15`, `20`, `25`, `30`, `35`, `38`, `41`, `43`, `46`; overview `gallery-contact.jpg`. Original URL pattern: `https://www.bikeit.gr/media/k2/galleries/34517/bikeit_cfmoto450sr_megara_40.jpg` (replace `40` with gallery number). Observed: turquoise/green paddock canopies, light corrugated sheds, two-storey white clubhouse with glazed balcony, low metal guardrails, black tyre stacks, worn red-and-white inner kerbs, pale dusty run-off and patchy grass, mountains beyond the circuit. `start-gantry-2023.jpg` is gallery 40, showing the white START cantilever with checkerboard support.
- [RallyDiaries, 7th HTTC open track day 2019](https://rallydiaries.eu/en/7th-httc-open-track-day-2019): `start-straight.jpg` and `pit-lane.jpg`. Gantry, small white timing hut, pit shade structure and low industrial roofs cross-check the 2023 gallery.
- [MOTOMAG, Megara Supermoto round 2020](https://www.motomag.gr/supermoto-panellinio-prot-2020-1os-agonas-megara): `supermoto-infield.jpg` shows the timing grid and rural surroundings.

**Rejected references:** commercial RaceX Megara page images saved as `grid-modern.jpg` and `final-corner-modern.jpg` show a large stepped grandstand incompatible with the Megara aerial layout. They were excluded from modelling; page captions alone were insufficient provenance.

## Onboard video and six-location reference set

[“Megara circuit on board 2021”, Ioannis Marinakis Racing](https://www.youtube.com/watch?v=DTiXBVgxxuY). Found via [Laptrophy's Megara page](https://www.laptrophy.com/en/tracks/crhw2b-Athens-Megara-Circuit). The video played normally in the collaborative browser. The CLI downloader returned a bot-verification request and was not used; frames were captured from the normal browser video player. All listed frames were inspected.

The files below are video time, **not lap time**. Route stations are visual estimates for matching the in-game camera, not GPS telemetry:

| Local reference | Estimated route station | Matching location / observed details |
| --- | ---: | --- |
| `onboard-00.jpg` | 260 m | Exit from first left-hand complex, westbound; grassy inner edge and sparse structures |
| `onboard-07.jpg` | 510 m | Western tight right hairpin, pit sheds ahead; low red-white inner kerb |
| `onboard-15.jpg` | 700 m | Northwest right corner onto long back straight; outside fence and rural backdrop |
| `onboard-22.jpg` | 1000 m | Back straight; worn pale asphalt, low vegetation, distant hills |
| `onboard-30.jpg` | 1290 m | Eastern right hairpin, broad worn red-white kerb and grassy inside |
| `onboard-40.jpg` | 1670 m | Southwest approach, white clubhouse visible on driver's left |
| `onboard-50.jpg` | 1900 m | Final right exit toward timing straight, START sign ahead-right |
| `onboard-55.jpg` | 0 m | Timing/pit straight, open rural horizon |
| `onboard-60.jpg` | 150 m | First left apex, worn kerb close to rider |

Additional detail frames: `onboard-32.jpg`, `35`, `37`. Motorcycle lean tilts the images and fairing partly obscures the view; do not interpret camera roll as road camber.

## Rebuild and visual validation

Run `node tools/maps/megara/build.mjs` from the repository root. It needs no packages or network: all numeric source snapshots are checked in. Outputs are `data/maps/megara/map.json` and `terrain.bin` using the same binary header/class format as Riviera. Local origin is **37.987 N, 23.364 E**, +x east, +z south. The clockwise timing line is projected onto the road beside satellite pixel `(669,801)`.

The terrain is inland; `sea:false`. No nearby sea is invented around the circuit. Geographically distant Saronic views are only valid where terrain permits, and are not established by these references.

`circuit.kerbs` are estimated inner-bend runs from route curvature, checked against ground images; exact lengths and 45 mm height remain approximations. `circuit.pavedAreas` and `pitLane` trace the satellite pit apron and service strip. OSM building footprints are retained, with approximate heights supplied for modelling. Grass, barriers, trees and facilities require renderer interpretation; they do not acquire survey accuracy from this data format.

The reviewed `.scratch/megara/satellite-overlay.png` shows the generated centreline directly over Esri imagery, labelled every 100 m. `.scratch/megara/satellite-overlay.html` is its reproducible local canvas view. This verifies georeferencing and gross shape; it does not prove centimetre-level corner geometry.

### Scenery interpretation and proof artifacts

The terrain uses the source DEM without the Riviera renderer's artificial limestone relief. Satellite-traced infield and agricultural parcels use green and dry-yellow grass, with gravel limited to the interpreted run-off polygons. Orchard spacing, individual cypresses, scrub, parked paddock cars and seasonal colors are representative, not individually surveyed. Asphalt and grass reuse the game's existing texture library; rubber accumulation and repair patches are visual interpretation rather than a measured surface survey.

The northern A8 carriageway trace, median and eastern warehouse position are estimated from the same georeferenced aerial image, **not extracted from OSM**. The carriageway trace uses image pixels `(-100,397) → (140,245) → (380,85) → (650,-85)`; width is estimated. The isolated southeast warehouse is centred near pixel `(1460,1367)`, with an approximate 47 × 42 m footprint. Its eight distant moving car/truck silhouettes are ambient scenery and never enter the raceway. The separate southeast kart circuit follows OSM way 70043225. The clubhouse facade, open pit bays, timing hut, canopies, armco and tyre barriers follow the ground photographs. The approximately 2.1 m galvanized diamond-mesh access fencing near the timing area and paddock is based on RallyDiaries start-straight.jpg and BIKEIT gallery09/gallery25; its exact runs and dimensions are interpreted, not surveyed. No large stepped grandstand is claimed or added.

Geraneia lies west/northwest and Pateras north of the circuit. These ranges use the regional horizon renderer's geographically located approximate silhouettes. Following the onboard comparison, Megara alone uses 1.45× vertical visual exaggeration, broader shoulders, and reduced coastal aerosol attenuation; this improves apparent relief and contrast without changing their bearings or horizontal placement. The silhouettes are not surveyed terrain. The timing/back-straight cameras face east/northeast, so Geraneia is correctly behind them. Megara town itself lies west/northwest, not east; the scene does not invent an eastern town skyline. Water visibility from the low circuit cameras remains unverified, so no sea plane or glint is fabricated.

`tools/maps-browser-test.mjs` captures eight track-level views, a supplemental northwest view, map selection and the Riviera regression view. Run it through `tools/browser-slot.sh node tools/maps-browser-test.mjs`; `MAP_TEST_QUALITY=med` enables the medium rendering tier; Megara's custom asphalt and field materials remain textured at LOW. `MAP_TEST_PROOF_ONLY=1 MAP_TEST_QUALITY=low` captures the nine Megara views without repeating the full lifecycle audit or Street View probes; it writes a separate `proof-recapture-report.json`. `tools/maps/megara/proof.py` (Pillow) builds `.scratch/megara/comparison-01.png` through `comparison-08.png` and a contact sheet. Each pairs an original onboard frame with the corresponding approximate circuit section; camera roll, focal length, season and capture stations differ and are explicitly labelled.

For a fast resource check, use `MAP_TEST_LIFECYCLE_ONLY=1 tools/browser-slot.sh node tools/maps-browser-test.mjs`. It loads all three maps three times, drives representative sections and circuit seams, crashes a traffic car before unloading Riviera, and checks scene ownership and GPU allocations. It takes no screenshots, makes no Street View requests, and preserves its result separately in `.scratch/megara/lifecycle-only-report.json`.

### Source-reviewed paved aprons

`raw/paved-runoffs.json` preserves four estimated asphalt polygons with individual source notes: the first-hairpin outer apron, eastern-hairpin outer apron, clubhouse south frontage and central linking apron. These were interpreted from the georeferenced Esri image and cross-checked with onboard frames 00/30 and BIKEIT clubhouse/linking-lane photographs. Boundary widths and material interpretation are approximate, not surveyed. The builder appends them to `circuit.pavedAreas` alongside the existing pit apron and service strip; the renderer and `Ground.at` consume these same polygons. Heights are omitted intentionally so the polygons follow the shared ground profile. Pale gravel islands and the grassy northwest clubhouse wedge are retained, rather than converting the entire infield to asphalt.

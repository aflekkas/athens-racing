# Psychiko bundle: sources, fidelity and reproduction

Built 2026-10-14. **Palaio Psychiko garden circuit, 4,285.748891 m per lap**. The one-lap time trial and two-lap race use the same closed public-road geometry; Free Roam enables civilian traffic. Race events close the road to civilian traffic, like Penteli. This is an invented event on real roads, not a real-world racing recommendation or an official circuit.

## Frozen primary geography

- `raw/osm.json.gz`: complete primary [Overpass](https://overpass-api.de/api/interpreter) response for south37.992 / west23.758 / north38.027 / east23.799. 140,439 nodes/ways, downloaded2026-10-14. OSM way IDs, exact junction coordinates, ordered way subsegments and route reasoning are in [research.md](research.md). Compressed snapshot is tracked for clean-archive rebuilding. © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL1.0. The generated map JSON and source-derived road/footprint data retain that attribution.
- `raw/route.json`: directed graph path, primary node chain, ordered source ways, periodic2 m route and coordinate projection. Every raced way explicitly has `surface=asphalt`, car-road highway class, no private/no access restriction. The raw path respects OSM one-way directions, including roundabout flow. All nodes are unique until the finish.
- Buildings retain actual OSM footprints; mapped height/levels are used where available. Missing heights default to two low-rise floors. Facade styles, garden walls, street-tree positions and vegetation species are illustrative.
- The7 m carriageway and1.8 m footways are modelling estimates, not surveyed widths. Both generous avenues and narrower one-way streets share this racing cross-section. No extra race shortcuts are introduced by the surrounding road network.

## Real elevations

[EU-DEM v1.1](https://www.opentopodata.org/datasets/eudem/),25 m source resolution, through [OpenTopoData's eudem25m API](https://api.opentopodata.org/v1/eudem25m). `raw/dem.json` freezes a37×39 terrain grid at100 m; `raw/route-dem.json` freezes180 direct approximately24 m road samples. No inland null samples were accepted.

A periodic Gaussian filter (sigma60 m) suppresses canopy/cutting DEM noise without flattening the real hills. The road spans184.52–203.34 m; ascent/descent35.02 m, maximum model grade5.5%; maximum deviation from direct road DEM2.12 m. `terrain.bin` is an interpolated10 m carving grid, not a10 m source survey. Runtime terrain carving protects the carriageway and pavements, including the lap seam, while keeping route XYZ unchanged.

## Street-level references actually inspected

Public Google Maps Street View was opened before scenery implementation. Reference images stay in ignored `.scratch/psychiko/` with Google's attribution intact; no imagery becomes a shipped texture.

- [Diamantidou42, south-facing panorama](https://www.google.com/maps/@?api=1&map_action=pano&pano=9Q4JR2V_ywleu6_RNyrl8Q&heading=180&pitch=0&fov=90): September2024, snapped38.0126551,23.7723670. Inspected dense pine/broadleaf canopy, stone/plaster garden walls and metal fencing, villa setbacks, pavement tiling and double white centre lines. `.scratch/psychiko/street-diamantidou.png`.
- [Agiou Dimitriou50 at Kallari](https://www.google.com/maps/@?api=1&map_action=pano&pano=OM1Pkpuc2Z4EJ7VKZpgIow&heading=210&pitch=0&fov=90): April2026, snapped38.0118376,23.7787348. Inspected broad paved junction, mature umbrella pines, garden hedges, narrow footways and street signs. `.scratch/psychiko/street-kallari.png`.
- Primary contextual references: [Czech Embassy directions](https://mzv.gov.cz/athens/en/kontakty.html) and [BLP's actual Diamantidou villa](https://blp.gr/projects/psychico-house-diamantidou-street/). They substantiate street identity and villa/garden character; the latter property is not individually modelled.

These are two inspected source stations, not a photographic survey of every street. The shared Greek street kit reconstructs OASA stops, villa gates/walls, kerbs, lamps and street life. Pines, citrus, cypress, olive and Mediterranean shrubs use shared instanced nature systems. Source dates differ, while the game has one representative season. Embassies are part of the real suburb's context but no individually identified embassy facade is claimed.

## Reproduce offline from the committed archive

```sh
node tools/maps/psychiko/route.mjs
node tools/maps/psychiko/build.mjs
node tools/inject-speed-signs.mjs psychiko
node tools/maps/psychiko/preview.mjs
node tools/maps/psychiko/validate.mjs
node --test tools/psychiko-world.test.mjs
```

To refresh primary data, run `python3 tools/maps/psychiko/fetch_osm.py`, rerun `route.mjs`, then `python3 tools/maps/psychiko/fetch_dem.py` and `python3 tools/maps/psychiko/fetch_dem.py --route-only`. Refreshing live sources changes the route version and should be reviewed as a new track revision. Selector regeneration uses `tools/build-attica-map.py` with its documented Python GIS dependencies; no such dependency is used at runtime.

Production packaging, multiplayer catalogue/route signatures, world-worker URLs, release assets and offline precaching read the enabled map registry. Raw map JSON is approximately0.6 MiB and terrain approximately0.4 MiB, comfortably below the25 MiB per-file deployment cap.

## Runtime evidence and limits

Headless Chrome was run against `npm start`. An unrelated app already owns127.0.0.1:8000; the test server therefore uses `PORT=8001 npm start` at `http://localhost:8001`. The unrelated server was left running. A complete two-lap three-rival race counted all checkpoints and finished in417.93 simulated seconds, with zero player crashes and zero browser console errors. Automated-driving records correctly have `valid=false` and cannot submit to the board.

Driving evidence in ignored `.scratch/psychiko/`: `driving-pavlou.png`, `driving-diamantidou.png`, `driving-kallari.png`, `race-finish.png`, and `drive-proof.log`. File labels identify the route leg; exact captured stations in the log were approximately325 m,1,943 m and3,832 m. The player stays on the carriageway; photographed source features and live game images were personally opened and inspected. Additional inspected captures: `free-roam.png` (nine active civilian cars; traffic enabled), `tow-kallari.png` (tow repaired damage and returned all wheels to road height at station2450), and `free-proof.log`. The time trial launched with one lap and zero rivals. A live WebSocket client also received Psychiko in the catalogue, matched route version34c7d1b2 and successfully created its race lobby.

Known reconstruction limits: repeated procedural villa facades/trees, estimated road widths and garden boundaries, coarse DEM relief, simplified roundabout islands and sparse distant urban detail. This is a real-geography game reconstruction, not photogrammetry or a road-engineering survey.


Final committed-code checks also passed from a clean `git archive`: `npm test` (668 passed / one existing skip), physics regress (172 passed), events (11 passed), syntax (205 modules), browser imports (169 modules), maps traversal, map resource checks and primary-source route validation. The final staging Wrangler dry-run stayed local; no push or deployment occurred. Psychiko's compressed baked terrain is1,164,476 bytes and surrounding roads13,010,248 bytes, below25 MiB. Desktop and phone selectors were personally inspected in `selector-desktop.png` and `selector-phone.png`; headless selector proof is `selector-headless.png`.

Current staging menus intentionally expose Quick Race and Free Roam only. Psychiko is selectable in both. The bundled `psychiko-tt` time trial stays disabled like the Megara and Penteli trials. The shared multiplayer catalogue continues to offer exactly Quick Race and Free Roam.

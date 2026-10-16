# Psychiko sources and reproduction

Revision: 2026-10-15. Fictional closed-road event on real public streets. The roundabout-corrected loop is **6,377.347666288163 m per lap** (supplied red loop: 5,960.933287659299 m); `psychiko-race` is two laps with three rivals. `free:psychiko` is the existing shared untimed free-roam event, with traffic/street life and no roadworks. `psychiko-tt` stays disabled. The former **4,285.748891 m** loop remains drivable rather than becoming a second race event.

## Frozen inputs

- `raw/osm.json.gz`: original 2026-10-14 primary [Overpass](https://overpass-api.de/api/interpreter) response for south 37.992 / west 23.758 / north 38.027 / east 23.799. Nodes, ways and source IDs are retained. © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0.
- `raw/boundaries.json`: prior partial-work Overpass response, with source URL/query embedded, including municipal relation [1403235](https://www.openstreetmap.org/relation/1403235) for Palaio Psychiko. Adjacent relations identify Filothei and Neo Psychiko. The public motor-road network in Palaio Psychiko, the drawing's northern extension and the original route ways are selected. Public-road selection excludes private/no motor access, private driveways and non-motor paths.
- `raw/drawn-course.json`: reviewed exact node and edge-way list from the supplied drawing match; `route.mjs` validates it against the frozen OSM snapshot. `raw/route.json` is its deterministic smoothed/resampled result. Some one-way segments are intentionally reversed for the closed race. Three short residential connections lack explicit surface tags; pavement is inferred there. The thick, photographed drawing and its approximate georeferencing do not establish survey-level lane or junction accuracy. See [research.md](research.md).
- `raw/garden-route.json` and `raw/garden-route-dem.json`: unchanged first-version route and elevation sources. Verification checks every third sample of that old loop remains drivable.
- `raw/dem.json`: original 37×39 terrain grid at 100 m spacing from [EU-DEM v1.1, 25 m source resolution](https://www.opentopodata.org/datasets/eudem/), via [OpenTopoData](https://api.opentopodata.org/v1/eudem25m). `raw/route-dem.json`: 250 direct approximately 24 m stations refreshed on 2026-10-15. The 10 m terrain grid is interpolated carving geometry, not 10 m source accuracy. Road elevations preserve the authored world-space road bed in `raw/height-reference.json` (492f14e), add local DEM differences on new junction arcs, and use periodic Gaussian sigma 6 m; statistics are in the bundle and research document.

The shared at-grade renderer omits three selected Kifisias tunnel ways (`25117418`, `113339568`, `113339581`), outside the drawn loop along its eastern edge. Two touch the municipal boundary. These underpasses are not reconstructed by this revision; all other selected public ways have rendered road parts or belong to the primary race route.

## Street appearance

The first-version street references were personally inspected before modelling, with attribution retained in ignored `.scratch/psychiko/` PNGs:

- [Diamantidou 42, south-facing](https://www.google.com/maps/@?api=1&map_action=pano&pano=9Q4JR2V_ywleu6_RNyrl8Q&heading=180&pitch=0&fov=90), September 2024, 38.0126551 / 23.7723670: pine/broadleaf canopy, stone/plaster walls, metal fencing, villa setbacks, tiled footways and double centre lines.
- [Agiou Dimitriou 50 / Kallari](https://www.google.com/maps/@?api=1&map_action=pano&pano=OM1Pkpuc2Z4EJ7VKZpgIow&heading=210&pitch=0&fov=90), April 2026, 38.0118376 / 23.7787348: broad junction, mature pines, garden hedges, narrow footways and street signs.
- Context: [Czech Embassy directions](https://mzv.gov.cz/athens/en/kontakty.html), [BLP Diamantidou villa](https://blp.gr/projects/psychico-house-diamantidou-street/).

This implementation reuses the shared Greek street, traffic, people, nature and drivable-network systems. No source imagery is shipped as textures. Building footprints are OSM-derived; missing levels, road widths, facades, planting, walls and garden boundaries are estimates. A separate Street View research pass in `.scratch/psychiko-streetview/` is intentionally untouched and has not yet been applied to this revision's scenery.

## Rebuild offline

```sh
node tools/maps/psychiko/route.mjs
node tools/maps/psychiko/build.mjs
node tools/maps/psychiko/validate.mjs
node tools/maps/psychiko/preview.mjs
node --test tools/psychiko-world.test.mjs
```

`build.mjs` includes the shared speed-sign injection. Repeating the first three commands reproduces `data/maps/psychiko/{map.json,terrain.bin}` byte-for-byte. No live fetch, build step or Python package is needed to reproduce those bundles. Optional selector regeneration: `python3 tools/build-attica-map.py` (numpy, Pillow, shapely). It updates the geographic route in `src/attica-map-data.js`; unchanged overview pixels may leave `assets/maps/attica.svg` byte-identical at this scale.

To deliberately refresh sources: `python3 tools/maps/psychiko/fetch_osm.py`, then `node tools/maps/psychiko/route.mjs` and `python3 tools/maps/psychiko/fetch_dem.py --route-only`. Review source adjacency and access changes before rebuilding. Live refresh is not part of deterministic reproduction.

## Verification evidence

Nine focused Psychiko tests cover route/selector/server consistency, two-lap checkpoints, continuous terrain/contact, all municipal roads selected, original-course asphalt coverage, all **92 exits / 92 closures**, race/free-roam collider transitions, and production vehicle physics at **90 km/h against every closure**, with the same paths passable in free roam. Closure clearance checks protect the full raced carriageway.

Ignored `.scratch/psychiko-v2/` contains the original drawing and reviewed cyan overlay, headless gameplay screenshots, complete test logs, source/build logs and byte hashes for the unchanged Riviera/Megara/Penteli bundles. See `VERIFICATION.md` for final counts and screenshot names.

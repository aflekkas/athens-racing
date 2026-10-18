# Psychiko sources and reproduction

Revision: 2026-10-18 (Garden Circuit v2). Fictional closed-road event on real public streets. The owner-requested redesign starts and finishes on the Diamantidou radial south of the Venizelou roundabout (OSM node 272499018 is the Parnithos/Agiou Dimitriou junction the lap passes just after the line) and loops the Palaio Psychiko fan on public OSM streets only, in their legal one-way direction. The lap is **3,753.4 m**; `psychiko-race` is two laps with two rivals. `free:psychiko` is the existing shared untimed free-roam event, with traffic/street life and no roadworks. `psychiko-tt` stays disabled. Earlier loops (the 5,960.9 m / 6,377.3 m drawn loop and the 4,285.7 m garden loop) are superseded; their times are a separate board.

## Frozen inputs

- `raw/osm.json.gz`: original 2026-10-14 primary [Overpass](https://overpass-api.de/api/interpreter) response for south 37.992 / west 23.758 / north 38.027 / east 23.799. Nodes, ways and source IDs are retained. © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), ODbL 1.0.
- `raw/boundaries.json`: Overpass response with municipal relation [1403235](https://www.openstreetmap.org/relation/1403235) for Palaio Psychiko. The public motor-road network inside the municipality, the area enclosed by the lap and ways near the lap are selected. Public-road selection excludes private/no motor access, private driveways and non-motor paths.
- `raw/drawn-course.json`: the exact OSM node chain and one source way per edge of the lap, plus `startOffset` (metres along the loop from its first node; negative counts back), which puts the timing line on the Diamantidou radial. It was produced by searching the frozen street graph for closed, legal-direction loops through that radial (smooth, few turns, roundabouts, 3.5-6 km) and choosing the best by eye against the OSM map; `route.mjs` verifies every edge against the snapshot (adjacency, public access, paved surface). `raw/route.json` is its deterministic result: junction corners are filleted (10 m radius, bounded by the street so the line stays within about 4 m of the OSM centreline), then lightly smoothed and resampled at about 2 m.
- `raw/dem.json`: 37x39 terrain grid at 100 m spacing from [EU-DEM v1.1, 25 m source resolution](https://www.opentopodata.org/datasets/eudem/), via [OpenTopoData](https://api.opentopodata.org/v1/eudem25m). `raw/route-dem.json`: about 160 direct DEM samples at ~24 m road stations along the lap (`fetch_dem.py --route-only`, 2026-10-18). Road elevation is those samples interpolated and smoothed (periodic Gaussian, sigma about 24 m); the 10 m terrain grid is interpolated carving geometry, not 10 m source accuracy.
- `raw/garden-route.json`, `raw/garden-route-dem.json`: the first-version loop, kept so its streets stay in the drivable network.

The shared at-grade renderer omits the selected Kifisias tunnel ways (`25117418`, `113339568`, `113339581`) outside the lap. These underpasses are not reconstructed.

## Street appearance

The first-version street references were personally inspected before modelling, with attribution retained in ignored `.scratch/psychiko/` PNGs:

- [Diamantidou 42, south-facing](https://www.google.com/maps/@?api=1&map_action=pano&pano=9Q4JR2V_ywleu6_RNyrl8Q&heading=180&pitch=0&fov=90), September 2024, 38.0126551 / 23.7723670: pine/broadleaf canopy, stone/plaster walls, metal fencing, villa setbacks, tiled footways and double centre lines.
- [Agiou Dimitriou 50 / Kallari](https://www.google.com/maps/@?api=1&map_action=pano&pano=OM1Pkpuc2Z4EJ7VKZpgIow&heading=210&pitch=0&fov=90), April 2026, 38.0118376 / 23.7787348: broad junction, mature pines, garden hedges, narrow footways and street signs.
- Context: [Czech Embassy directions](https://mzv.gov.cz/athens/en/kontakty.html), [BLP Diamantidou villa](https://blp.gr/projects/psychico-house-diamantidou-street/).

This implementation reuses the shared Greek street, traffic, people, nature and drivable-network systems. No source imagery is shipped as textures. Building footprints are OSM-derived; missing levels, road widths, facades, planting, walls and garden boundaries are estimates. A separate Street View research pass in `.scratch/psychiko-streetview/` is intentionally untouched and has not yet been applied to this revision's scenery.

## Rebuild offline

```sh
node tools/maps/psychiko/route.mjs          # raw/drawn-course.json -> raw/route.json (+ raw/route-points.json)
python3 tools/maps/psychiko/fetch_dem.py --route-only   # only when the route changed (needs network)
node tools/maps/psychiko/build.mjs          # data/maps/psychiko/{map.json,terrain.bin}, incl. shared speed signs
node tools/build-detail-records.mjs         # adds the OSM vegetation / facade records to every map bundle
node tools/maps/psychiko/validate.mjs
node tools/maps/psychiko/preview.mjs        # assets/maps/psychiko.svg
node --test tools/psychiko-world.test.mjs
ATTICA_PYTHON=<venv with numpy pillow shapely scipy> node tools/build-attica-map.mjs   # selector route, pin and detail art
```

No live fetch is needed except for refreshing sources deliberately: `python3 tools/maps/psychiko/fetch_osm.py`, then review source adjacency and access changes before rebuilding.

## Verification evidence

`tools/psychiko-world.test.mjs` covers: route/selector/server consistency; both events tracking the whole route; continuous terrain/contact and the carved street bed; all public municipal roads selected; every closure (one per outgoing public junction half-edge, none on the raced edges, solid at 90 km/h in races, absent in free roam); the Garden Circuit following public OSM streets only (within 4.5 m of a street centreline everywhere), driving every street in its legal one-way direction, starting on the Diamantidou radial south of the roundabout, smooth corners, and being a new leaderboard/personal-best board. `VERIFICATION.md` records the 2026-10-18 end-to-end drive and screenshots.

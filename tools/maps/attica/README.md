# Greater Athens selector map

Runtime files: `assets/maps/attica.svg` and `src/attica-map-data.js`, **209,327 bytes combined**. Entirely offline: no tile service, API key, GIS dependency or geographic network request in the game. The SVG combines a softened DEM/urban WebP background with the vector coastline and only the motorway (A1, A6, A62, A64, A65, A8) and EO trunk network; no secondary or local streets. Place and summit names are not baked into the SVG: `MAP_LABELS` lists 16 ranked OSM places/summits (real coordinates), and the selector draws them at constant screen size, dropping or moving any label that would collide with a pin, a route, the map chrome or a higher-ranked label. Interactive route paths are separate SVG overlays.

Coverage: **23.00–24.50 E, 37.70–38.24 N**, Expanded source extent surrounding Riviera/Varkiza/Lomvarda through Penteli/Dionysos; the default viewport fits all three route bounds with 8% padding. Web Mercator, aspect preserved in all layouts. Megara Circuit is included in West Attica. The 5 km scale updates during camera easing and manual zoom (scale at the crop's central latitude; Mercator scale variation across the displayed Athens region is under 0.5%).

## Sources and licences

- **OpenStreetMap contributors**, ODbL 1.0: https://www.openstreetmap.org/copyright . Coastlines, primary/secondary/tertiary roads and motorways, residential/commercial/industrial/retail landuse, places and peaks. Downloaded 2026-10-14 via `https://maps.mail.ru/osm/tools/overpass/api/interpreter` after the other mirrors timed out. Query region 37.74,23.47,38.23,24.10, clipped to the displayed extent. `source.json.gz` is the compact derived source snapshot, distributed under ODbL; projected coordinates in SVG units, rounded to 0.01 units, with 0.6-unit geometry simplification. No invented coastlines or terrain rings. The SVG is an OSM Produced Work with visible linked attribution in the screen.
- Vector extension and land polygons: **OpenStreetMap / Protomaps**, ODbL; bounded HTTP Range requests to `https://build.protomaps.com/20261013.pmtiles`, 50 z11 tiles, retaining the original Athens roads/urban/places extract in the centre. Protomaps earth polygons at this zoom come from OSMCoastline: https://docs.protomaps.com/basemaps/layers . No new runtime service dependency.
- Local race geometry: `data/map.json`, `data/maps/megara/map.json`, `data/maps/penteli/map.json`, OSM-derived WGS84 route positions. Routes simplify by 0.35 SVG units (approximately 22 m); both endpoints are retained.
- Local elevation: `data/terrain.bin`, `data/maps/megara/terrain.bin` and `data/maps/penteli/terrain.bin`, EU-DEM v1.1 via OpenTopoData, sampled wherever they cover the overview. These grids also contain the game's road grading.
- Regional elevation: **Copernicus EU-DEM**, via Mapzen/AWS Terrain Tiles `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/11/{x}/{y}.png`. Tiles used: x1154–1163, y788–791. AWS response metadata identifies `eudem/eudem_dem_5deg_n35e020.tif`. Produced using Copernicus data and information funded by the European Union — EU-DEM layers. EU-DEM's full, open and free access permits reproduction/adaptation with attribution: https://github.com/tilezen/joerd/blob/master/docs/attribution.md . The snapshot contains the sampled approximately 230 m elevation grid, not the upstream full-resolution tiles. Hillshade uses NW light and elevation tint, compressed toward neutral (60%) so relief reads without competing with routes; no synthetic contours.

## Rebuild

Use a Python virtual environment with `numpy`, `Pillow`, `shapely` (used for polygon clipping and simplification):

```sh
python3 -m venv .scratch/attica-map/venv
.scratch/attica-map/venv/bin/pip install numpy pillow shapely
ATTICA_PYTHON=.scratch/attica-map/venv/bin/python node tools/build-attica-map.mjs
```

Default rebuild uses the committed source snapshot plus shipped route/terrain data, without fetching. Add `--fetch` to refresh the OSM surround and regional DEM at build time; the fetch step additionally needs `pmtiles` and `mapbox-vector-tile` (`pip install pmtiles mapbox-vector-tile`). Raw requests/terrain tiles cache only under `.scratch/attica-map/`. The generator checks the size budget and verifies Athens lies on land and a Saronic Gulf control point lies at sea before writing the final asset.

The route controls use the existing named input actions: left/right and shiftDown/shiftUp (default gamepad LB/RB). Touch swipes operate on the selected-track panel; dragging/pinching the map remains map navigation. Reduced motion disables tracing/pulsing and makes camera changes immediate. All listeners and animation frames are released on screen disposal.

The camera uses one isotropic projection for the base map, routes and pins. It covers the viewport at minimum zoom and clamps panning to the actual asset bounds at every zoom. Default/reset framing fits all full routes with 8% padding; browsing a track eases gently while retaining at least 6% padding. All camera moves (browse, RESET, wheel/pinch zoom about the pointer, layout changes) run through one frame loop: flights interpolate the view centre and log-scale with an ease-in-out, wheel zoom glides toward its target and stays anchored under the pointer, and a resize keeps the area in view instead of snapping. Pins and labels sit in a screen-space overlay positioned from the same camera, so they keep their UI size without per-frame layout reads. Controls and attribution occupy a separate footer outside the clipped geographic viewport, so they cannot cover a route pin. Camera coverage/margin tests: `node --test tools/map-select-camera.test.mjs`.

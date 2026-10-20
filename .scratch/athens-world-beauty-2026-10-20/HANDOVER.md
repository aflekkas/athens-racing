# Handover to the bake agent: Athens beauty pass

Updated per step. Nothing here is baked or published by the beauty agent.

## Step 1 (landmarks, mountain ring): no rebake needed
Runtime only, plus a static `assets/athens/horizon.bin` that ships with the app. The hidden boxes of replaced landmarks use building ids already in the cells. `tools/world-gen/landmarks.py` and `horizon.py` are stand-alone generators (landmarks.py needs the cache's `attica.osm.pbf` and `clean.sqlite`; horizon.py the DEM tiles) and are not part of a bake.

## Step 2 (facades, roofs, rooftop kit, paved squares): no rebake needed
Everything is derived at run time from the cells already published; a cell baked before this still shows it. The only new static files are `assets/athens/plazas.json` (54 KB) and the earlier `horizon.bin`, both shipped with the app. A later bake could make this cheaper (store `roofShape` and a facade style per building: `worldDetail.buildings.roofShape` / `facadeStyle` are already read when present) but nothing requires it.

## Step 3 (trees, denser rooftop kit, all of Syntagma paved): no rebake needed
Street trees and the rooftop kit are derived from each cell's road graph and buildings when the cell is read, so published cells need nothing. `assets/athens/plazas.json` was extracted again (569 outlines); it ships with the app. If a bake ever stored per-cell tree rows, `worldDetail.vegetation` (positionHeight, kind, seed) is already drawn with the new species models. Note for later: with World detail Off the old box trees are gone for good (they never drew in Off anyway).

## Step 4 (contact shadows under props, aerial perspective): no rebake needed
Run-time only; nothing in the cells is read or written.

## Step 5 (parked cars and scooters): no rebake needed
Derived from each cell's road graph when the cell is read. The only thing a later bake could do better is to store a per-edge parking rule (OSM `parking:lane:*`, `parking:condition:*`) so that no-parking stretches and bays follow the map; the runtime currently parks on every quiet street except near junctions.

## Summary for the bake agent, steps 1 to 5
Nothing in the published cells has to change for any of the five steps. Static files that ship with the app: `assets/athens/horizon.bin` (78 KB), `assets/athens/plazas.json` (64 KB). If you rebake anyway, `worldDetail.buildings.roofShape` and `facadeStyle`, and `worldDetail.vegetation`, are read when present.

## Step 5b (Syntagma strip, lawns): no rebake needed, one thing for a later bake
`assets/athens/plazas.json` and the new `assets/athens/lawns.json` ship with the app. For a later bake: leisure=garden, flower beds and landscape=lawn are not read as grass by the ground class, and the edge of a park blends over large ground triangles; classing them in `tools/world-gen/appearance.py` (and passing the polygons through ingest) would make the lawn layer unnecessary.

## Step 6 (signs, road marks, murals): no rebake needed; two optional data improvements
Everything is derived in the tile worker from the cells already published (road graph, buildings, drivable asphalt) and drawn at run time; the only app files are `assets/athens/pois.json` (named shops and amenities, 29 KB) plus the earlier `plazas.json`, `lawns.json` and `horizon.bin`. Text is baked into canvas atlases in the browser (11 MB + 5.6 MB of GPU memory, none shipped).
- **Shop names:** the OSM extract in the cache is filtered (24 shop nodes in the whole of Attica, 951 named shops and amenities with the building areas), so nearly every shop sign is a generic Greek one. Run `tools/world-gen/pois.py` against a fuller Attica extract (Geofabrik's Greece file, or an Overpass query for `shop`, `amenity` and `name` in the region) and replace `assets/athens/pois.json`; nothing else changes. The same extract would give `emergency=fire_hydrant` nodes (none today), which could feed the red and white kerb paint in `src/world-tile-street-art.js`.
- **Street names:** the edges' `name` strings are already in the cells (Greek); nothing to do. A later bake could store the OSM `name:en` too if the owner wants bilingual plates.
- A later bake that stores a per-edge parking rule or kerb colour (`parking:lane:*`, `parking:condition:*`) would let the yellow runs follow the map instead of the junction-and-window rule.

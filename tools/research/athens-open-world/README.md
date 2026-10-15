# Athens open-world research evidence

Research only, based on prod `b7bd65445931c58a9eea5131704fd9b584a776fa`.
No game/runtime/build/deploy configuration changed. No new imagery or model assets.

- `osm-census.json`: measured OSM way kilometres, building entities, geometry-extract bytes/hashes, exact A/B polygons and C boundary relation, PBF hash and replication timestamp. Download: Geofabrik Greece 2026-10-14 snapshot (retrieved 2026-10-15). Original country download MD5 `537fc863d2eb7413b16261c4c0a82c78`, matched the dated Geofabrik checksum.
- `tile-spike.json`: surrounding-road-only triangle partition at 512 m for the three existing maps, with exact per-cell raw/gzip bytes. Uses source terrain; not a full conformed terrain bake. Whole primary race route/custom geometry, terrain, scenery, textures and actual streaming are excluded.
- `deploy-inventory.json`: asset count/bytes from the clean baseline staging dry run, including content-addressed copies. It is not a proposed tile deployment.
- `validation.json`: gate results and consistency checks. Full gate outputs are retained in `validation.log` with command/exit and the end of each log; complete noisy simulation output is intentionally omitted.

Tools: [measure-athens-osm.py](../../measure-athens-osm.py) and [athens-tile-spike.mjs](../../athens-tile-spike.mjs). See `docs/athens-open-world-plan.md` for reproduction and data definitions. Python 3.12, pyosmium 4.3.1, Shapely 2.2.0; Node 22.23.3 and three.js 0.170.0. The full census took 1,186.4 seconds on the shared VPS; the cheap road spike took about 75 seconds. The census excludes 13 unassembled building relations across the country; regional assignment is unknown. The geometry extract is OSM-derived and subject to ODbL; attributes, projection, counts and hashes preserve provenance. The derived footprint/road databases were measured offline and are reproducible but are not shipped as playable assets here.

No before/after performance or visual improvement is claimed. Proposed timing, residency, density, effort and optimized-compression values in the plan are design targets/estimates. The only tile spike measurements are offline triangle/byte counts and shared-VPS generation/compression elapsed times.

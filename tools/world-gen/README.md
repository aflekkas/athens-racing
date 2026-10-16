# Offline Athens world generator

Current milestone: **streamed source extraction, graph normalization, measured
building blocks**. This directory does not activate Athens free roam. It does
not yet emit playable AWT tiles. Do not deploy the intermediate SQLite/NDJSON
files or treat their byte counts as hosting estimates.

Runtime interchange is [AWT/1](../../docs/world-tiles-format.md), validated by
`src/world-tile-format.js` and `tools/validate-world-tiles.mjs`. The projection
here matches AWT/1: latitude 37.98, longitude 23.73, mlat=111320 and
mlon=111320*cos(37.98 degrees). The earlier census projection was slightly
different; do not concatenate its projected geometry with this output.

## Reproduce the current milestone

Use Python 3.12 and one cache directory outside the repository. All tools are
offline except `fetch.py`. No generation runs in a browser or Worker. Example:

```sh
CACHE=/tmp/athens-world-cache
python3 -m venv "$CACHE/venv"
"$CACHE/venv/bin/pip" install -r tools/world-gen/requirements.txt
"$CACHE/venv/bin/python" tools/world-gen/fetch.py "$CACHE" --osm
"$CACHE/venv/bin/python" tools/world-gen/clip.py \
  "$CACHE/greece-261014.osm.pbf" "$CACHE/attica.osm.pbf" --drop-incomplete
# After checking attica.osm.source.json and successful completion, delete only
# the full Greece PBF. Keep its tiny source/hash record.
"$CACHE/venv/bin/python" tools/world-gen/ingest.py \
  "$CACHE/attica.osm.pbf" "$CACHE/source.sqlite"
"$CACHE/venv/bin/python" tools/world-gen/clean.py \
  "$CACHE/source.sqlite" "$CACHE/clean.sqlite"
"$CACHE/venv/bin/python" tools/world-gen/report.py \
  "$CACHE/clean.sqlite" "$CACHE/intermediate"
"$CACHE/venv/bin/python" tools/world-gen/test.py
```

Pinned source:
`https://download.geofabrik.de/europe/greece-261014.osm.pbf`, 341,944,784 bytes,
SHA-256 `7087cf00b0e47833c40837b9ee7cc5c3020420decc3980406d3b8f0b5d62a6f3`.
Measured reduced extract: **62,333,978 bytes**, SHA-256
`db17fa15807d29f115bd160937e34194255e8b6e61148ccb90dc19a0ef25dc15`.
The raw cache contains this PBF plus two cropped TIFFs (8,591,272 and 17,292,644
bytes), **88,217,894 bytes total**. The full Greece PBF and uncropped TIFFs were
deleted after verification. The extract records one missing node reference,
3,638 unavailable relation-member ways, and 12 excluded incomplete relations;
no present selected way was discarded. Do not mistake these country-extract
reference gaps for proven deletion of real-world features. Full provenance and
exclusion IDs are in `.scratch/athens-world/`. No raw OSM or DEM is committed.

`clip.py` uses the bbox `[22.8,37.4,24.7,38.6]` and a three-pass SQLite selection
index. Selection is **node-in-bbox**, as in standard complete-way extracts;
ways crossing the bbox with every node outside are not selected. This wide bbox
has a substantial halo around stages A/B and mainland Attica. Strict mode requires all references of selected ways and supported relations.
The pinned source contains broken references: `--drop-incomplete` excludes
affected ways/relations and records every missing/omitted ID in the source
manifest, leaving the reduced PBF reference-complete. It never fabricates node
coordinates. Retained coverage must be reported alongside these exclusions.
The Attica administrative boundary keeps its outer/inner members; subarea
relations are deliberately omitted. Selected nested multipolygons fail with an
explicit error rather than becoming incomplete buildings. SQLite contains only
selected IDs, not all country node coordinates. There is no country-sized
Python dictionary or dense highest-OSM-ID-sized bitset. The final writer
merge-scans sorted selected IDs instead of querying SQLite for every country
node. Geofabrik entities must remain ID-sorted; unsorted input fails. If a write
is interrupted after the `references` phase, rerun `clip.py` with
`--resume-write`; provenance is checked before replacing its partial output.
On a resumed run, elapsed time includes the interruption and RSS describes the
resumed invocation. Do not use this flag on an incomplete selection phase.

`ingest.py` uses pyosmium's sparse disk location index on the **reduced** PBF.
The index is removed on completion. SQLite caches are 32 MiB; source features
and spatial searches stay disk-backed. Multipolygon member ways are suppressed
so a relation is not counted as both a building and its member outlines. Missing
or outside building relations and malformed geometries are counted, never
claimed as complete coverage.

## Elevation cache

Only download degree tiles that overlap the stage being built. A/B use N37 E023
and N38 E023. Mainland C additionally needs its western/eastern degree columns;
coverage must be checked before generation. These examples crop immediately:

```sh
"$CACHE/venv/bin/python" tools/world-gen/fetch.py "$CACHE" --dem 37 23 --dem 38 23
"$CACHE/venv/bin/python" tools/world-gen/crop-dem.py \
  "$CACHE/Copernicus_DSM_COG_10_N37_00_E023_00_DEM.tif" "$CACHE/attica-n37-e023.tif"
"$CACHE/venv/bin/python" tools/world-gen/crop-dem.py \
  "$CACHE/Copernicus_DSM_COG_10_N38_00_E023_00_DEM.tif" "$CACHE/attica-n38-e023.tif"
# After successful hash/manifest recording, delete the two uncropped TIFFs.
```

Copernicus GLO-30 is a **digital surface model**, not surveyed road elevations.
Its source datum is EGM2008. A denser mesh does not improve source survey
accuracy. EU-DEM GeoTIFFs are also readable by `elevation.Elevation`; retain
their own datum and licence rather than labelling them Copernicus GLO-30.
Sampling reads cached 128×128 windows (maximum 256), not whole mosaics. Missing
coverage and nodata raise errors. Crops retain a one-pixel interpolation halo.
Every download/crop has a source/hash lock; hash mismatches fail closed.

## Intermediate format and cleaning

`source.sqlite` stores original tags, full 64-bit OSM identifiers, projected WKB
geometry, node references, relation turn restrictions, barriers/access on nodes,
landuse, water and coastline. `clean.sqlite` stores normalized `objects` with a
spatial R-tree, explicit rejected IDs/reasons and a provenance manifest.
Coast/water/landuse/landcover IDs include their role: one OSM way can be both
coastline and landuse without losing either feature.

Roads include only drivable highway classes; footways, tracks, construction,
ferries and raceways are excluded. Width uses a valid width tag, otherwise lanes
×3.2 m, otherwise a documented class default in `model.py`. Feet and mph convert
to SI. Access follows motorcar → motor_vehicle → vehicle → access precedence.
Reverse one-way, roundabout and motorway direction rules are retained. Unknown
and conditional direction/access, and node gates, fail closed for public
spawn/routing candidates. Restricted roads remain in source geometry.

Roads split at shared **OSM node IDs**, not geometric crossings. Bridge/tunnel
layers survive ingestion. Separate carriageways remain separate directed
surfaces with a common ref/name group; proximity alone never merges them or
creates a junction. The same `nodeRefs` support later global profile solving.
Turn restrictions, including via-way/conditional forms, are preserved verbatim;
**the runtime must evaluate them before routing is enabled**. No bridge deck or
tunnel bore height is invented from a layer number.

Buildings use actual footprints. AWT/1 permits concave 4–14-corner
outlines; simplification permits at most 15% symmetric area change.
Triangular outlines gain a collinear midpoint to satisfy the four-corner table
minimum without changing their area. Simple courtyards are cut into a few
outline parts without filling the hole. Invalid outlines and shapes that cannot
meet the total budget are rejected and counted explicitly, not silently
replaced with unrelated bounding boxes. Multipolygon/courtyard parts share one
≤40-triangle entity budget.
Intermediate meshes have walls and a flat roof, no floor/props/textures. The
AWT wall/roof renderer uses 3n−2 triangles (40 for 14 corners), without a floor.
Height uses OSM `height`, then `building:levels` ×3.2 m, then per-landuse defaults.
Colour is a stable SHA-derived index in the six-colour white/light-plaster, grey
and muted Greek-accent palette in `appearance.py`, distinct from ground tones.
White/plaster and greys receive 85% of deterministic palette slots; the three
muted accent colours receive 5% each.
Ground colours use slope, height, coast distance and retained OSM landuse/natural
areas: dry earth, rock, scrub tones, sand and urban ground. Continuous world-space
colour variation avoids tile seams; scrub/forest tags add no vegetation props. Base Y is zero in
the intermediate mesh and must be placed by the global terrain/profile solve.

Reports measure each stage independently: A south suburbs; B union A plus the
basin planning envelope; C mainland Attica, derived from the closed coastline
polygon containing Athens intersected with relation 957716. Missing coastline
closure blocks C. Islands are not joined by invented roads. Gzip output is
stable (zero timestamp, no embedded filename); generation timings live outside
the deterministic databases. Road lengths are clipped great-circle way km,
not lane km. `occupiedSourceCells` excludes terrain-only cells and is **not**
a playable tile count.

## Profile and surface foundations

`profiles.py` seeds shared OSM-node road profiles from cropped DEM windows and
solves grade/centerline-crossing-clearance difference bounds with balanced
upper/lower envelopes. This avoids slow local relaxation along steep chains. It uses disk-backed
numeric solve vectors, preserves junction node identity and fails nonconverged
systems. OSM layer determines ordering only, never a height offset. This stage
still needs full deck/road-footprint clearance and Riviera joining validation;
its output is explicitly not release-ready.

Regenerate stage-A profiles from the completed clean cache:

```sh
"$CACHE/venv/bin/python" tools/world-gen/profiles.py \
  "$CACHE/clean.sqlite" "$CACHE/profiles-a.sqlite" --stage a_south \
  --dem "$CACHE/attica-n37-e023.tif" "$CACHE/attica-n38-e023.tif"
```

`surfaces.py` partitions each ground tile with constrained triangles: 4 m cells
near roads, 16 m elsewhere, 2 m canonical border subdivisions. It takes a global
height function; it cannot substitute independent tile-local terrain grading.
`SurfaceHeight` samples actual emitted triangles so paint can be placed above
the rendered plane rather than an independently sampled DEM.
Fixture tests check full area, upward winding, manifold edges and identical
neighbour borders. Real-world conformance tests remain required.

## Unlit road and building appearance

`styles.py` bakes orientation-based face colours into building vertices. Roofs
retain palette brightness; wall faces range from roughly 15–35% darker in display
space. Face vertices are split without adding triangles. The six white/plaster,
light grey and muted accent colours remain independent of the terrain palette.

`street_details.py` supplies dashed lane/centre paint, a contrasting pavement
band and a 10 cm raised kerb with a lighter top. Paint is clipped to roads and
tile bounds and omitted around junction interiors. These are rendering helpers;
the final generator must connect raised surfaces to contacts, ramps and shoulder
conformance before playable release. Source access and lane restrictions still
need the graph consumer. No extra street furniture is generated.

## AWT packing boundary

`node tools/world-gen/pack.mjs <tiles.ndjson> <output-dir>` streams one solved
geometry tile at a time through the shared codec. Each input line contains
`metadata`, all AWT `tables` as numeric arrays, and optional mesh `arrays` with
`{type,data}` descriptors. Mesh array indexes refer to those arrays; tables are
appended automatically. No alternative binary format is introduced. Identical table buffers share array
indexes, and the shared codec's lossless byte planes improve gzip compression.
Every decoded view gets its own backing allocation (including byte-wide views),
so a small retained view cannot keep the complete raw container alive.

The packer runs `validateWorldTile` before encoding and after decoding, rejects
integer/Float32 overflow and >25 MiB members, and verifies adjacent canonical edge
signatures from the shared validator. It publishes `entries.json` only after
all structural/seam checks pass. That file is **not a playable manifest**;
conformance, contacts, provenance, dependencies and spawn validation must still
be supplied by the geometry stage. `node --test tools/world-gen/pack.test.mjs`
checks deterministic encoding and rejection of cracked adjacent fixture tiles.
Those tiny fixtures are not evidence of real-world conformance.

## Remaining release gates

Global road profiles, junction surfaces, bridges/tunnels and Riviera contact
joining must be solved before tile clipping. Emit AWT through the shared
`encodeGeometryPack`, never a second codec. Validate every tile structurally,
then rendered/contact equivalence, road intrusion ≤5 mm, shoulders ≤15 cm step
and ≤30° slope across six metres, exact adjacent seams, triangle budgets and
contact coverage. All staging metrics currently mark these as not run.

No menu, traffic, GPS or auto-tow integration is enabled by this milestone.
Once a stage-A manifest passes, hand its path and spawn anchor to the streaming
agent. Keep the feature opt-in until stage A plays well, then capture and inspect
all required overview/street views and add the changelog WebP. A source census
or building-budget pass cannot substitute for those acceptance checks.

Attribution is in [CREDITS.md](CREDITS.md), automatically discovered by the game's
Credits builder. Retain source manifests and ODbL notices with derived data.

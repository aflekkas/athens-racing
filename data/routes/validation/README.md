# Compiled route validation inputs

`syntagma-pilot.inputs.json` is a reduced emitted graph and contact-proof shard,
not a world tile or a render mesh. It records source tile hashes at world revision
`2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39`.
The source is the existing staging AWT manifest
`6d57b168364cd168f8beb419f864edff1a8d94729e4119745a84597c4ce3ab4a`.
World cells remain exclusively in `athens-racing-world-staging`.

`athens.inputs.json` extends this proof to all three enabled compiled routes. It was
captured against the basin plus disconnected Penteli world set revision
`dd98d7bac13833eca19e0f583d6da49cd332df8cd6de3b84a1c72df4aaa8961d`
at manifest `7de3a7d423f14780d906fa9af913325a8a0f0bf39bfbdc303ed349c2ea7d80d3`.
This scenery pass preserves the existing validated corridor subset and race hashes.
A fresh capture across 123 verified basin halo cells confirms all 6,400 contact
queries are identical and every preserved width remains within the fresh proof.
The Riviera road-width logic would otherwise widen 250 old queries. All 43
referenced cell hashes remain identical, so the existing proof is rebound to the
new world-set revision; no records or route geometry change. Penteli contributes
no race definition.

Psychiko overrides in `tools/world-gen/overrides/psychiko.json` rebuild the
Faros route cells and their seam halo; unchanged cells retain their immutable
coast source and all replacement cells carry a distinct source revision. The
shard contains only exact emitted directed edges and bounded contact queries,
never a duplicate physics surface. Re-capture it if either source manifest
changes.

Road names and directed geometry derive from OpenStreetMap contributors,
[ODbL 1.0](https://www.openstreetmap.org/copyright), through the existing Athens
generator. Elevation and contact provenance are the immutable cell metadata;
see `tools/world-gen/README.md` and the game's credits. No photographs or tiles
from a map service are included.

Reproduce with a bounded local set of the publisher's immutable `.bin.gz` cells:

```sh
node tools/capture-route-inputs.mjs --world /path/world-set.json \
  --cells /path/hash-named-cells --routes data/routes \
  --out /task-temp/route-inputs.json
node tools/validate-routes.mjs --world /path/world-set.json \
  --graph /task-temp/route-inputs.json --routes data/routes \
  --report /task-temp/routes.json
```

The capture verifies compressed SHA-256, revision, cell identity and the AWT
structure; it checks physical contacts, asymmetric cross-sections, full grid and
run-out footprints, building/parked-object clearance and safety rails. Broad
junction corridors use a contact-proven subset bounded at 32 m per side.
Physical contact labels can change across overlapping junction fans; route
occurrences retain those changes, while graph legality stays directed.

The validator also accepts a SQLite emitted index with one bounded row in
`route_validation_shards(json TEXT)`. A raw pre-exclusion OSM graph is rejected.
Deployment replays these exact compiler queries and checks every referenced
source hash. A changed route or world needs a fresh capture; missing proof does
not trigger a road snap or a fallback bake.

`athens.inputs.json` also contains the independent Riviera coast proof at the
same active staging revision: 126 directed edges, including the forward
Loumbarda bore (`w25371523`, layer −1). The 10,337.229709 m route uses 24 cells
including its contact envelope. Existing pilot and Faros geometry/route hashes
are unchanged. Riviera's capture reads at most 128 immutable source cells (the
coast and immediate halo need 74); only emitted graph records and exact bounded
queries enter this file. It contains no render meshes, cell bodies or secrets.
See `docs/reports/riviera-route.md` and the Phase 3 feed for the full equivalence,
physical safety, drive and resource evidence. New physical carriageways are a
separate competitive edition from the old `4718fbec` Riviera reference.

Phase 4a adds `penteli.inputs.json`, a bounded sibling shard for the independently
flagged `penteli-hill` and `penteli-descent` destinations. The root binds the
union of source hashes and cells; each file remains below 8 MiB. The reader
merges at most three sibling shards, rejects changed queries/edges, and still
checks every cell hash against the active world set. No render/contact triangle
arrays are committed. Both 265-edge sequences use the source timing endpoints
292 and 10,188, transformed to Athens coordinates, and compile to 9,920.159 m.
The downhill uses legal reverse directed edges as a separate forward runtime.

Reproduce offline with `node tools/author-penteli-routes.mjs WORLD CELLS OUT`.
The cell directory contains only hash-verified emitted cells from staging; it is
temporary and must not enter Git. `captureRouteInputs({keys})` accepts the
bounded explicit envelope for imported edges whose IDs do not encode a cell.
The decoder binds the older Penteli graph's generic bridge surface only after
checking each segment midpoint against its authenticated OSM bridge structure,
layer-1 asphalt surface and matching height. It never relaxes approach/stacked
road connection rules. Future imports must refresh their own source lock and
rebake; this is a reader compatibility fix for existing immutable packets.

`kifissia.inputs.json` is the third and final allowed sibling. It proves the
Kifissia/Kefalari two-lap circuit against seven unchanged north-basin cells,
2,031,067 compressed bytes. The file is about 1.02 MB, with no render/contact
triangle arrays. The root binds its source hashes and metadata so existing
readers authenticate all three sibling shards against one world revision.
The unchanged three-sibling and 8 MiB per-file bounds are tested explicitly,
including rejection of a fourth sibling. See `tools/maps/kifissia/SOURCES.md`
for exact source hashes, street decisions and inspected Street View references.

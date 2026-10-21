# Compiled route validation inputs

`syntagma-pilot.inputs.json` is a reduced emitted graph and contact-proof shard,
not a world tile or a render mesh. It records source tile hashes at world revision
`23d19ec1592a6a337d9289d4f82161751875348be049a56e5042e87138416ca6`.
The source is the existing staging AWT manifest
`fc9995d6150f1b98ec4732353ef2a0b4b11d864677c73130d27407aad3dab46b`.
World cells remain exclusively in `athens-racing-world-staging`.

`athens.inputs.json` extends this proof to both enabled compiled routes. It was
captured against the composed coast and Psychiko world set revision
`48d988201269f02eaf0ebe4d5e57a0adb6786c78a64a83e6d985317fdcb4db76`
at manifest `b2fe46c80f36d9dd6d0c2f3dfd5462e6ebf6c5418da99a772bf15ec9076ce3b0`.
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

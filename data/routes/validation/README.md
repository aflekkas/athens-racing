# Compiled route validation inputs

`syntagma-pilot.inputs.json` is a reduced emitted graph and contact-proof shard,
not a world tile or a render mesh. It records source tile hashes at world revision
`2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39`.
The source is the existing staging AWT manifest
`6d57b168364cd168f8beb419f864edff1a8d94729e4119745a84597c4ce3ab4a`.
World cells remain exclusively in `athens-racing-world-staging`.

`athens.inputs.json` extends this proof to both enabled compiled routes. It was
captured against the composed coast and Psychiko world set revision
`4241d71bb4d87f995cde84bbf5af3d3c11d014f5ca5e4a2055c65c42f437827e`
at manifest `377cd6c880ae85661c44dbec6f974a5f406c41d7e39299aed3c501f6a0d935f3`.
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

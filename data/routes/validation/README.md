# Compiled route validation inputs

`syntagma-pilot.inputs.json` is a reduced emitted graph and contact-proof shard,
not a world tile or a render mesh. It records source tile hashes at world revision
`2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39`.
The source is the existing staging AWT manifest
`6d57b168364cd168f8beb419f864edff1a8d94729e4119745a84597c4ce3ab4a`.
World cells remain exclusively in `athens-racing-world-staging`.

`athens.inputs.json` extends this proof to all three enabled compiled routes. It was
captured against the basin plus disconnected Penteli world set revision
`4e4c4622b97d2bea7056ad1d52bf48afb942db8e6b29bc124ebade7619b7b726`
at manifest `803754cf8aa7c04ceb9161d29061436292f6fe3f42fe13bf0d468de5f7e2d6a2`.
The pilot and Faros capture replays against 53 hash-verified basin halo cells.
Their geometry hashes are unchanged; Penteli contributes no race definition.
The separately captured Riviera queries are merged by exact edge/query identity;
all 43 referenced cell hashes match the composed release. Basin packet identities
remain intact.

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

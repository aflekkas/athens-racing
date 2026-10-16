# Offline Athens generator handoff — wrap-up, 2026-10-16

Scope is frozen by the lead. Do not activate Athens for players from these
fixtures. No coast, structures, signs or full-stage generation was started for
this wrap-up. The offline foundation landed as
`bb2333e16bae99d2d3fe69fdd18faeada4f0682a`; the follow-up is the commit containing
this note. Both leave the runtime/menu flag unchanged and inactive.

## Durable artifacts and current integration paths

These tiny development artifacts are committed under `.scratch`, which the
release asset allowlist excludes. They survive deletion of every `/tmp` copy.
All manifests are `developmentOnly:true`, `releaseReady:false`.

- `.scratch/athens-world/development-world/glyfada/manifest.json`: cells [4,25]
  and [5,25], revision
  `9fb9370614c7b2b2ded2685274406cfb1d090aa1c656bc02e7d3ec3da6ac44d3`.
  2,736,034 compressed bytes, 114,729 rendered triangles, 310 directed graph
  edges, 172 nodes, seven turn prohibitions, 237 generated-contact anchors.
  Spawn Laodikis: world `[2324.1220092773438,16.31201934814453,13057.307189941406]`,
  yaw `2.9831650257110596`; anchor
  `anchor:tow:osm:way:24826358:0-0:f:4:25`.
- `.scratch/athens-world/development-world/riviera/manifest.json`: cell [8,36],
  613,495 compressed bytes, 24,921 rendered triangles, 112 graph fragments,
  43 generated anchors. Spawn on Poseidonos:
  `anchor:tow:osm:way:459160388:0-0:f:8:36`; local
  `[466.9681091308594,5.699690818786621,231.2852783203125]`,
  world `[4562.968109130859,5.699690818786621,18663.285278320312]`,
  yaw `-2.94152569770813`.
- Sol currently integrates
  `/tmp/athens-world-cache/athens-development-oriented/manifest.json`.
  Preserve that directory while Sol uses it. The older
  `/tmp/athens-world-cache/athens-development/manifest.json` has incorrect
  signs for backward-referenced ribbon laterals; do not resume traffic from it.
  The committed Glyfada artifact is the corrected version.

These are **separate finite fixtures**, not a connected Riviera–Glyfada world.
Outside-owner buildings are omitted explicitly at their finite boundaries.
`development-fixture-validation.json` records shared AWT structural validation.
`contact-pair-validation.json` proves exact canonical tops/seams and 2,765 graph
samples with no missing contacts (max height error 0.0019 mm). Forty-three
boundary samples require neighbouring cells, which are absent from this fixture.
Structural validation and matching contacts are NOT physical conformance.

## Known physical blocker — fix before driving acceptance

`surface-slope-audit.json` found 203 Glyfada asphalt triangles above 30 degrees,
covering 8.72 m² of 33,676 m² asphalt. Nearest/containing-road height selection
introduces discontinuities when adjacent profiles switch. Sol was told not to
use this fixture as driving acceptance. The experimental continuous blend in
`continuous-field-draft.py` was preserved but its run was stopped at wrap-up;
it is **not validated, not used by the committed fixtures, and not the emitter**.

1. Replace discontinuous road selection in `tools/world-gen/tiles.py::Field`
   with a deterministic continuous global influence field, or solve the entire
   constrained road/shoulder surface before clipping. Preserve shared border
   values, layers, profile grades and the actual generated spawn height.
2. Add regression cases at overlapping road boundaries and nearest-road ties.
   Rebuild Glyfada [4,25]/[5,25] and Riviera [8,36]. Run the slope audit and a
   six-metre shoulder sweep (<=15 cm step, <=30 degrees), including junctions.
   Do not hide steep triangles by weakening acceptance thresholds.
3. Re-run exact render/fine/contact equivalence, graph asphalt coverage,
   half-open portal identity, every neighbour seam, full-body anchors and
   building clearance. The sampler and validator scripts are in this directory.
4. Hand a new immutable revision to Sol; retain the old artifact until released.
   Verify actual menu/flag activation, GPS/minimap, auto-tow and cheap traffic
   together only after physical checks pass. Do not reuse legacy Riviera Y.
5. Only after renewed owner/lead scope approval, implement coastline/sea,
   layered bridge decks/rails and tunnel boxes/portals, maxspeed signs and
   junction tables. Then emit full A, validate every tile and the Riviera
   connection, and measure full staging/hosting totals. B and C follow later.
   The basin census currently uses A union the basin planning envelope, not an
   exact ring-road polygon; resolve that region distinction before claiming B.
6. Optional details: Sol's contract landed in `c5765b8`. Use canonical
   `detailSeed`, facadeStyle 0–7 and the worldDetail vegetation arrays. Reject
   conflicting roofPropSeed aliases; do not emit that alias on the wire.
   Vegetation candidates require deduplication and road/building exclusion.
   Gardens/forests remain unextracted. Realism owns rendering and its toggle.

## Reproduction commands

From a clean archive of the follow-up commit, with node_modules symlinked to
this repo. Cache locations are explicit; no additional repo copies are needed.

```sh
export CACHE=/tmp/athens-world-cache
"$CACHE/venv/bin/python" tools/world-gen/test.py
node --test tools/world-gen/pack.test.mjs
node tools/validate-world-tiles.mjs .scratch/athens-world/development-world/glyfada/manifest.json
node tools/validate-world-tiles.mjs .scratch/athens-world/development-world/riviera/manifest.json
set -o pipefail
"$CACHE/venv/bin/python" tools/world-gen/tiles.py \
  --profiles "$CACHE/profiles-a.sqlite" --source "$CACHE/clean.sqlite" \
  --graph "$CACHE/graph-a.sqlite" --turns "$CACHE/turns-a.sqlite" \
  --dem "$CACHE/attica-n37-e023.tif" --dem "$CACHE/attica-n38-e023.tif" \
  --cell 4,25 --cell 5,25 --cell 8,36 2> "$CACHE/next-build.log" \
  | node tools/world-gen/pack.mjs /dev/stdin "$CACHE/next-ground-cells"
```

For slope diagnostics, capture just these three cells to one temporary NDJSON
instead of piping, then run:

```sh
"$CACHE/venv/bin/python" .scratch/athens-world/audit-surface-slopes.py "$CACHE/next-ground.ndjson"
WORLD_PROBE_PACK="$CACHE/next-ground-cells" WORLD_PROBE_PREFIX=next- \
  node .scratch/athens-world/validate-contact-pair.mjs
```

The last script expects exactly the adjacent Glyfada pair; use a separate
pair output directory rather than passing the three-cell output. Full-grid
validation must generalize that audit. `pack.mjs` already validates every tile
and every emitted adjacent seam. It emits entries, never a release manifest.

For full source regeneration, follow `tools/world-gen/README.md`. Keep one raw
cache. The full Greece download was deleted after clipping/supplement extraction;
never create a country-sized node-location index. Retained raw input hashes and
pinned source URL are documented there. Source-stage gzip exports were deleted;
their metrics and hashes are committed in `source-stage-metrics.json`.

## Measured source scope (not emitted-world metrics)

| Stage | Road km | Accepted buildings | Occupied source cells |
| --- | ---: | ---: | ---: |
| A south | 2,181.065 | 87,171 | 614 |
| B A + basin envelope | 6,944.544 | 332,141 | 1,393 |
| C mainland | 20,528.952 | 418,345 | 8,267 |

Full-stage tile counts, compressed totals, largest tiles, generation times and
per-tile physical validation are **not available**. No full stage is playable.
Ground-cell times were 37.09 seconds Glyfada and 22.01 seconds Riviera before
packing (`emitter-check.jsonl`). Source cache/source census timing is recorded
separately; do not present it as world-generation timing.

## Performance and screenshots

Lossless packing previously fell 1,754,577 → 1,380,077 bytes, with three identical
same-camera image pairs. The later terrain-u16 experiment increased transfer
and residency and is not enabled. See
`.scratch/perf-2026-10-15/world-generator/RESULTS.md` and the raw JSON evidence.
Looked-at Glyfada views: `bevel-probe-glyfada-*.png`,
`quantized-probe-glyfada-*.png`; archived Riviera: `archived-probe-riviera-*.png`.
These are labelled offline probes, never in-game release pictures. No changelog
WebP was added because Athens is not playable. Required future views remain
Syntagma, Omonia, Kifisias, Syngrou, Vouliagmenis, Piraeus port and Glyfada.

## Gates and disk

Run the six commands in `/tmp/lead-rules.txt` once on the final archived commit,
plus Python tests and both persisted fixture validators. Publish only by the
private-index/commit-tree/CAS protocol; no push or deploy. Gate logs are outside
Git under `/tmp/athens-world-wrapup-gates`; the final response records the SHA.
`.scratch` is excluded from the deploy asset allowlist, and this step changes
no runtime activation or menu files.

After green publication, remove the completed gate archive and superseded
probe spools/packed experiments. Keep the immutable corrected integration
fixture until Sol releases it. The reduced raw sources total only 88,360,923 B;
DEM crops and reduced OSM remain useful for the next physical rebuild. Canonical
SQLite caches avoid repeating source cleanup/profile generation. Cache ownership
and retained bytes are recorded in `cache-inventory.json`; no full Greece PBF or
location index should remain. Never delete another agent's files.

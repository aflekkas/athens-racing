# Penteli region importer: implementation and activation hold

2026-10-21. World-data tooling for unified-world Phase 4a, rebased onto Phase 2 (`2e4bb69a`). **Penteli is not activated in the shared world.** No cells were uploaded and `ATHENS_WORLD_MANIFEST` was not changed by this work. Route JSON, race logic and record migration remain the later route job.

## Implemented

- `tools/import-track-region.mjs` imports the full authored terrain, custom road surface, side roads, scenery, buildings, details and visible swept-collision rails into globally indexed 512 m AWT cells. Raw geometry is projected before clipping; normals use the inverse transpose, and tangents/yaw are transformed. Existing source packet identities remain intact, including individually sourced basin tiles in the Phase 2 manifest.
- `tools/world-gen/regions/penteli.json` locks 154 source/dependency hashes. Stale/missing hashes and duplicate basin cells fail. Its OSM access evidence is the reduced ODbL `penteli-access.json`, derived from the existing cached source database; private/conditional roads stay restricted and cannot supply spawn anchors.
- Directed graph edges, shared portal IDs, forward/reverse turns, source-node-backed junction connections, contact triangles, body-footprint-checked anchors and cell-owned building/rail collisions are reconstructed. No road or graph edge crosses the gap to the basin.
- `tools/build-world-set.mjs` and `loadWorldDefinition()` authenticate region documents and compose one flat manifest for the existing streamer. Mixed/missing datums, overlapping cells, stale identities, failed region acceptance and unproven cross-region boundaries fail closed. Existing single-source manifests remain valid.
- Penteli material recipes retain road markings, side-road material attributes, terrain textures, concrete parapets, metal rails and facades. Imported WorldDetail records use the existing setting-controlled detail layer. The existing driving/race/recovery implementation remains in charge.

## Geometry changes

The imported side-road mesh retains its footprint. Numerically collapsed faces below 1 mm altitude are removed and counted; pathological skinny fans are intersected with the actual source terrain triangles. The old generic side-road asphalt lift is reduced from 10 cm to 7.5 cm. Town paving is lowered by 10 cm to remove its old 24 cm outside step. The custom main Penteli carriageway heights are unchanged. These are local render/contact conformance changes, not a vertical-datum conversion. The shared tiler also stops conflating nearby seam vertices by rounding their global coordinates to Float32.

## Acceptance

The machine-readable report and matched road-level comparisons are retained in `/home/dev/data/agent-feed/penteli/`. Images are 1280×800 WebP, below 150 KB each, with adjacent text captions. Stations 2400, 3920, 4500, 5730 and 9000 m compare the old authored map with the actual WorldTileStream/WorldTileScene at the same camera poses. The static capture uses a larger scenery ring; it is not a low-end startup-transfer or gameplay acceptance result.

The final measurements below are filled from `penteli-equivalence.json`; the importer exits unsuccessfully until all activation requirements pass.

| Check | Result |
|---|---|
| Full region / old route cells | 225 / 21 |
| Old route asphalt coverage | 5241/5241; maximum height error 1.203 cm |
| Maximum asphalt slope | 29.697° (limit 30°) |
| Maximum graph profile grade | 39.153% (limit 45%) |
| Maximum audited shoulder slope / step | 29.772° / 14.301 cm |
| Full-route shoulder sweep | 262050 samples; 14.164 cm maximum step; no missing contacts |
| Shared contact edges | 420; 989261 samples; 1.541 cm maximum seam delta; zero failures |
| Contact transitions | 401; 14.604 cm maximum delta |
| Graph / recovery anchors | 14484 directed edges; climb and descent connected; 561 proven anchors, 77 rejected |
| Preserved collision/scenery | 1271 rail segments, 2599.89 m; 14 building colliders; 1602 detail records |
| Penteli compressed cells | 27,885,829 bytes (26.59 MiB) |
| Worst 2×2 resident set | 66,218,410 bytes (63.15 MiB), below 64 MiB |
| Basin + Penteli compressed cells | 414,836,687 bytes, below 2 GiB; no duplicate cells |
| R2 staging inventory | 2,738,166,471 bytes / 9,500 objects; zero uploads; below 5 GB |
| Release acceptance | **Held**, despite geometry passing; blockers below |

Source revision: `69538b820e6db80e6c92a9d8679d330ab66e564e13905e4555a743b827c46282`. Basin revision: `4241d71bb4d87f995cde84bbf5af3d3c11d014f5ca5e4a2055c65c42f437827e`.


## Activation blockers

1. Penteli's recorded EU-DEM v1.1 source uses **EVRS2000**. The cached Athens basin elevation source says **EGM2008**, while the current staged basin manifest does not declare an elevation datum at all. A documented, approved offline datum conversion (and truthful basin metadata) is needed. No invented Y offset or relabelled datum is used.
2. The legacy Penteli bundle retains two OSM bridge ranges and their visible parapets, but it has no emitted layered deck/underpass clearance proof. That proof is explicitly pending; preserving the old mesh is not claimed as bridge-clearance acceptance.
3. The comparisons cover the authored terrain/road/custom scenery layer. Full legacy scene parity is not yet certified: mapped speed signs, municipal bins and distant regional silhouettes still need migration/verification.
4. Candidate anchors pass footprint/contact/barrier checks, and swept rail collision has a 150 km/h regression. Streamed vehicle tow/no-fall/no-launch acceptance remains pending after attachment is possible.

`manifest.acceptance.passed` stays false. Both the R2 publication entrypoint and world-set composition reject a failed acceptance manifest. There is no change to the release thresholds or `steep-exclusions.json`; no new steep streets were excluded to obtain these measurements.

## Reproduction

Use an isolated checkout and a task temp directory. Check shared disk first; the importer stops at 83%. Reuse `/home/dev/data/athens-world-cache` without deleting it. Review source edits before explicitly refreshing the lock:

```sh
node tools/import-track-region.mjs --lock-sources
node tools/import-track-region.mjs "$task_tmp/bake" "$task_tmp/current-basin.json"
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs bash tools/browser-slot.sh \
  node tools/penteli-region-capture.mjs "$task_tmp/bake" /home/dev/data/agent-feed/penteli after
```

The import is single-process and does not publish. Do not update the active manifest until the remaining gates pass. The source lock deliberately includes importer dependencies, so refresh/rebake after a relevant source change.

Required repository checks: `flock /home/dev/.local/state/athens-release/agent-test.lock npm test`, `node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs`, `node tools/check-browser-imports.mjs`, and `node tools/check-syntax.mjs`, on a clean archive of the exact candidate. Test results and the eventual commit SHA are recorded in the handoff, rather than self-certifying an untested commit in this document.

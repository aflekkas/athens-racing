# Source-backed infill correction — preparation evidence, game proof pending

Codex gpt-6.1-sol implemented this correction using the Cogenly terminal and Python/Shapely. Two local cells have now passed authoritative physical preparation (see the final section). No game capture, hosted asset mutation, push or deployment has occurred. Full clean-archive gates and before/after browser proof await the parent's allocation. This is not a completed game-fidelity repair.

- Official OSM snapshot (shared read-only): `/tmp/athens-greenery.98Rc/kefalari-core.osm`, 8,457,632 bytes, SHA256 `dc8befa257f20b2091256e580000df2075455fec135cbf224cec81a1c4961fdd`. Its adjacent `.source.json` records the official API request/response provenance. © OpenStreetMap contributors, ODbL 1.0.
- Existing full-cell audit: greenery worktree `.scratch/kefalari-greenery/building-source-audit.json` (supplied by parent). Actual Artemidos pose `[8093.714,-10549.749]`, latitude 38.0747696 / longitude 23.8222410. No road/place name appears in the implementation.
- `source-audit.json`: independent closed-way footprint/green-cover audit. 80 m: 20 intersecting footprints, 31.43% cover, no heights; 150 m: 58 footprints, 24.68% cover, 5.94% mapped green, no heights. Relation geometry is additionally included by the production SourceContext OSM reader.
- `infill-decisions.json`: exact existing 10 generated IDs/footprints supplied by the prior cell audit, evaluated against source-only OSM context. All 10 rejected: local unbuffered main-building cover 21.25–27.73%, no explicit residential height observations. This does not remove any hosted geometry or collider.

## Approach and limits

`infill.py` retains the 60 m ring gate and the existing lot/grid/60% cover recipe, and adds a per-lot 150 m unbuffered source coverage requirement of 35%, with at least three mapped main buildings. The 35% cutoff is a conservative inference policy, not a claim of urban classification or actual surveyed heights. Mapped garden/park/wood areas block a lot, and an affirmative majority of house-like types blocks generic apartment infill. Three or more explicit residential height/level samples, representing at least half the neighborhood buildings, cap inferred floors at the upper quartile. Missing source heights never become explicit observations. Dense unknown-height sources preserve the old 4–7 floor recipe. Existing authored Vas/Psychiko/coastal files are unchanged; direct legacy `lots_in` calls retain their original result.

`build(..., source_path=None)` defaults to cache/source.sqlite. It can instead consume a bounded .osm/.pbf to retain leisure-only areas omitted by old ingestion caches. With no original source it conservatively uses unbuffered clean footprints and explicit `heightSource` only. Such legacy caches cannot recover building type or omitted gardens; prefer the official bounded extract. Generated records retain their per-lot inferred evidence. SourceContext only supplies decisions; it never rewrites cells.

`model.py` only adds `building=roof` to the existing 3.2 m garage/shed fallback. Valid height then building:levels still win; building=yes is unchanged. The OSM tag means open on at least two sides: https://wiki.openstreetmap.org/wiki/Tag:building%3Droof . The fallback is an explicit generic approximation, not surveyed height. Current extrusion remains a solid collision prism, so open sides are not represented. Snapshot audit: 26 Kefalari roof ways and 49 canonical Ekali roof ways, all without height/levels. Changes affect future bakes only, preserving old immutable source identities until recompiled.

## Focused verification

- `TMPDIR=/tmp/athens-infill.Pvm7 /tmp/athens-highway.GIu3/venv/bin/python tools/world-gen/infill_test.py`: 9 passed, 0 failed (0.431 s).
- `TMPDIR=/tmp/athens-infill.Pvm7 WORLD_GEN_PYTHON=/tmp/athens-highway.GIu3/venv/bin/python node --test tools/infill.test.mjs`: 1 passed, 0 skipped/failed; wraps the 9 Python cases.
- `node --test tools/coastal-dressing.test.mjs tools/world-psychiko-buildings.test.mjs`: 20 passed, 0 failed after `npm ci --ignore-scripts --no-audit --no-fund` installed 44 packages. First attempt lacked `three`; no behavior failure.
- New unit-group registration: `tools/infill.test.mjs`; parent must union this entry with other children's manifests.
- Source OSM parse and 10 decisions took 1.13 s. No runtime code or added rendering resource cost. Density analysis is offline only.

## Files

- tools/world-gen/infill.py: eligibility, source readers, explicit scale evidence, source metadata.
- tools/world-gen/model.py: roof-only generic fallback.
- tools/world-gen/infill_test.py: dense/sparse/green/typed/roof/provenance/end-to-end regressions.
- tools/infill.test.mjs + tools/test-groups.json: focused npm unit registration.
- This directory: compact source proof and handoff.

Required follow-ups owned by parent: coordinated building table/physical collider repair through authoritative packing, exact all-cell source hashes and immutable road/terrain/authored recipe controls, actual game before/after captures, full clean-archive gates, PROBLEMS/CHANGELOG integration. Never mark source-only work as fidelity complete.

Disk before: 145G total / 73G used / 72G available / 51%. One task temp `/tmp/athens-infill.Pvm7` contains only scripts/logs and private index. No copied raw OSM/cells or server/browser processes.

## Strict repair helper (synthetic phase)

Approved separate ownership: `tools/world-gen/repair-infill.mjs`, `tools/infill-repair.test.mjs`, and its private unit-manifest registration. The helper does not fetch, publish, or write real cells. It requires exact compressed cell SHA/size, world/revision/cell, the full decoded metadata/array fingerprint, official bounded source SHA plus adjacent provenance-record SHA, policy/model/building code hashes and unchanged Psychiko/coastal recipe hashes, and a separately pinned reviewed-plan digest. It evaluates source eligibility itself and refuses an incomplete 150 m source context. Targets are exact whole generated IDs and exact source row/corners/base/height fingerprints. Clipped pieces, mapped buildings, stored building meshes, prepared dressing and authored/coastal recipe cells fail closed.

The pure mutation appends replacement authoritative buildings/corners/heights and remaps row-aligned facadeStyle/detailSeed/roofShape. It retains original arrays to protect mesh/contact aliases; old unreferenced bytes are a known small offline packing overhead that the standard packer must count. Every unrelated table and original array remains byte-exact. Retained wall rows and physical CSR ranges are verified. `repairedSpool` is input to ordinary `packTiles`, with its usual physical/bridge/road/seam/resource gates. `auditRepairedPacket` checks that active table rows have no removed generated ID and that the post-dressing collider CSR matches active buildings plus visible parked car/scooter boxes. It explicitly does not claim traffic clearance or game proof.

Synthetic command: `TMPDIR=/tmp/athens-infill.Pvm7 WORLD_GEN_PYTHON=/tmp/athens-highway.GIu3/venv/bin/python node --test tools/infill-repair.test.mjs tools/infill.test.mjs` → **8 Node tests passed / 0 failed / 0 skipped**, including the wrapper's **9 Python tests** (0.93 s overall). `node --check tools/world-gen/repair-infill.mjs` and `git diff --check` pass. No actual cell packing or browser runs were done. The parent must union both `tools/infill.test.mjs` and `tools/infill-repair.test.mjs` into its unit manifest.

The remaining real-data acceptance must quantify source-cell and output hashes, all ten lot clearances against roads and retained mapped walls, new parking placement and traffic corridors, unchanged full Vas 3647/coastal recipes, dynamic browser drive-through and matched before/after captures, ordinary packer budget/accounting, and all allocated clean-archive gates. The repaired entries must be integrated into the parent's common world/revision assembly; helper output alone is not a playable/release manifest.

Strict-plan follow-up: original source context cannot silently omit malformed geometry. The read-only plan builder additionally checks relevant source ways are closed, relevant relations have no unresolved member in the provenance record, every expected relevant way assembles, and all assembled source polygons are valid. The strict subclass leaves `infill.py`/`model.py` unchanged. Added malformed-way and unresolved-building-relation negatives to the existing source-plan test. Combined focused run remains 8/8 Node + 9 wrapped Python, 0 failed/skipped (1.27 s).


## Actual local physical preparation — 2026-10-23 08:00:47–08:03:51 UTC

The parent allocated the slot after infrastructure END. It ended within five minutes, exit 0, and the parent/route/infrastructure owners were notified that the CPU slot was free. No full suite or browser ran in this slot.

- `39-source-hashes.json`: **39/39** compressed source hashes and sizes match the greenery owner's exact `cell-audit.json` fixture and the authenticated original unified manifest, **10,993,992 bytes** in all. The shared cache now contains 1,748 cells, so only these 39 reviewed entries were hashed. Only the two target cells were decoded/packed.
- `plan-15,-21.json`: the exact reviewed 10-ID source decision plan and full source/code/cell fingerprints. All ten targets belonged to **15,-21**; the neighbor **16,-21** is a negative control.
- `actual-summary.json`: ordinary `packTiles` **2/2 passed**, including physical surface, bridge, road-section and bore gates, neighboring seams and ordinary runtime packet/resource accounting. `auditRepairedPacket` verifies active authoritative rows and collider CSR match rendered buildings plus visible parking. The physical output is local preparation, not a hosted or release-ready world.
- Cell 15,-21: **370 → 360** building rows, **33,877 → 33,777** base triangles, **289,767 → 278,129** compressed bytes. Retained mapped walls, roads, terrain, graph, signs and anchors remain byte-exact. Packed resident reservation: **2,898,304 bytes**.
- Cell 16,-21: **385** building rows retained, **30,628** base triangles, **228,876** output bytes, **2,577,194** resident bytes. Its arrays are unchanged; its local revision changes with the two-cell preparation set.
- `static-clearance-audit.json`: all ten former generated footprints have **≥1.575 m** gap from retained mapped footprints and **≥3.9057 m** from the graph centreline's 0.95 m half-width envelope. The two packets have **51** visible parked cars/scooters, with **0** overlap issues against the **399** retained mapped building pieces. Closest parking-to-former-lot gap is **7.0561 m**. This is static geometry evidence only: lane offsets, moving traffic, actual driving and browser-visible collision still need verification.

The first local runner attempt correctly failed `AWT/1: world mismatch`: it pinned the native cell to the unified manifest's top-level `athens` identity. Immutable cells instead declare the manifest entry's `source` identity, here `athens-east-development` / revision `2881ca7fd0b8aeea46ac66a296e14cd6033d78936fb113ffc0cb8d5015b1da39`. The runner was corrected to pin that authenticated per-entry source identity. The strict identity guard was unchanged. An initial fixture lookup also found the current route-input file had only seven cells; no 39-cell success was claimed until the parent supplied the exact greenery fixture.

Local two-cell revision: `4bc3e92a3624f1c28a1bb39acb843d3b611ff7bbe631aeca7adc8f2e198c2961`. One read-only copy of each derived binary is retained outside Git under `/tmp/athens-infill.Pvm7/actual-cells/`, named only by SHA256, **504 KiB total**. The directory and files are read-only. Output hashes: `e06080fbc87885feb6f60ee89c706e19219c495ada7a0b092a7763c86872840e` and `a8b667d654f8824a7f48dd57b55fb004c1d3f355aed4ea2decc01ac61ffefba8`. The ordinary packer entries and source provenance are preserved until the common assembler handoff. No binaries are committed.

### Reproduce during an allocated slot

`reproduce.mjs` plus `reproduce-config.json` pin the exact official source, authenticated manifest, 39 fixture hashes, generated IDs, reviewed plan digest and unchanged policy/recipe code. Run from this checkout with a fresh task-temp output directory:

```sh
node .scratch/source-backed-infill/reproduce.mjs .scratch/source-backed-infill/reproduce-config.json /tmp/athens-TASK.XXXX/reproduction
```

The reduced evidence files above are committed; they are derived from OSM and our own game geometry, with © OpenStreetMap contributors / ODbL 1.0 attribution. No raw OSM extract, third-party media, or derived cell binary is committed. The reproduction tool passed `node --check`; the already-completed actual run used the same helpers and ordinary packer. It has not been rerun while the route owner owns CPU.

### Remaining acceptance and ownership

Greenery acknowledged the new physical base and will overlay its actual entries before rescenery, after route FULLGATE END and a parent-allocated bounded slot. Scenery-only physical and parking hashes must be compared against this corrected base. Removing an unsupported generated body is not evidence for a private garden or tree location; any further planting stays explicitly inferred and source-backed under the greenery owner's rules.

The current roof-only default change affects future authoritative bakes; this deletion-only preparation does not rewrite the existing mapped roof's height. It also leaves unsupported generated bodies outside the ten explicitly reviewed IDs unchanged. Full Vas 3,647-building and coastal recipe sources are unchanged and pinned by the plan. Common world identity assembly/recompilation, exact final cell/source bindings, matched forward Artemidos before/after frames, moving traffic, visible collision/parking clearance, full clean-archive gates and parent PROBLEMS/CHANGELOG reporting remain open. No full-fidelity claim is made.

# Source-backed infill correction — source phase only

Codex gpt-6.1-sol implemented this correction using the Cogenly terminal and Python/Shapely. No game capture, physical cell repair, hosted asset mutation, push or deployment has occurred. Full clean-archive gates and before/after browser proof await the parent's allocation. This is not a completed game-fidelity repair.

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

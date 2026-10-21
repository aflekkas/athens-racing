# Riviera cell dressing

This pass dresses the existing shared world through Loumbarda. It adds no cells and does not extend to Lagonisi or Saronida. `tools/world-gen/coastal-dressing.py` extracts OSM land-cover polygons, lake/pier outlines, marina placements and residential infill into `src/coastal-dressing-data.js`. The normal tile worker owns, admits and unloads each cell's dressing. There is no standalone Riviera map overlay.

The source bounds are `(2560,15872)–(10752,20992)` in the shared Athens projection: 112 existing cells. Source records retain OSM IDs, names, projection, input hash and exporter hash. The 1,229 existing surveyed OSM building pieces in those cells remain authoritative. Mapped woods and parks favour Aleppo pines; unbuilt land without tags defaults to Mediterranean scrub. Beaches alone use the sand palette; steep ground uses warm limestone. The existing ground shader supplies dry earth/grass/rock variation. Alternate colours preserve the original ground when World detail is Off.

Vegetation uses deterministic world-grid candidates throughout the envelope, actual ground heights, asphalt/footprint exclusions and slope checks. At most 2,048 extra rows per cell are retained. Detailed pines/shrubs draw within 65/32 m; two shared silhouette batches fill the farther cover out to 750 m, capped at 1,400 pines and 1,400 shrubs (5,600 triangles total). Pines have three rounded, irregular foliage clusters, bent/leaning trunks, varied proportions and dark blue-green needles; the distant silhouettes also vary between Aleppo and stone-pine forms. Dense low maquis fills their gaps. The 98-triangle near pine remains below the existing 100-triangle model gate. Degenerate pole faces are omitted. They have no new textures, lights or shadow passes. Coastal street trees are also checked against actual asphalt rather than estimated lane width.

Residential infill reuses the basin pass introduced in `9c90acfb`, with its existing road/footway/building/land-cover/water exclusions, 15% surrounding mapped-building threshold, 30,000 m² maximum free block interior and 60% coverage cap. Only the storey range changes to 1–3. The exporter found 358 candidates; 318 fit wholly within individual cells. Runtime ground/asphalt/land-cover checks retain **163 inferred houses**. They replace the older bake’s 468 basin-style generated pieces rather than overlapping them; candidates failing the coastal ownership, slope or land-cover checks are not retained. Their white/ochre plaster, shutters and optional tile roofs use the existing derived-building renderer. They are explicitly recorded as inferred, with a separate counted collision index. Both their meshes and collisions disappear with World detail Off. Woods, beaches, rock slopes, unmapped open land and roads receive no infill. The same source-driven recipes can serve later southern extensions.

The lake uses OSM `w50825797`. `tools/world-gen/coastal-relief.mjs` corrects the DEM inside that outline before packing. Its surface uses the reported **0.5 m above sea level** ([Greek Travel Pages, Athens Riviera](https://www.gtp.gr/LocPage.asp?id=72764)); the coarse DEM had sampled the limestone banks instead of the water. Bathymetry is explicitly inferred. The guarded refinement adds 8,250 local terrain vertices, adjusts 1,068 shared render/contact vertices and exposes 7,128 m² of water. Low banks within 18 m of the outline grade toward the shoreline; the high limestone rim remains intact. Existing park vegetation follows the corrected bank. These shoreline and bathymetric corrections are inferred. Whole supporting triangles near emitted asphalt are protected, not just individual vertices; roads, shoulders and coarse border heights remain unchanged. The basin is physical world data; the optional water surface disappears with World detail Off. Limestone uses dry broken strata, fine fissures and grey-green scrub pockets from the existing noise atlas, with no extra texture. The same shader dresses the lake cliff and tunnel hill.

Marina boats use the old Riviera hull/cabin/mast recipe through the existing pooled props layer; a hull is retained only when all its corners lie over existing sea floor. Pier dressing is limited to existing low coastal ground. The mapped Astir buildings remain the existing footprint meshes.

Loumbarda retains the original cell-owned bore floors, interior shells and collision walls from `2eff6d44`. The old isolated outer shell faces and outward-facing backs of its duplicated interior faces are removed. With detail enabled, the remaining obsolete tan lining is hidden and replaced by a continuous concrete lining; the original interior remains essential geometry with detail disabled. Broad procedural rock slopes and the native shared-pier recipe join the bores into one hill. Concrete headwalls and wing walls sit at their mapped portals. Both bore envelopes and the complete curved approach corridors are cut out of the hill, preserving seven metres of headroom above the approaches. The source axes and small shared height lattice are exported by `coastal-bore-recipes.mjs`; generated triangles are clipped to each owning cell. Vegetation samples the highest upper rock surface so eight pines and twelve maquis shrubs stand on the new hill rather than beneath it; underground asphalt does not suppress plants on the roof above. New wing-wall collisions share the optional obstacle index. World detail Off removes the hill, concrete faces, water, vegetation, boats and inferred houses, including their optional collisions; essential bore interiors and physical terrain remain.

Street furniture and parking continue to use the basin pass and its existing density limits. Inferred houses participate in placement exclusions. Computer-only, Lighting Off and Effects Off are unchanged.

## Gates and budgets

The final manifest and physical/visual gate results are recorded in the `scenery-*` evidence beside the screenshots in `/home/dev/data/agent-feed/riviera-coast/`. Cells and credentials are never committed. Only the staging bucket is written.

`tools/world-gen/refine-world.mjs` streams the unchanged 1,451-cell union through the authoritative `packTiles()` gates with at most four workers. Every input compressed hash is verified. Each worker checks asphalt, profiles, shoulders, contacts, bridge and dressed-bore clearance; the parent checks every cross-worker seam and the unchanged 64 MiB / 2 GiB budgets. Only the mapped lake's terrain changes. Graphs, road cross-sections, anchors, surveyed footprints and bore floors retain their original data. A fresh full-world revision and immutable content hashes replace the old manifest only after validation.

`tools/world-gen/coastal-dressing-audit.mjs` additionally prepares all 112 affected cells, verifies that runtime dressing does not mutate their physical tables, checks the dressed bore envelope and accounts for every added array and optional collision index. The manifest reserves measured packet residency with 25% headroom, including the denser vegetation and portal geometry.

Browser comparisons use identical road-level poses, the locked Lighting Off + Effects Off look, paused simulation and moving traffic hidden; parked cars and scenery remain. Calls and triangles are the maximum of six renders to include the periodic mirror pass consistently. World detail Off is checked separately. This shared-host software-renderer proof does not claim physical-device FPS. No new textures are allocated.

## Accepted measurements

The world stays at **1,451 cells**, with scenery in **112**. The complete pack passes 6,320,394 asphalt triangles (maximum **27.0235°**, zero above 30°), profile grade **42.3843%**, shoulder step **14.3679 cm**, shoulder slope **29.8867°**, and 347,055,800 shoulder/contact samples with no missing contacts. All **2,685** physical cell borders match. Bridge clearance is **4.6772 m**; essential bore clearance is **5.1622 m**, detailed lining clearance **6.4582 m**. The optional rock hill also passes 1,500 shared-border height comparisons (maximum difference below 1e-12 m).

Compressed world: **386,893,712 bytes (368.97 MiB)**, below 2 GiB. Worst admitted 2×2: **30,407,222 bytes (29.00 MiB)**, below 64 MiB, with measured dressing plus 25% admission headroom. There are **112,752** coastal vegetation placements, **95** retained marina boats and **163** inferred houses. Fine lake contacts remain detailed; exactly redundant coplanar subdivisions are coalesced only for rendering. No new textures are allocated.

The road-level coast/lake/portal/town comparisons peak at **+8.0% draw calls** and **+15.67% triangles**, below the owner's +10% / +25% limits. Detail Off hides optional meshes and vegetation and disables their extra collision index. These are software-renderer counts, not a hardware FPS claim.

Staging manifest: `manifests/6d57b168364cd168f8beb419f864edff1a8d94729e4119745a84597c4ce3ab4a.json`. Staging-only admission plans **387,371,440** new bytes including the manifest, for **2,737,482,371** bytes in the bucket, below 5 GB; the final inventory is in `scenery-r2-final.json` in the visual feed. Production remains held. The spawn-map metadata and Syntagma validation shard follow the new world revision; its edge/turn/contact proofs, geometry hash and route hash remain unchanged.

## Reproduction

Keep the shared cache and `/tmp/athens-world-cache` symlink. In a task-owned scratch directory, generate a separate infill database without modifying the basin cache:

```python
import sys
sys.path.insert(0, 'tools/world-gen')
import infill
infill.build('/home/dev/data/athens-world-cache', 'assets/athens',
             '/TASK_SCRATCH/infill.sqlite', (2560,15872,10752,20992), (1,3))
```

```sh
/home/dev/data/athens-world-cache/venv/bin/python tools/world-gen/coastal-dressing.py \
  /home/dev/data/athens-world-cache riviera src/coastal-dressing-data.js \
  --bounds 2560,15872,10752,20992 --infill-db /TASK_SCRATCH/infill.sqlite
node tools/world-gen/coastal-bore-recipes.mjs BASE_MANIFEST HASH_CELL_DIR src/coastal-bore-data.js
CLOUDFLARE_ACCOUNT_ID=d6f3d2dc5817687a91d74ccd257bad9e ATHENS_WORKERS=4 \
  node tools/world-gen/refine-world.mjs BASE_MANIFEST HASH_CELL_DIR /TASK_SCRATCH/world
node tools/world-gen/coastal-dressing-audit.mjs MANIFEST HASH_CELL_DIR REPORT
```

The exporter bounds select dressing sources, never physical world extent. OSM contributors, ODbL; no third-party images or new downloaded media are included.

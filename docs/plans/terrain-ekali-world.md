# Complete generated terrain and connected Ekali expansion

Status: source/build preparation, not world acceptance or publication. The parent owns integration, staging, production and documentation consolidation. The verified 27-cell result and screenshots are in `.scratch/smooth-terrain-seams/README.md`, commit `89a9d6e`; implementation is `429b46f7`.

## Ownership

Terrain child owns `terrain-relief.mjs`, `refine-terrain.mjs`, bounded official OSM extraction, Ekali area/bake assembly and elevation integration plus focused tests. Route child owns source direction/restriction audit and the new route/proof. Infrastructure child owns `tile_detail.py`, supported highway context/supports and marking helper; coordinate any `ingest.py`/`tiles.py` changes before editing. No terrain edits to `main.js`, UI/loading, route definitions, PROBLEMS or CHANGELOG. No child uploads or releases.

## One original cache and one final world

The loader owns `/tmp/athens-loaders.OfMh/original-world.json`, its `.source.json` binding and `cells/<sha256>.bin.gz`: all 1,748 cells, 453,885,605 compressed bytes, individually checked. Original revision `80055f9208753e2d6fa8658b31c90216d22c650f7f33588ebd5178d1a6b804a1`; flat manifest SHA `2790fa21d0c16271f5e4a097101ba1414ca8a949f8805c416b4b8dfbc68dc718`. Read-use only; the loader retains it until parent release. Never redownload or delete this cache from the terrain job.

Refinement accepts `ATHENS_SOURCE_CACHE`, `ATHENS_SOURCE_REVISION`, `ATHENS_SOURCE_MANIFEST` and `ATHENS_SOURCE_MANIFEST_SHA256`. Missing/corrupt shared entries fail without network fallback or writes. The global atlas retains 4,225 heights per cell; the filter memo is bounded to 32,768 entries without changing calculated heights.

The intended final derived directory is `.scratch/smooth-terrain-seams/final-world/`. It does not yet exist as an accepted result. It will contain the single flat manifest/cell set after both complete terrain/paint processing and the Ekali extension. Loader recovery exports run once on that final domain, not on the old 1,748-cell world first. Large world files stay out of Git.

## Complete terrain scope

Read every original cell, classify exact region identity and protection reasons (authored/legacy, no generated fine surface, structure layers, bores, lakes). Refine all eligible generated cells together; do not pretend the 27 selected cells establish complete coverage. The 128 m protected and outer-boundary transition stays explicit. Report selected/eligible/protected counts and every protected reason, full-strength comfort, transition comfort and protected whole-cell comfort separately. Null/no samples is never a pass. Smoothing is not evidence that protected topology or geographic infrastructure is correct.

Apply the existing infrastructure `conformMarkingSurfaces` after terrain and before `packTiles`. Exact surface ownership and same-layer clipping remain fail closed. Protected-cell paint needs its own supported audit; do not silently claim paint in untouched cells was repaired. Record all source packet triangle/draw totals, compressed bytes, resident safety sets, every physical/shoulder/bridge/bore result, shared contact seams and exact graph portals. Keep the original authored Psychiko 3,647-piece recipe/source hash and verify worker restoration/owners against new terrain. Combined vegetation road/building clearance must be checked after all final geometry changes.

No comfort/physical tolerance is widened. Real broad hills and affine grades remain, while the independent 0.5 m / 32 m chord gate still rejects roller-coaster profiles. Retain and investigate genuine outliers rather than suppressing them in statistics.

## Ekali source and genuine connection

Canonical source prepared 2026-10-23: `/tmp/athens-terrain.uKVC/ekali-cache/ekali-complete.osm`, 15,643,924 bytes, SHA `6b3a65219bc0f2d94603b867c5da7e94db16e9160d6112f39ea9c9677dfdca33`. Official `api.openstreetmap.org/api/0.6/map` bbox `23.8117,38.0904,23.8526,38.1272`; the whole request hit the 50,000-node cap and was divided at latitude 38.1088. The two successful map reads were at 06:51:35 and 06:51:39 UTC; `way/556144178/full` at 06:51:42 closed one restriction. Source record contains every response URL/hash/time and failure evidence. OSM data © OpenStreetMap contributors, ODbL 1.0; see `tools/world-gen/CREDITS.md`.

Merged source has 62,589 nodes, 7,171 ways and 143 relations, zero missing way nodes, and complete restriction-member closure. It explicitly lists 22,418 unresolved non-restriction relation members; those relations are not claimed complete. Preserve whole way ordering and fail on inconsistent snapshots. Broad route/boundary relations outside this bounded bake are not grounds to invent geometry.

The corrected route source proposal is about 2,116.98 m (56/56 normalized public source traversals; the earlier 2,085.94 m candidate was rejected for reversing an implied one-way roundabout) and crosses three core cells `17,-29`, `18,-30`, `18,-29`. Its 15-cell halo is provisional, not a final bake extent. A real corridor through z=-27/-28 must connect it to the existing z=-26 boundary. Known authenticated boundary facts:

| Street | Existing graph identity | Boundary x/z | Existing emitted y |
|---|---|---|---|
| Rodon northbound | `osm:way:81720483:0-1:f:17:-26`, portal `w81720483:0:270.506540` | 8801.761 / -13312 | 342.03494 |
| Rodon southbound | `osm:way:81720521:41-1:f:17:-26`, portal `w81720521:41:25.196428` | source pair 7839198255→952160960 | retain full emitted record |
| Thiseos both directions | `osm:way:216905290:21-1:b/f:16:-26`, portal `w216905290:21:15.134034` | 8370.955 / -13312 | 304.31873 |

Current source preserves w81720521 v12 / 49 refs, w81720483 v9 / 50 refs and w216905290 v12 / 25 refs. Raw node indices are not emitted road-part indices: do not relabel part 41 from clipped geometry. Road normalization, turn restrictions, legal access, source nodes, portal identity and directed connectivity must be proven against the same canonical source. No guessed road links, closure bypasses or vehicle-only height corrections.

## Actual DEM and join

Pinned repository source: Copernicus GLO-30 DSM N38 E023, official public AWS endpoint in `fetch.py`, 32,409,679 bytes, SHA `c289c4a9b2c5c8b5b07e475129134bbb6b64b3ccb86d23eca3428b8e7f5bce28`. A local crop bounds `[23.80,38.08,23.87,38.14]`, algorithm `pixel-window-halo1-v1`, is 142,528 bytes, SHA `59d984ef5a145f90bb614c7aef31677877c6d32cb9d1da37363eefb0d7fc87b7`. Datum EGM2008; source licence/credit in CREDITS. No substitute flat plane or inferred new elevations from the old road endpoints.

Actual sampled proposed-route DSM heights are approximately 314–336 m. At the two old boundary samples DEM is 343.12984 versus emitted 342.03494, and 304.63200 versus 304.31873. These are real differences between DEM and the existing road-conformed field, not evidence of a DEM datum error. New profiles, generated ground and old boundary contact/render/graph must join through a common supported field or a rebuilt common boundary with proven outer seams. Any source/version/width mismatch enlarges the explicit rebuild set or fails; never hide it with tolerance changes. Rebuild and audit only the needed north boundary/context cells; do not rebake the accepted seven Kifissia route cells without evidence.

Build stages: canonical OSM ingest → normalized clean objects → DEM/shared profiles → directed graph/restrictions → sidewalks/sections → source vegetation/details → one structure plan for the bounded union → generated cells → complete-world common terrain refinement → marking conformance → authoritative pack and assembly. Every cache records source and generator hashes. Missing incomplete building relation geometry is counted, not invented. Physical acceptance decides the final extension footprint.

## Geographic infrastructure remains separate

Three sampled Kifisias upper/lower orders match OSM bridge tags. The generator's uniform six-metre depression is not geographically validated by those tags or clearance passes. Source/profile and actual imagery audit is pending its coordinated browser slot. The circular ramp has real three-level dependencies and was omitted by the existing short-approach/stacked policy. Context/support work must not invent piers. Parent resolves evidenced policy gaps; smoothing does not resolve them.

Sampled turn-footprint failures at Mitropoleos/Stadiou/Loumbarda do not establish missing source asphalt. Test bounded safe alternative turns before attributing anything to terrain.

## Final verification and publication handoff

Heavy jobs wait for the parent CPU queue; browser work uses the shared browser-slot and explicit handoffs. After exact candidate source is committed, use a clean archive for npm (jobs=2), physics, browser imports and syntax, plus full-mode world terrain fixtures and focused new tests. The complete candidate also needs physical gates for every changed cell, exact seam/contact tests against unchanged neighbours, graph/turn reachability from the original world to Ekali and back, road-contact/same-layer footprint checks and actual game driving/screenshots.

Then parent combines final source/runtime changes and world, recompiles every route geometry identity/contact proof and recovery sidecar, and binds eight spaced online-grid poses to the final release. Re-capture bounded route and terrain proof on that combined candidate. Check compressed/R2 combined ceilings, resident sets, initial download and stream/performance limits. Final canonical URLs and hashes must resolve from both coordinated buckets; the local mixed-source manifest is not a production publication. Parent owns all uploads, staging/release train and rollback to the previous immutable manifest. No final acceptance claimed until these checks finish.

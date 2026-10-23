# Source-only highway context and experimental profiles

No runtime entry, ordinary bridge policy, source plan or generator callsite imports the experimental solver. Nothing in this change activates roads or publishes world data. Every profile/feasibility result is hard `releaseEligible:false`.

## Mapped source ingestion

`ingest.py` adds separate `context_sources` and spatial tables, retaining literal retaining-wall lines and closed `man_made=bridge` way/multipolygon footprints. IDs, versions, timestamps, original input SHA, exact WKB geometry SHA, record SHA, tags and node/member references survive. Duplicate IDs fail instead of overwriting source objects. Multipolygon member ways are not emitted twice. Invalid/unclosed footprints and unassembled relations are counted. Road features, node-use counts and existing extraction tables are unchanged. The source recipe fingerprint includes the new extraction module; an old source DB cannot silently masquerade as the new schema.

`structure_context.matched_footprint` requires one explicit, complete bridge-source family association and matching source hash. It never chooses a nearby polygon. Mapped footprints constrain context only; they do not create physical surfaces, turns or pier positions.

## Exact surface certificates

The frozen physical base must be the **same corrected base** immediately before context dressing, not an older hosted base that preceded authorized terrain/infill repairs. Authenticate it through its authoritative entry and immutable compressed bytes:

```
const proof = await prepareContextCell({compressedBytes,entry,world,revision,cell});
```

The offline Node helper uses the existing AWT codec/validator. A support reference names `sourceSha256`, exact `table` (`contactTriangles` or `fineTriangles`), triangle number, actual owner ID and physical layer. Terrain owners without a mapped surface ID use `terrain:x,z`, still bound to the exact cell/triangle/SHA. Caller-supplied heights are never used.

`compileMappedWallProfile({record,geometryBytes,retainedSide,spans},proofs)` validates original source record/WKB hashes and compiles explicit top/bottom triangle supports. Spans must cover every source metre, split at source bends and fit within one affine supporting triangle at each end. Maximum span is2m. Missing/ambiguous supports, owner/layer/cell mismatch, gaps, inverted spans, and intersection of a wall face with a road's4.5m clearance volume fail closed. A face exactly on a road's horizontal boundary can touch it. This is a context collision check, not permission to lower existing clearance limits. No thickness, wall height or pier geometry is guessed.

The compiler returns certificate bytes and their exact SHA. Python `read_profile_certificate(bytes,expectedSHA)` loads this trusted local build artifact into an identity-sealed process-local token. The expected SHA must be retained by the caller from the verified compiler result, not accepted from a mutable profile file. This local build hash is not a third-party digital signature. `tile_detail.mapped_retaining_wall_mesh(record,geometry,certificate,cell)` emits only the certified face, clips at cell borders, interpolates the exact affine endpoints, and reports source/profile provenance plus triangle/array budgets. It never mutates physics, accounting, publication identity or metadata. The eventual ordinary pack stage must recompute all authoritative budgets/hashes and run unchanged gates. No callsite is added yet.

`compileStructureBoundaries({sourceGraphSha256,nodes},proofs)` uses the same exact owner references to compile fixed profile heights for the experimental solver. Every sample is matched again to the original source graph coordinates by Python.

## Experimental three-level recipe

`experimental_structures.py` requires `experimental=True`, the exact Kifisias recipe ID, allowlisted bridge/support seeds, source graph hash and exact source-way versions. Unknown tunnels/review/access/layer policies fail. All source tags remain intact; `sourceLayer` and proposed physical0/1/2 are separate fields.

`source_graph` retains whole OSM ways and every consecutive source node segment. `full_approach_graph` expands connected roundabout ways and follows actual shared-node branches through degree-two tag boundaries until genuine junctions/dead-ends. There is no radius cutoff. A source crop fringe is unresolved until an exact `/node/ID/ways` response proves full adjacency against matching whole-way versions/refs/tags. Missing whole ways require separately pinned `/way/ID/full` records; moved nodes or stale versions fail. Source bundle hashes include every such proof. Finite cells are derived by segment/cell intersection, not by source vertices alone.

Profiles subdivide at geometric crossings without adding graph nodes/turns to the physical topology. Source-shared nodes remain shared connections. Every existing physical0/1 profile sample and every real approach boundary must have an exact certified height. The prototype solves only remaining new profile variables, with30° grade and existing0.5m slab +4.5m clearance constraints. Unsatisfiable approaches return residuals; no tolerances or gates are weakened. Returned heights are mathematical constraint bounds, **not surveyed elevations**.

Even a feasible scalar solution cannot pass `require_release_candidate`. All ordinary full-carriageway clearance, asphalt, ground/deck shoulder, approach, exact seam, solid rail150km/h, AI and tow guards remain explicitly pending. The current ordinary bridge audit supports only physical0/1; it is not silently reused as a three-level proof. A future reviewed full-width audit/packer/contact implementation and explicit final owner decision are required before any release can contain the stacked ring.

## Tests and evidence

`context.test.mjs` registers10 Node certificate regressions and two Python suites (7 source/context/ingest tests;10 experimental tests). Synthetic AWT fixtures produce the checked-in certificates. Negative controls cover authentication, wrong/ambiguous owners, gaps, inversion, clearance intrusion, omitted approaches, stale versions, cycles and one-level/release shortcuts. The original bridge policy and east/north plans have byte-hash controls. No synthetic diagram or certificate is presented as actual-game evidence.

The default-policy fixture pins bridge_policy.py, coastal.py and both existing structure plans to their exact original SHA. Only tiles.py has two explicitly approved baselines: `ad6813e043e9b5f3a295e31d67add779792b92ab54a56c8e0d6a924f7b06dd1f` (this isolated branch) and `f964afac853017eeced4df2d6633b9ca26f0e85b56da7f30cbb5f4920a1231ec` (parent-approved410 inland/cached-node integration). Every other tiles hash fails; both baselines must have no experimental solver import. This compatibility fixture does not certify the parent's terrain changes or activate context.

Road-boundary clearance is checked against the physical road union, including authenticated neighbouring cells at coincident tile edges. Shared internal diagonals/vertices/seams remain carriageway even across source-owner or layer tags; coplanar opposite faces cannot legalize a wall. Distinct-height decks get separate clearance checks. Missing neighbouring proof fails closed; a genuine exterior with both sides certified stays legal. The exact former diagonal negative control compiled2faces before the fix and now rejects, together with sloped/layered/shared-vertex/seam cases.

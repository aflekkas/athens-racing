# AWT runtime checkpoint — 2026-10-16

Lead wrap-up: dev-only/inactive. This is a milestone-1 foundation checkpoint, not completed player-facing streaming or driving acceptance.

## What is landed in this checkpoint

- AWT/1 draft v1.3 in `docs/world-tiles-format.md`; validator `src/world-tile-format.js`, bounded directory CLI `tools/validate-world-tiles.mjs`. Shared ASR1/ASR2 dispatcher reuses the existing codecs and checks output allocations before decoding.
- Ring/velocity streaming, one-hop building owners, byte reservations and disposal, spawn/tow pins, origin rebasing; worker-built contact CSR/bounds/GPU descriptors. GPU upload iterators use 32 KiB chunks with a 4 ms frame target and program/first-draw preparation. A synchronous driver call can exceed 4 ms; this is not a hard timing guarantee.
- `WorldTileRoads` installs/removes graph ownership with scene activation, handles directed GPS turns at partial route endpoints, canonical local road widths and contact/building-footprint checks. Its traffic advancement is an adapter probe, not the native traffic system. Graph installation/routing and anchor scans need further city-scale budgeting.
- Existing-map conversion and validators are inert offline helpers. The `ASR_WORLD_TILES=1` build hook and terrain coverage option are preserved ONLY in the unlanded patch. Neither terrain nor the deployment baker changes in this checkpoint.
- Standalone localhost viewer: `node tools/world-development.mjs .scratch/athens-world/development-world/glyfada/manifest.json 8795`, then open printed URL. T invokes validated tow. It uses the actual game car model, tile scene/worker/graph, GPS, and four traffic adapter probes. No native driving physics is enabled for the known-bad grade fixture.
- Generator commit `151b9c0522256cff7d5a59645afb03900071ca98` preserves the same Glyfada fixture in `.scratch/athens-world/development-world/glyfada/manifest.json`. The runtime validator passes on these committed files. Its separate one-cell Riviera fixture is not integrated or accepted by this checkpoint. Runtime sources and viewer do not copy fixtures into deploy assets.
- External packing/staging tools are inert helpers. They are not connected to the deployment build. Stage helper rejects developmentOnly:true or releaseReady:false.

## Player isolation

`src/main.js`, `src/map-world.js`, `src/baked-world-data.js`, terrain, deployment baker, service worker, deployment entry, release cache, Worker routing and their tests are unchanged from parent prod. No tile runtime is imported into the player entry point. Query streaming=1 alone does nothing on prod. Menu still constructs no tile streams/worlds.

`unlanded-player-integration.patch` preserves the previous experimental player integration, service-worker range-cache and asset-staging hook for review. DO NOT apply it wholesale: it retains legacy global metadata, misses acceptance targets, and needs current-prod rebasing and actor/teleport/fallback audit. The patch is data, not active code.

## Evidence and limits

- Corrected private fixture revision `9fb9370614c7b2b2ded2685274406cfb1d090aa1c656bc02e7d3ec3da6ac44d3`: 2,736,034 compressed bytes; 310 directed edges, 172 nodes, seven turn rules. Spawn uses generated Laodikis contact at [2324.1220092773438,16.312020070253602,13057.307189941406], yaw 2.9831650257110596. Never use legacy Riviera start height for generated city entry.
- Generator identified 203 asphalt micro-triangles over 30 degrees, 8.72 m² of 33,676 m². Exact shared seams/top identity does not imply driving conformance. No physical driving acceptance is claimed.
- Contact seam sweeps on all three converted maps: Riviera 608,622 samples/max 0.00004104 m; Penteli 986,943/max 0.00028670 m; Megara 232,163/max 0.00000957 m. All zero missing samples; Penteli natural road/shoulder transitions are separately reported up to 0.100045 m. These are migration experiment outputs, not new default map assets.
- `migration-experiment.json` contains ONE cold and ONE warm run per map/mode, not the required ten-run distributions. Compared against the c5765b8-era default worker generation, experimental resident data falls ~67% Riviera, ~47% Penteli, ~12% Megara; cold map transfer REGRESSES because it retains full input data plus tile payloads. Those player changes are unlanded.
- The real 20-minute stress attempt was stopped early on wrap-up order. It is NOT an acceptance result. Synthetic scheduler/teleport tests do not replace it.
- Earlier measured static build census: 1,445 files, 482,433,256 bytes, largest 20,971,520 bytes. Three converted maps have 442 individual tiles. Spatial packing experiment reduces these to 20 bundles + three manifests, all <=24 MiB. This does not yet justify R2. Final checkpoint build census is recorded separately after gates.
- Local Wrangler asset serving returned HTTP 200/full-file for Range, not 206. Packed public hosting remains unverified and must stay gated; individual immutable tiles currently fit the file-count limit. No new billing/hosting behavior is enabled.

## Exact next steps

1. Wait for generator's continuous global road-height fix; regenerate fixture; run structural, exact seam, graph/contact, max-grade and physical footprint audits. Keep developmentOnly:true/releaseReady:false until driving gates pass.
2. Re-run private viewer against corrected fixture, then connect a tile-only native ground/vehicle adapter. Current viewer checks data integration; it does not validate native handling, collisions, suspension or traffic AI.
3. Move city-scale graph install/routing, anchor indexing and physical width/footprint preparation off the main thread or budget their work. Account graph/JS allocations in residency caps, not only packed arrays.
4. Finish legacy tile-only metadata/scenery/DEM loading before enabling the player patch. Current migration cannot meet >=50% cold transfer reduction against worker generation. Retain reference visual quality and compare fixed-camera screenshots.
5. Rebase player integration on latest prod. Audit player, AI, traffic, police, multiplayer, replay/ghost and ALL reset/teleport paths for contact readiness. Add a settings-free fallback, retaining streaming=0 kill switch. Keep default off until all gates pass.
6. Capture >=10 cold/warm TTCC samples per map and actual startup transfer/resident bytes. Riviera/Penteli require >=50% less transfer and >=40% less residency; Megara <=10% regression.
7. Run actual 20-minute 250 km/h + teleport stress with native physics: zero missing-contact frames, no >50 ms main tasks, activation frame totals measured, memory plateau. Existing synthetic and short browser tests are insufficient.
8. Verify Cloudflare production static Range behavior before using bundles; otherwise publish individual hashed tiles while within 20k/25MiB caps. Wire immutable SW caching/asset bypass only after hosting verification. Recalculate file census and bytes/km² on final release.
9. Turn on the three legacy maps by default only after all acceptance gates. Generated Stage A / full Athens remains future work; no coast, structure or sign expansion is included here.

Schema commits already landed: 8a528da (initial), af89d7a (bounded validator), 7ede673/28039e2 (inactive foundations), 22ea363 (one-hop owners), c5765b8 (optional detail seeds). Runtime checkpoint SHA and six final gates will be reported separately.

Final archive rebased over 9c0cb33 World detail: its terrain shader changes and both new detail test entries are preserved. The migration measurements precede that concurrent visual change and are not current-prod acceptance results.

The owner detail-budget test fingerprints the terrain source. To preserve that lock and avoid new visual scope, this checkpoint leaves src/terrain.js and tools/bake-world.mjs byte-identical to prod; optional tileCoverage and the ASR_WORLD_TILES build hook remain only in the handoff patch. Existing v13 migration metrics used that unlanded offline option.

Lead landing hold started 2026-10-16 14:26:08 UTC: no prod ref update until interiors lands beyond 9c0cb33, or 20 minutes elapse. Rebase onto the resulting prod before landing.

Supplemental rebasing over generator 151b9c0: no owned source overlap; committed Glyfada fixture validates (2 tiles, 2,736,034 compressed bytes, 114,729 triangles). The producer pack tests, private server and road adapter tests pass together (18 tests).

Landing hold satisfied by interiors `5b633e4517df55a365f6b6102c3f371bdd476bcd` at 14:42 UTC. Rebased onto that commit with zero overlap in the gated runtime source files. All executable runtime source bytes still match archived candidate 0557bea; only documentation paths were updated. Combined producer/runtime/detail/cockpit checks pass (58 tests), and the private browser was repeated successfully with the new game car model. The generated audit-table scratch conflict was resolved by retaining the interiors owner version; it is not part of this commit.

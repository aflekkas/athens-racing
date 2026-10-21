# Penteli attached-region activation

2026-10-21. World-data half of unified-world Phase 4a. Penteli joins the existing Athens streamer as a disconnected region, selected from the same free-roam map. There are no connecting roads across the geographic gap. Route JSON, race logic and records migration remain the later route job.

## Datum and composition

The owner approved retaining source elevations without conversion: the basin is EGM2008; Penteli's EU-DEM v1.1 is EVRS2000. Both are recorded in the authenticated regional manifests and world-set metadata with zero vertical offset. Mixed datums require explicit empty external-portal declarations in both the release descriptor and source manifest. Duplicate cells and shared cell boundaries fail closed. Tests cover isolated mixed datums, connected regions, adjacent regions, absent isolation evidence, stale packet identities and changed manifests. Basin packet identities and the existing Psychiko enrichment are preserved.

## Geometry, contacts and bridges

The importer reprojects raw vertex positions before 512 m clipping, transforms normals with the inverse transpose, and transforms tangents and yaw. It reconstructs the directed graph, turns, real source-node-backed junctions, contacts, safe anchors, building colliders and swept rail collisions. Private and conditional OSM access remains restricted.

The existing conformance work is retained: collapsed faces below 1 mm altitude are removed and counted; pathological side-road fans intersect the actual source terrain planes. Side-road asphalt lift is 7.5 cm; town paving is lowered 10 cm to remove its old 24 cm outside step. Main Penteli carriageway heights are unchanged. No datum conversion, new steep exclusion or relaxed gate is used.

OSM bridge ways **124519741** (2392–2430 m) and **127528596** (5132–5144 m) have emitted layer-1 deck contacts and graph segments. Their flush terrain approaches and shoulders carry the same emitted terrain planes in the deck layer, retaining terrain material flags at gravel transitions. The common `world-bridge-audit` checks all three affected cells. There is **no drivable lower-road crossing in the imported geometry**, so vehicular underpass minimum clearance is not applicable; the audit reports zero obstructed crossings rather than inventing a riverbed or an underpass. The original concrete parapets remain visible with swept collisions. Layer-boundary contacts and ordinary seams are independently audited.

Degree-two graph chains retain every original sampled bend and grade while removing redundant nodes, edge records and turns. Render vertices are deduplicated after packing attributes, so identical packed vertices share storage. These reduce memory without changing the rendered near geometry.

## Scene ownership and visual acceptance

The shared authored builders supply all 16 mapped/repeater speed signs (including the four mapped signs), 161 direction/warning signs and 16 municipal bins. Their original procedural label recipes are reused. Meshes clip into cell ownership; props spanning a boundary have collision ownership on both sides. World detail Off hides the additions and disables their colliders.

The eleven existing regional silhouettes are owned jointly by resident Penteli cells. A small immutable background asset samples the source terrain planes at 32 m spacing and retains the authored landmark meshes. It fills distant hills and buildings while fine cells remain unchanged. A cell mask removes background geometry wherever fine cells are resident. Its CPU/GPU bytes count once in the 2×2 budget and are reserved from the existing streamer cap. It never supplies road contacts or terrain across the region gap. World detail Off removes the background and silhouettes.

Matched 1280×800 road-level WebPs and captions are in `/home/dev/data/agent-feed/penteli/`: village, both bridge ranges, hairpin, guardrail, chapel and upper road. The capture uses the production WorldSession, 64 MiB admission cap and the locked Lighting Off + Effects Off look. Static comparisons exclude traffic. The coverage map and machine-readable equivalence, tow, visual and release reports accompany the images.

## Gates and reproduction

The source lock includes 191 importer/runtime dependencies. Source changes require an explicit lock refresh and a new bake. The importer is single-process and stops at 83% shared disk use. Never delete `/home/dev/data/athens-world-cache`.

```sh
node tools/import-track-region.mjs --lock-sources
node tools/import-track-region.mjs "$task_tmp/bake" "$task_tmp/basin-declared.json"
# The import deliberately remains unpublishable until the real streamed tow proof:
node tools/accept-track-region.mjs "$task_tmp/bake"
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs tools/browser-slot.sh \
  node tools/penteli-region-capture.mjs "$task_tmp/bake" /home/dev/data/agent-feed/penteli before
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs tools/browser-slot.sh \
  node tools/penteli-region-capture.mjs "$task_tmp/bake" /home/dev/data/agent-feed/penteli after
```

The tow acceptance exercises thirty off-road recovery cases across fifteen stations with Corolla and Huracán physics, at the production low-memory cap including the regional asset reservation. It checks emitted contacts, full-footprint safety, swept barriers and props, and post-tow fall/launch behaviour.

`tools/publish-track-region.mjs` prepares immutable Penteli cells, the shared background asset, the truthful basin wrapper, an authenticated world set and the corresponding picker streets. It reads/writes **only `athens-racing-world-staging`**. Preparation does not upload. Upload and the staged manifest pointer follow all gates. No cells or credentials are committed.

Required checks run on a clean archive of the exact candidate: one full `flock /home/dev/.local/state/athens-release/agent-test.lock npm test`, physics regressions, browser imports and syntax. The final handoff records their results, measured budgets, R2 inventory, commit SHA and release-train confirmation. Production remains held.

## Measured activation candidate

Region revision: `c8d92e079ab88d8b7e294197fc2de7bbf65f81a9a268f1e32a87aadef15de5e2`.

| Gate | Result |
| --- | --- |
| Original route coverage | 5,241 / 5,241 asphalt samples; 21 route cells; maximum height error 1.203 cm |
| Asphalt / profile grade | 29.697° / 39.153%, below 30° / 45% |
| Shoulder step | 14.301 cm; full-route 262,050-sample audit 14.164 cm |
| Contact seams | 420 boundaries, 989,233 samples; maximum delta 1.541 cm; no missing contacts |
| Material / layer transitions | 14.604 cm / 0.001015 cm; all pass |
| Region ownership | 225 cells; 1,784 directed edges; 922 nodes; 1,088 accepted safe anchors |
| Visible rail collision | 1,271 swept segments, 2,599.894 m |
| Worst 2×2 including shared background | 58,923,057 bytes = 56.19 MiB; **7.81 MiB headroom** |
| Penteli compressed data including background | 26,508,939 bytes |
| Shared background reservation | 3,562,890 bytes; 1,019,828 compressed bytes; 7 far landmark meshes |

The existing Syntagma and Faros validation shard is freshly captured against the new composed revision from the unchanged, hash-verified basin cells. This keeps their rollout compatible with the attachment; no Penteli route definition or race behaviour is introduced.

World-set revision: `4e4c4622b97d2bea7056ad1d52bf48afb942db8e6b29bc124ebade7619b7b726`.
Staging manifest: `manifests/803754cf8aa7c04ceb9161d29061436292f6fe3f42fe13bf0d468de5f7e2d6a2.json`.
The combined world has **1,676 cells** and **413,459,797 compressed bytes**, including the regional background, below the 2 GiB ceiling.

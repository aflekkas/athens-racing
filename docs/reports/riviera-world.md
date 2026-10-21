# Riviera world-data extension

This release extends `athens-east-development` through the full original Riviera reference route. Race definitions and migration remain separate work.

## Extent and reproduction

`tools/world-gen/areas/riviera.json` extends `east` by 82 cells. The union contains 1,451 unique 512 m cells. `select-riviera.py` selects every cell intersecting the full reference polyline buffered by 768 m, including open water, scenery and junction context. The source solve retains complete roads and an additional 512 m margin.

The height, road, graph and cross-section caches are identical to the basin inputs. `verify-riviera-base.py` compares the normalized records in both directions and requires unchanged basin structure plans. The geometry rebuild includes all 120 original coast cells, all 82 new cells and nine existing shared-border cells. The 1,240 other immutable basin cells retain their geometry and graph IDs. `merge-cells.mjs` verifies their content hashes, applies the single candidate revision, and streams the complete union through the authoritative packer. Every cell is physically audited again, and every shared border is checked; there is no separate Riviera loader or contact overlay.

Use the supplied cache without modifying or deleting it. Task-local cache directories may symlink its read-only inputs. Generate profiles, graph, turns and sections with the existing tools and the Riviera area, then run the global structure planner. Before reusing the baseline:

```sh
python tools/world-gen/select-riviera.py --rebuild rebuild-cells.json
python tools/world-gen/verify-riviera-base.py CACHE rebuild-cells.json
ATHENS_WORKERS=3 ATHENS_KEEP_GOING=1 ATHENS_CELLS="$(cat rebuild-cells.env)" \
  node tools/world-gen/build-coast.mjs CACHE rebuilt riviera
CLOUDFLARE_ACCOUNT_ID=d6f3d2dc5817687a91d74ccd257bad9e \
  ATHENS_REUSE_MANIFEST=baseline-manifest.json \
  ATHENS_REBUILT_MANIFEST=rebuilt/cells/manifest.json \
  node tools/world-gen/build-coast.mjs CACHE union riviera
node tools/riviera-world-coverage.mjs union/cells/manifest.json coverage.json baseline-manifest.json
```

The baseline is the immutable staging manifest `fc9995d6150f1b98ec4732353ef2a0b4b11d864677c73130d27407aad3dab46b`, revision `23d19ec1592a6a337d9289d4f82161751875348be049a56e5042e87138416ca6`.

## Structures and safety

The two source-verified Loumbarda rock bores (`w25371523:0`, `w172988026:0`) keep their original source IDs, direction and layer −1. Their floors belong to the shared world partition. Clipped limestone shells and continuous swept collision walls are cell-owned. The rock envelope follows the native Riviera reconstruction. The generator sets the two-lane primary carriageway width to 7 m through its shared class model; the old isolated bore reconstruction used an estimated 8 m. Dimensions beyond the mapped OSM axes remain estimates, as documented in `tools/riviera-landmarks.md`. Physical/timing equivalence is not certified by this world-data change.

The bore audit samples emitted asphalt and roof triangles across the full carriageway, requires at least 4.5 m headroom, and checks continuous visible collision walls. The normal six-metre shoulder sweep crosses the explicit 0↔−1 portal layer transition while retaining the original 15 cm step and 30° slope limits. This does not grant a narrow shoulder or allow unrelated bridge layers to stand in for a missing floor.

Coastal steel rails use the native terrain-drop thresholds and mapped access openings, placed on the generated road/sidewalk edges. Hazard selection samples natural DEM/coast heights before shoulder conformance; otherwise the solve hides the very cliff drops that require protection. Rail heights come from the emitted surface. A focused safety pass changed 29 cells while preserving every graph and contact table byte. The existing Limanakia concrete barrier is reconstructed against the emitted surface. Both use the existing swept wall collision solver. The locked unlit rendering is preserved; World detail Off removes procedural surface detail while retaining essential road, rock and safety collision geometry.

Other unsupported structures remain excluded and counted, including the off-route Varkiza service underpass `w102221279:0`; the two coastal carriageways above it remain in the world. No road is flattened across that grade-separated crossing.

## Coverage interpretation

The complete reference is 10,988 m (5,495 samples at 2 m); nominal timing endpoints remain 241→10,548 m (10,307 m). The baseline contains 273/5,495 reference samples (4.97%) and 152/5,154 timed samples (2.95%), with 24 missing route cells.

The raw legacy polyline runs between divided carriageways and through the Loumbarda rock pier. Native gameplay already uses the mapped carriageway corridors in `src/maps/riviera-tunnels.js`. The coverage JSON therefore reports cell membership and actual asphalt hits separately, with per-kilometre measurements and explicit raw-polyline gaps. It does not certify a legal directed race route or silently add asphalt through the median/pier. The race author must select the matching real directed carriageways and verify timing equivalence.


Detailed evidence: [coverage and explicit gaps](riviera-world.coverage.json), [source/ID stability and exclusions](riviera-world.sources.json). Every one of the 25 reference cells has emitted asphalt; all 5,495 reference samples and all 5,154 timed samples belong to these drivable cells. There are zero cell gaps. The raw line has 1,043 samples without asphalt, in 22 ranges; these remain route-authoring work.

| Reference station (km) | Baseline cells | Extended drivable cells | Raw-line asphalt |
|---|---:|---:|---:|
| 0–1 | 54.6% | 100% | 66.8% |
| 1–2 | 0.0% | 100% | 100.0% |
| 2–3 | 0.0% | 100% | 100.0% |
| 3–4 | 0.0% | 100% | 100.0% |
| 4–5 | 0.0% | 100% | 87.4% |
| 5–6 | 0.0% | 100% | 43.6% |
| 6–7 | 0.0% | 100% | 29.4% |
| 7–8 | 0.0% | 100% | 82.8% |
| 8–9 | 0.0% | 100% | 100.0% |
| 9–10 | 0.0% | 100% | 81.4% |
| 10–10.988 | 0.0% | 100% | 100.0% |

## Release measurements

Candidate manifest: `manifests/b95388f8e64974305999d065a72fe8963d55f559a1bdf326ed10252b85ce28a5.json`, revision `74f4c8da82f6338c8642e808e0f3fcf4b3fdfba5a058b1501c521fa51b946957`.

- 1,451 physically audited cells; 6,320,394 asphalt triangles; zero above 30°. Maximum asphalt 27.023442°, profile grade 42.384293%, shoulder step 14.367863 cm and shoulder grade 29.886608°. All 347,075,425 shoulder samples have contacts.
- 44,378 bridge guard samples, 16,525 clearance samples, minimum bridge clearance 4.677188 m; zero unguarded edges, blocked crossings or unsafe anchors. The bore gate samples 246 full-width positions, minimum clearance 5.162173 m.
- 1,901 coastal protection segments (3,823.25 m) and 111 bore wall segments. The full exclusion inventory includes 14 pre-existing steep exclusions and no new steep exclusions.
- Complete compressed world 386,777,068 bytes (368.86 MiB; ceiling 2 GiB). Latest runtime graph memory is included: worst 2×2 30,407,222 bytes (29.00 MiB), maximum transient 20,571,359 bytes (19.62 MiB); both caps remain 64 MiB.
- Actual normal-physics local drive: 601.008 simulated seconds, 19,324.16 m, 149.72 km/h peak; both bores, three validated relocations and 1,603 reverse samples (25.17 km/h backward). Zero missing contacts, holds or automatic recoveries. Stream peak 65,166,025 bytes (62.15 MiB). This uses local cells on the shared VPS, not a network-throttled or physical low-end desktop benchmark. Activation p95 was 4.5 ms, above the plan's 3 ms target; maximum 7.8 ms, zero >50 ms tasks. The physical-desktop/network performance target is not certified here.
- The runtime fixture has 209 identical compressed cell hashes. Two cells differ only by one `-0`→`0` tow-anchor transform each after the NDJSON round trip: metadata and all numeric geometry/contact/graph values are identical. The authoritative complete-world pack, rather than the fixture, supplies every physical gate above.
- World detail Off sets the shared detail uniform to zero and disables props, trees, signs, marks, landmarks, plazas and lawns; essential geometry and safety contacts remain. Shadows remain disabled.
- R2 preflight: 1,936,394,512 bytes already staged; 387,252,532 bytes / 1,452 immutable objects to add; projected staging total 2,323,647,044 bytes, below 5 GB. Production remains held and its world manifest pointer remains unset.


The complete sampled contact seam check passes on 2,685 shared edges and 6,256,163 comparisons, with zero missing contacts and zero failures. Maximum like-surface height difference is 0.000061859 m. At diagonal bridge/approach corners, the epsilon samples can be on different floors; the auditor now binds each selected layer at the exact shared boundary and retains the same 2 cm limit. All 636 such samples have matching floors; missing or shifted layer counterparts fail regression tests. Ordinary same-layer curb transitions retain the 15 cm gate. The structural boundary-segment gate is unchanged. This changes validation only, not runtime contacts or geometry.

The legal directed graph has 184,080 public edges; its main strongly connected component contains 174,601 edges / 9,221.24 directed km (94.35%). Both original bore ways are in that component with tunnel flags and layer −1. Minor disconnected/spur components remain explicitly reported.

`assets/athens/streets.json` covers the same complete manifest. The existing Syntagma pilot validation shard is recaptured for the new world revision: its 88 edges, turns and every contact/width/safety proof are identical. No Riviera race definition or race logic is introduced.

Release gates run on a clean archive of the exact candidate: `flock /home/dev/.local/state/athens-release/agent-test.lock npm test`, the physics regression command, browser-import and syntax checks. Full seam/contact and directed connectivity evidence, final test results, R2 inventory and staging SHA are retained in `/home/dev/data/agent-feed/riviera-coast/`, alongside the five 1280×800 WebPs and captions. The staging pointer is committed only after the gates pass.

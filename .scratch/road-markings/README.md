## Summary (for the reviewer)
Road paint follows the actual asphalt instead of floating or disappearing between long triangle endpoints. Procedural yellow kerb paint now follows real junction approaches and mapped bus stops rather than ordinary graph splits and random midblock windows.

**Fixes / closes:** procedural marking defects associated with the owner's rough-road report. This does not close the separate geographic highway/bridge fidelity audit.

## Proof it works (required)
All final frames have loading opacity 0. Baseline runtime is `a117ed94`; candidate runtime is `9a50165c`, with the repaired Glyfada cell SHA `0755738973c38065af40edefc98f1600c1227db8387754fc11ea173e3343db59`.

| Scenario | Before | After |
|---|---|---|
| Glyfada: floating/disappearing white lines | [Before](glyfada-paint-before.jpg) | [After](glyfada-paint-after.jpg) |
| Glyfada: kerb context | [Before](glyfada-kerb-before.jpg) | [After](glyfada-kerb-after.jpg) |
| Vouliagmeni: arbitrary midblock yellow paint | [Before](vouliagmeni-kerb-before.jpg) | [After](vouliagmeni-kerb-after.jpg) |
| Glyfada: native driving | [Before](glyfada-drive-before.jpg) | [After](glyfada-drive-after.jpg) |

[Capture metrics and fixture identity checks](proof.json). The two earlier loading-fade captures were discarded.

Glyfada world metres: vehicle (2325.382, 16.617, 13057.061); projection origin latitude37.98/longitude23.73, x east/z south. Low performance class explicitly stored (`perfClass=low`, dynamic resolution Off), pixel ratio 0.8, 1280×800 Chromium/SwiftShader, the unchanged owner-locked graphics look. Paint camera target (2088,12955), eye offset(-12,+15,+18); kerb camera target(2325,13057), eye offset(-12,+24,+18).

## How I tested it (required)
- Clean exact candidate archive: 9a50165c3a64ade1e7bd0d09e925971d32238d1b.
- Focused Node checks18/18 passed; Python street regions22/22 and cross sections29/29 passed.
- Clean browser imports373 modules passed; syntax460 modules passed.
- `ASR_TEST_JOBS=2 npm test`: 300/300 files, 2,750 tests, 2,736 pass, 0 fail, 14 skipped, 0 flaky; 698.4 seconds.
- Separate physics regression: 1,323 passed, 0 failed.
- Both baseline and candidate ran 12 simulated seconds through the game's native 240 Hz substeps, scheduled streaming activation and sparse full renders. Baseline moved 63.565290 m and candidate 63.565291 m, each with 0 holds and 0 missing contacts. No place/goto/teleport during either drive.
- Successful candidate capture job: 0 page errors. Two disposable fixture identity failures were caught and corrected before the final proof; guards remained enabled.
- Not tested: High performance class, a fresh full OSM source bake, or real desktop-GPU frame rate. Parent owns combined-world/route publication and exhaustive terrain checks.
- Actual hosted cells4,25 and1,-1 reproduce long painted triangles75–85m across; sampled centroid errors reach -0.83m below or+0.475m above the road.

## How to try it (2 minutes)
1. Open Athens free roam at `?map=athens&spawn=2325,13057&cam=chase&quality=low`.
2. Drive through Glyfada and inspect road lines and kerbs.
3. Confirm paint follows the road, remains on asphalt, and junction/bus-stop paint remains while ordinary splits have no yellow patches.

## Checklist
- [x] Isolated task branch; private index commits based on HEAD; no push or deploy.
- [x] Matching clean own-game screenshots, actual native driving and focused regressions.
- [x] All four required gates passed on the clean exact candidate archive.
- [x] Per-cell geometry/byte costs recorded; existing physical and ownership guards retained.
- [x] Own game media only; no new third-party assets.
- [ ] Parent consolidates PROBLEMS/CHANGELOG, runs combined gates and publishes the coordinated world/routes. No combined/deployed-world claim here.

## Risk
- Offline repair increases marking triangle/array counts. The authoritative packer recalculates all bytes, hashes, reservations and render variants; unchanged physical gates remain mandatory.
- Rollback: revert the implementation commits and retain the prior immutable world manifest. Runtime yellow-paint changes require no world rebake; white-paint repairs require coordinated world publication.

<details>
<summary><b>How it was done</b></summary>

### Approach
Implementation commits: `0176638d6d7a603c877d1f127b0cea1856c8f9f6` (offline helper, future source generation and regressions), `8e7332b4395a250ff234714ef24a11e713ce3cd3` (shared position-domain draw chunks), and `9a50165c3a64ade1e7bd0d09e925971d32238d1b` (runtime kerb rules). Parent reported integration through `af5f745`; this report does not claim the parent's combined gate.

The source generator triangulated an entire solid paint ribbon, sampling only its corners. Offline repair clips each marking triangle against its same physical surface's actual rendered asphalt triangles, preserving existing locations and physical layer while clipping any part outside rendered asphalt. A separate source fix intersects paint with emitted surface planes before triangulation in future bakes. The runtime derivation had treated every graph endpoint as a junction and painted random windows; it now deduplicates directed neighbours to identify real junctions and checks the whole outer kerb edge.

The offline helper chooses support only when all original corners match the same position-buffer surface domain. Asphalt draw chunks/material partitions sharing that domain are combined; different deck buffers remain independent. Unknown or ambiguous surface ownership aborts. Contact, graph and layer tables are untouched. AWT mesh limits and existing index layouts remain unchanged.

### Tools and AI models used
Codex gpt-6.1-sol implemented and tested all changes with the Cogenly terminal, Node/Python, Chromium/Playwright through `tools/browser-slot.sh`. No generated or third-party media assets.

### Files changed and why
- `tools/world-gen/marking-surface.mjs`: offline same-surface clipping/draping and exact triangle accounting.
- `tools/world-gen/street_details.py`: exact emitted-plane splits for newly generated paint.
- `tools/world-gen/street_regions_test.py`: non-planar solid-ribbon interior regression.
- `src/world-tile-street-art.js`: actual junction qualification, highway exclusion and full outer-edge validation for kerb strips.
- `tools/athens-marks.test.mjs`: layer, gap, draw-chunk, resource and regulatory-location regressions.

### Tests and checks run
```text
WORLD_GEN_PYTHON=/tmp/athens-markings.MdRQ/venv/bin/python node --test --test-concurrency=1 tools/athens-marks.test.mjs tools/world-gen/road-model.test.mjs ->18 pass,0 fail
/tmp/athens-markings.MdRQ/venv/bin/python tools/world-gen/street_regions_test.py ->22 pass
/tmp/athens-markings.MdRQ/venv/bin/python tools/world-gen/road_section_test.py ->29 pass
node tools/check-browser-imports.mjs ->373 modules pass
node tools/check-syntax.mjs ->460 modules pass
ASR_TEST_JOBS=2 npm test ->300/300 files,2736 pass,0 fail,14 skip,0 flaky
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs ->1323 pass,0 fail
```
Three new runtime tests fail on the old derivation and pass after the fix. Independent repair of adjacent hosted cells1,-1/1,0 preserves exactly matching four shared paint-border vertices, zero mismatches.

### How the proof was captured
Task-local proxy serves local game source and unchanged authenticated hosted world assets. The candidate substitutes one independently repaired Glyfada cell packed through the authoritative packer. It is a local proof fixture, not a published world revision. No terrain changes in this comparison. Final capture waits for loading opacity 0 and requires physical throttle-driven displacement. The proof fixture keeps each immutable entry's original `source` identity and regenerates the basin descriptor hash and top canonical world-set revision. HTTP preflight runs both `loadWorldDefinition` and `fetchTilePacket`, preserving hash, revision, geometry and resident-budget guards.

The baseline/candidate camera transforms match exactly. The game uses `A.setDriver(...)` then `await A.advance(12,{renderEvery:10,paceMs:20})`, followed by `A.setDriver(null)`, pause and a full render. The first wall-clock-rAF driving attempt was rejected for no displacement; no image from it is acceptance proof.

### Performance
Repair-only Glyfada cell4,25: compressed367227→390268 bytes, arrays908558→1055978 bytes, total triangles37686→41196, mesh count7→7. Paint802→4312 triangles, area287.644→271.084m² (16.560m² outside emitted asphalt removed), maximum vertical correction0.928m. Authoritative repack resident reservation3446199 bytes, transient12139792 bytes.

Cell1,-1: compressed382550→436251 bytes, arrays939480→1145154 bytes, triangles44324→49221, meshes7→7. Paint867→5764 triangles,402.500m² preserved, maximum correction0.983m. Both retain one paint draw; no runtime repair added. These are per-cell mesh counts, not full-frame GPU timings. The raw capture's renderer `calls=1/triangles=1` counters are the final post quad and must not be presented as full-frame counts. Neutral repair/manhole and mapped bus-stop records remain. Runtime record counts on these two hosted inputs decrease795→426 and819→395 (without props inputs in the diagnostic derivation).

### Known limits and follow-ups
No raw OSM/DEM caches were available, so no full fresh source bake was performed. `coastal.py` still treats a `bridge=yes` way with no drivable lower road as unresolved/ordinary ground; rail/stream deck fidelity and source-measured approaches remain a separate policy/data task, not something this paint repair resolves. Use the helper once on canonical unrepaired source after all terrain edits, then run the authoritative packer. Parent/terrain own the world revision and publication. Full-world seam, resident and route-budget acceptance remains required for that publication.

The sampled Kifisias crossings are physically ordered correctly, with upper layer1 and underside clearance about5.5m. Source tags confirm these orders. The generator's generic6m ground depression may still be geographically wrong; no bridge-fidelity or highway-context completion claim is made. No bridge policy or terrain topology was broadened.

### Versioned crossing source audit supplied by route agent
Route agent reports all HTTP 200 from `api.openstreetmap.org`, read 2026-10-23. Its XML originals remain in its task directory `/tmp/athens-kifissia.O7Mn/kifisias-way-ID.xml`; source URLs and XML hashes belong to its forthcoming source-only audit commit. These facts were supplied by that agent, not independently fetched for this marking change.

- At world (6451.72, -6926.43), w26984266 v31 (2026-08-26) is `bridge=yes`, `layer=1`, primary Κηφισίας, one-way, two lanes. Lower w154259484 v46 and w154259480 v43 (both 2026-09-06) are motorway Αττική Οδός, three lanes, without explicit layer/bridge/tunnel/cutting/embankment tags.
- At (6224.83, -6984.31), w23200519 v13 (2024-06-06) is `bridge=yes`, `layer=1`, residential Διονύσου, two lanes. It is a nearby residential bridge; describing it as a motorway ramp was incorrect.
- At (5636.42, -5822.65), w32067820 v24 and w87150957 v26 (2026-08-26) are `bridge=yes`, `layer=1`, primary Κηφισίας, one-way, three/five lanes. Lower w98895975 v18 (2024-08-05) is secondary Ολυμπιονίκη Σπύρου Λούη, two lanes, one-way, without explicit layer/tunnel/cutting tags.

The tags support the emitted upper-bridge order. They do not establish a uniform six-metre lower-road depression. Actual reference verification of approaches and vertical profiles remains pending; no terrain or infrastructure policy change follows from this audit alone.

### Proposed tracker / changelog entries for parent consolidation
Fixed: Road markings are split onto exact rendered road planes and clipped to asphalt; procedural yellow kerb paint follows real junctions and mapped stops rather than arbitrary way splits/random windows. Same-surface bridge and draw-chunk ownership remains strict.

Remaining: Kifisias highway geographic profiles/context still need reference verification; audited crossings26984266/71 over154259480/484,23200519 over154259480,32067820/87150957 over98895975/98895980 show correct physical layer order. The fixed6m ground depression is not source-measured road elevation.

### Cleanup
Task temp directory `/tmp/athens-markings.MdRQ` (about 910 MiB: clean archive, minimal Python venv, proxy cache, proof fixture and logs) was removed after the report and final proof were retained. Removed the task's read-only node_modules symlink. The existing task worktree remains for parent integration; no worktree was created. No servers or browsers left running. Initial `df -h /`: `/dev/sda1 145G 63G 83G 44% /`. Final after task cleanup: `/dev/sda1 145G 74G 71G 51% /` (shared host; other agents remain active). Retained evidence: `.scratch/road-markings/`, 1.2 MiB, consisting of eight linked valid JPGs, this README and the reduced proof JSON. No large task artifact remains.
</details>

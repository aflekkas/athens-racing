# Reduced terrain refinement: implementation and game proof

> Continuation finding: the original binomial prototype would lower the Lycabettus peak sample by 25.84 m if applied globally. It is blocked from global baking/publication. This report verifies the reduced 27-cell candidate only; it does not establish whole-world geographic fidelity. See `hill-profile-proposed.json` and `docs/plans/terrain-ekali-world.md`.

## Summary (for the reviewer)
Generated ground, asphalt, contacts and graph heights now share an offline smooth terrain correction. The verified local candidate covers 27 cells around Syntagma, Glyfada and the authored Psychiko edge. It is not the all-world fix or a published release.

Implementation commit: `429b46f745fc651c6bf151d98574dfdc5ca3b863`, based on marking helper `8e7332b4395a250ff234714ef24a11e713ce3cd3`. Local world revision `ab10608899f7ac2f44fa4255604a24812f8760198809318a31a92cfc581ed8fc`.

**Fixes / closes:** reduced candidate for PROBLEMS items 4/5; parent consolidates documentation. Do not mark the whole issues resolved until complete-world verification and publication.

## Proof it works
Own-game captures, local authenticated hosted baseline versus derived candidate. Same requested spawn/camera for each pair; after hides driving tips via the actual setting. Baseline tips concatenation is a separate UI finding.

| Area | Before | After | Native drive |
|---|---|---|---|
| Syntagma | [before](syntagma-before.jpg) | [after](syntagma-after.jpg) | [81.40 m](syntagma-driven.jpg) |
| Glyfada | [before](glyfada-before.jpg) | [after](glyfada-after.jpg) | [82.13 m](glyfada-driven.jpg) |
| Agreed Psychiko correction location, requested 4250,-3100 | [before](psychiko-core-before.jpg) | [after](psychiko-core-after.jpg) | [81.14 m](psychiko-core-driven.jpg) |
| Chalandri edge of authored coverage, requested 4850,-3100 | [before](psychiko-before.jpg) | [after](psychiko-after.jpg) | [102.85 m](psychiko-driven.jpg) |

The edge captures are not core villa evidence. HUD district labels are proximity labels, not administrative boundaries. All JPGs are our own game screenshots, authored by this task; no third-party media.

## How I tested it
- Local build of 429b46, Chromium 1248, headless SwiftShader, 1280x800, chase camera; quality auto/default, not a physical GPU or measured Low/High comparison.
- Waited for actual loading opacity zero and 12 seconds settling. Used native `setDriver` throttle 0.25 and `await advance(12,{renderEvery:10,paceMs:20})`; no manual position assignment during driving.
- Four drives above: zero holds and missing contacts; maximum per-physics-step body-height changes respectively 1.946, 1.257, 3.312 and 2.714 mm. Accepted corrected pair had zero page errors. One earlier attempt to view unchanged crossing cells failed proxy fetch and produced no accepted crossing proof.
- All required clean archive gates passed; counts below.
- Not tested: whole-world derived cells, physical GPU frame times, all cars/modes, geographic bridge approach fidelity, final integration/release or online-grid proof.

## How to try it (2 minutes)
1. Use the local candidate manifest with same-origin proxies for unchanged immutable cell URLs; source cells remain authenticated against SHA/bytes. Do not publish this mixed local manifest directly.
2. Open `?map=athens&spawn=418,561&cam=chase` for Syntagma, `2325,13057` for Glyfada, or `4250,-3100` for the agreed correction location.
3. Wait until the loading overlay is gone, hide driving tips, drive forward and inspect road/ground continuity. The proof helper is in `proof-tools/capture-core.mjs` and requires `TERRAIN_PROOF_TEMP` plus the documented browser install.

## Risk
- Could break: seams at the unchanged/protected transition, newly steep curb fades, resampled dressing or content identities. Existing independent structure layers are protected, not repaired by smoothing.
- Rollback: parent reverts source commit and retains prior immutable world manifest. Nothing uploaded or deployed by this task.

## Checklist
- [x] Isolated task branch, private index, parent owns integration.
- [x] Own-game before/after proof and native driving.
- [x] Meaningful regression tests; all four required clean archive gates pass.
- [x] No third-party media committed.
- [ ] All-world coverage and protected-zone acceptance (continuation).
- [ ] Physical Low/High GPU performance, multiplayer/release binding and final route reproof.
- [ ] PROBLEMS/CHANGELOG consolidation by parent, as instructed.

<details>
<summary><b>How it was done (full detail)</b></summary>

### Root cause and approach
The available hosted generated terrain contains short-scale DSM relief propagated consistently into road surfaces. A global 8 m atlas applies a separable 9-tap binomial filter at 32 m spacing (128 m support), preserving affine grades and broad relief. A canonical global correction moves shared geometry only once and updates contact/graph/dressing positions consistently. Protected authored maps, structures, bores and water, and unselected cells, receive an explicit transition. Existing slope-dependent curb fade must be preserved when correction steepens a local slope. A first naive correction failed the unchanged shoulder step gate at 0.169 m; the fade-aware correction fixed that without changing tolerances.

The independent comfort gate measures midpoint departure from a 32 m chord, limit 0.5 m. On a horizontal bend it removes only the mathematically affine slope term. An invariant test preserves an affine hillside while a legal-grade roller coaster still fails. No eligible sample is null, never a pass.

### Tools and AI models
Codex gpt-6.1-sol implemented terrain/refinement/gates/tests and captured proof with Node, Python, Playwright/Chromium and repository browser-slot. The infrastructure Sol child supplied the offline marking helper. No AI image generation or third-party imagery.

### Files changed
- `tools/world-gen/terrain-relief.mjs`: global correction, protection, consistent resampling and curb-fade handling.
- `tools/world-gen/refine-terrain.mjs`: authenticate inputs, refine selected cells, invoke marking helper, authoritative packer and local manifest/report.
- `tools/world-terrain-smoothness.mjs`: independent city-road comfort audit.
- `tools/world-gen/terrain-relief.test.mjs`: 10 meaningful affine/roller-coaster/seam/protection/alignment/null regressions.
- `tools/test-groups.json`: register focused suite.
- `docs/world-terrain-refinement.md`: process, limitations and publication handoff.

### Exact clean archive gates
Archive of exact 429b46 candidate; test jobs=2, dependencies linked read-only from own installation.
```text
ASR_TEST_JOBS=2 npm test
  301/301 files; 2757 tests, 2743 pass, 0 fail, 14 skip, 0 flaky; 661.8 s
node --import ./tools/physics-test/register.mjs tools/physics-test/regress.mjs
  1323 pass, 0 fail
node tools/check-browser-imports.mjs
  373 modules pass
node tools/check-syntax.mjs
  460 modules pass
```
Full-mode original-world terrain fixtures remain queued behind other agents' gates; not included in the above counts.

### Reduced real-data acceptance
- All 27 emitted cells passed unchanged physical/road/bridge/bore gates; 7,258,433 shoulder samples.
- 26/26 eligible comfort passes; coast cell 3,26 has no eligible samples (null). Core max departures Syntagma 1.095458→0.243624 m, Glyfada 0.696613→0.143021 m, Psychiko 0.449075→0.154991 m. Protected/transition whole-cell metrics are separate and can exceed the comfort target.
- [contact-seams.json](contact-seams.json): 72 boundaries including 36 changed-to-unchanged, 169,878 contact samples, maximum delta 0.0000216781 m, zero missing/failures. Audit metadata world frame normalized only; geometry and tolerances unchanged.
- [graph-portals.json](graph-portals.json): 2,111 unique nodes, 270 shared portal copies bit-identical, zero conflicts.
- [authored-preservation.json](authored-preservation.json): Vas/Psychiko 3,647-piece recipe/hash unchanged; 825/825 expected pieces restored across six affected cells, remaining 2,822 in unchanged cells. No missing/duplicate owners. Dynamic original shells/roofs/furniture fit actual new terrain.
- [source-cells.json](source-cells.json): exact original compressed cell hashes and provenance.

### Performance and assets
[packet-budgets.json](packet-budgets.json): changed27 compressed 8,531,273→10,617,842 bytes; composed total455,972,174 bytes. Worst 2x2 resident30,407,222 bytes, below unchanged64MiB. Paint29,856→178,692 triangles; paint draw chunks27→29. Final source packet189 draws and1,118,559 triangles (not a frame count). Sampled agreed-location whole-frame baseline216draws/334,930tris versus candidate168/274,793; visibility/traffic differ, so this is not a performance improvement claim. No physical GPU frame times measured; no new textures.

### Infrastructure and geographic limits
[crossings.json](crossings.json) and [crossing-source-tags.json](crossing-source-tags.json) record three source/emitted layer-order samples. They match upper bridge tags and have approximately5.5m underside clearance, but do not prove the fixed6m lower depression is geographically correct. w23200519 is the residential Dionysou bridge, not a motorway ramp. Street View/profile audit remains pending. No accepted Kifisias crossing screenshot exists from this task. An omitted circular upper ramp/stacked topology needs separate policy evidence; smoothing does not resolve it.
Mitropoleos/Stadiou sampled Bezier footprint failures are not proven source/asphalt gaps; safe alternative turn tests are required before terrain attribution.

### Proposed parent documentation entries
PROBLEMS: “Implemented and verified a 27-cell local terrain/paint candidate around Syntagma, Glyfada and authored Psychiko coverage, preserving 3,647 authored pieces. Whole-world coverage, protected zones, geographic bridge approaches and final publication remain open.”
CHANGELOG after final publication only: “Smoothed generated road and ground relief together, preserved real broad hills and authored Psychiko detail, and aligned road paint to its asphalt surface.”

### Publication plan and cleanup
Candidate assets in `candidate/` are intentionally local derived data (~17MB), never Git. Recompile all route geometry/contact proofs and online-grid release binding/eight spaced poses for final terrain+Ekali world, regenerate recovery sidecars once, verify both buckets through parent staging/release process. This task performs no uploads/deploys.
Browser/server jobs fully closed; browser handed to infrastructure. Task temp `/tmp/athens-terrain.uKVC` retained for queued full-mode checks and read-use harness. Disk initially57GB/145GB(39%); continuation checkpoint74GB/145GB(52%), shared usage includes other agents. Final cleanup/disk outcome will be appended when continuation completes.

</details>


## Continuation: real Ekali source preparation (not acceptance)

Six actual generated cells now exist in local `ekali-source/` (world data intentionally not committed). [Preparation summary](ekali-first-chunk-summary.json) records the exact cell hashes, 6/6 ordinary physical pack passes and inland source/DEM evidence. The three route core cells plus the genuine Rodon corridor through the original northern boundary are emitted. Fourteen halo cells remain, as do full contact seams, playable route/grid/runout and browser proof. The first source candidate was rejected by the unchanged route compiler at a roundabout corridor; the route author is checking a legal alternative. No catalogue activation or publication.

[Graph diagnostic](ekali-portals-provisional.json): 21 internal shared portal copies are bit-identical; shared nodes with unchanged original neighbours16,-26 and17,-25 have no conflicts. Five original north-boundary portals, including both Rodon directions, retain exact XYZ. This is not asphalt/contact seam acceptance.

The explicit inland mode was necessary because a bounded inland OSM source cannot establish the legacy whole-Attica coastline polygon. It requires zero source coastline, complete source support and a complete valid DEM window above10m; actual window minimum246.31981m. Five mapped water masks/tags are retained; no invented sea-level inland-water surface. The default coastal branch still refuses a missing OSM mainland mask. Four positive/negative Python controls pass. Source generation uses the approved roof fallback model91795 and scenery source snapshotcf980; no generated infill was added.

Prototype quartic staging was rejected: [five-cell report](quartic-stage-rejected.json) has all5physical passes but Syntagma0.702829m and Lycabettus0.943687m fail the unchanged0.5m comfort target. Global terrain remains explicitly blocked. The source/math follow-up is bounded road-chord correction on the original geographic baseline, not an accepted field.

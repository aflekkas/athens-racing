# Ekali development source stage — no catalogue activation

## Summary (for the reviewer)

Ekali now has an authored 2.118 km public-street circuit recipe and a bounded
query proof from the actual 20-cell development source. Race and solo TT each
require two laps. This is a reviewable DEV stage; it is not accepted for release.

**Fixes / closes:** establishes source authoring and physical-query replay only.
Terrain comfort, final world/proof binding and actual game acceptance stay open.
The parent owns PROBLEMS/CHANGELOG consolidation.

## Proof it works (required)

No actual-game image or driving proof exists for this new route yet. No visual
or final acceptance claim is made. The committed proof is an offline emitted
query snapshot, not browser driving. A coordinated browser slot is required.

## How I tested it (required)

- **Played in:** not yet; no browser or server was started for this DEV stage.
- **What I did:** authenticated both terrain manifests; decoded the actual cells;
  mapped the reviewed 56 source traversals to 27 unique directed emitted edges;
  compiled the closed route and replayed its captured physical queries.
- **Result:** 2,118.060774 m runtime lap, three proven offline grid poses on
  Pefkon, exact graph-station run-in 80 m / runout 151 m, native footprint guards
  unchanged. Both offline EventRun replays require two continuous laps, finish
  validly and reject a shortcut. These are unit replays, not actual driving.
- **Automated checks:** `node --test --test-concurrency=1 tools/ekali-route.test.mjs`
  passed 9/9. Initial tests exposed the difference between graph station and
  sampled chord distance; station checks now test the actual compiler contract.
  A missing mutation-test import was corrected. No guard or tolerance changed.
- **Not tested:** actual player/rival driving, TT UI, tow/rejoin, free roam,
  online eight-slot/full-garage grid, route-specific comfort, current Street View
  character, actual-game CSR fix proof or final clean-candidate gates.

## How to try it (2 minutes)

1. Inspect `.scratch/kifissia-kefalari/ekali-development/ekali-circuit.route.json` and the source/proof receipts
   beside this README. Ekali is outside production route discovery and absent
   from both enabled catalogue lists.
2. Run the focused command above. It uses this standalone DEV snapshot and does
   not add a fourth root sibling or change global source bindings.
3. With the authenticated development manifest/cache, replay authoring using
   `node tools/author-ekali-route.mjs WORLD_JSON CELL_BASE EMPTY_OUTPUT_DIRECTORY`.
   It refuses missing physical cells or failed guards; final terrain changes
   require regenerated inputs, not a manually changed geometry hash.

## Risk

- **Could break:** the development terrain has unresolved comfort defects in
  19/20 cells. Final height correction changes contact/route identities and
  requires fresh proofs. Actual route comfort has not been isolated yet.
- **Rollback:** revert this DEV stage. No catalogue was enabled or world uploaded.

<details>
<summary><b>How it was done (full detail)</b></summary>

### Approach

The initial source search tried an illegal reverse roundabout traversal; it was
rejected and replaced with the legal forward arc. Both the initial legal loop
and an alternative then exposed the runtime CSR bin omission. Fix `5f1b60e4`
restored complete width queries without changing road geometry or any guard.
The original legal route compiled after the missing physical halo was emitted.

The timing line is 120 graph metres into
`osm:way:44130952:0-0:b:18:-29` on Pefkon. Its 296.556 m directed edge contains
the timing/grid approach and runout. The 151 graph-metre runout's exported
4 m/contact-conformed sample chord sums to **150.988342657 m**; run-in chord is
80.000181824 m. The tests retain exact graph station checks. This is not a claim
of a separately proven 151 m physical chord or final runout/game acceptance.

### Production discovery isolation

Review found that `prepare-deploy.mjs` builds and validates every discovered
`data/routes/*.route.json` before applying the release allowlist. Merely leaving
Ekali disabled was insufficient. The DEV recipe now lives beside this README;
the author refuses output under `data/routes`. Global build selection is unchanged.

`production-inputs-before-after.json` compares all seven production definitions
with pre-DEV commit `2a436b849ee7737274601619364746e26da5532c`: names and bytes
are identical. The moved recipe is byte-identical to actual author output,
SHA-256 `902eab21a9ffacf3540c73fe5c9a56a7bc6823173f406f4c653432085294f5fc`.
Actual `validateRoutes` discovery passed all seven against the existing source
world and root query proof; `production-validation.json` records this bounded
isolation check. It does not prove final-world regeneration or a full build.

### Tools and AI models used

Codex gpt-6.1-sol: authored the replay tool, recipe, regressions and report.
Cogenly terminal tools: bounded source reads, native compiler and unit tests.
Terrain agent: authenticated OSM/DEM, actual source packing, seam/portal proof;
its source record identifies its own implementation. No generated artwork or
third-party imagery is committed. OSM-derived data is ODbL 1.0; see SOURCES.md.

### Files changed and why

- `tools/author-ekali-route.mjs`: exact reviewed part/direction replay with bounded
  ambiguity/disconnection guards; emits a recipe and <=8 MiB physical-query proof
  only after native compilation succeeds.
- `tools/ekali-route.test.mjs`: source direction/closure/ambiguity regressions and
  actual DEV query replay, grid/runout/event/shortcut/cap/disabled-state checks;
  production discovery and author-output isolation regression.
- `.scratch/kifissia-kefalari/ekali-development/ekali-circuit.route.json`: basin/athens recipe, race/TT, two laps,
  no reverse. No legacy loader or hardcoded runtime dispatch.
- `tools/maps/ekali/SOURCES.md`: source, rejected candidates and DEV tuple.
- This directory: standalone bounded DEV query proof, four-cell world subset,
  provenance receipt and test record. It is not an active root-index sibling.
- `docs/reports/ekali-route.md`: short integration/limits record.

### Tests and checks run

```text
node --test --test-concurrency=1 tools/ekali-route.test.mjs → 9 pass, 0 fail
production validateRoutes against existing source world/root proof → 7 pass, 0 fail
production definitions vs pre-DEV baseline → 7/7 byte-identical
native compile against actual complete20 source → PASS
readRouteInputs + compileRoute query replay → PASS, same geometry/route hashes
race and TT offline continuous two-lap/shortcut checks → PASS
combined north capture → 1,774,970 B, three existing siblings, root union82cells
```

Full npm/physics/import/syntax gates for this DEV stage were not run during the
shared queues. The earlier exact `538b9a59` stage's four green gates do not cover
this new recipe/tool/fixture or later width fix. Parent unions the new unit
manifest entry and performs final exact-candidate verification after integration.

### Source and immutable identity

Source world `athens-ekali-development`, revision
`12935f07f7dceacdfbf96d7a9de8fa10ae88f49fcf673fb08c6c8dfe5cb0cc31`.
Twenty-cell manifest SHA-256
`41da1ae7e99346363d58582b8a2f69259e12b38515d13a8bd85811ffe3807167`.
Development composed world revision
`358325da4b458b4b15c2f419aed0c204da91e714f4a011991cbecbdb23d2e3a8`,
manifest SHA-256
`4f1f69bd05b9a8c38747c12df5563f06387f43a197118698ee2a854a33cf043c`.
Both were independently hash-verified before authoring.

Native geometry hash
`5303e77f5e67e9245cb949da3828e138c31420247034c436a6cd7a03e128523c`;
pre-rival route hash
`8e469579175af6601b3dc376c07ea44502fd443db5acaad5766fb0c7851919f7`.
The source-bound rival plan and final world will require a rebuilt route tuple.
The committed proof is 752,316 bytes, SHA-256
`49f89ebf96530a4050206d052002c133f9b67c08961757838de12951dee87d36`.

| Physical query cell | Compressed SHA-256 |
|---|---|
| 17,-29 | 0ebfb1666e5086b0f9fef51a3300ea8bbac5af26d85610ff82f6c105815d8e50 |
| 17,-30 | 182cb746248360e7ae1503a825236d77adb305ad18edaf55aab70d2dfea4c972 |
| 18,-29 | 1eacbe80257859f5c178ad7adf51861e0f67ba0a814ae89cbba0aa04571b258b |
| 18,-30 | 48e419fe1d8eab16185f548c733a227bf5177854da54f075980ec975fb77b152 |

A fresh combined Kifissia+Ekali regional proof was measured at 1,774,970 bytes,
SHA-256 `0ac9b68a6757ec1774bab9d84e12a4ea0863b797b7d8bbe843084a8af8ba51ca`.
It can replace the existing regional sibling with three siblings total and
82 root cells, within unchanged 8 MiB/128-cell limits. The active root and old
siblings were **not** rebound to this provisional world. All final route queries
must be recaptured on the final world; no fourth sibling/cap exception is added.
The old seven Kifissia source cells remain byte-identical. Its new width lookup
changes its automatically computed geometry hash, without a hand mutation.

### Performance and cleanup

Bounded author/capture runs completed in seconds, with no browser/heavy suite.
The DEV proof is 0.75 MB; actual immutable cell bodies are read from terrain's
shared source, never copied or committed. Existing source cells and small logs
remain in the one shared task temp pending loader/terrain release. No process
was left running; no upload or deployment occurred.

### Known limits and follow-ups

Terrain comfort, final world and regional-root proof regeneration, catalogue /
spawn integration, all three cars/rival two-lap driving, TT, tow/rejoin, free roam,
Street View character and actual-game width proof remain open. No current
geographic or complete streetscape fidelity is claimed by a legal source loop.

</details>

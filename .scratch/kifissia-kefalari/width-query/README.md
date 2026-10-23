# Exact contact-bin traversal — focused source proof, browser proof pending

Codex gpt-6.1-sol reproduced false road-width truncation on actual authenticated
Ekali contact triangles. `WorldTileRoads.width()` sampled contact CSR bins at
4 m ray intervals. An oblique ray can cross a short corner of a 16 m bin
between samples, omitting physical triangles and breaking its merged interval.

Fix `5f1b60e4a550fd60de8f8fb900d63b310940661a` visits each exact grid-crossing
interval using an interior sample, plus the original radius endpoints. All
radius/API/height/layer/surface/access/merge/contiguity and footprint guards
remain unchanged. It does not widen roads or scan all triangles.

[oracle.json](oracle.json) compares the same existing width code and physical
triangles with fixed-distance versus complete-bin enumeration. It is a bounded
offline source diagnostic, not a screenshot or actual-game acceptance.

| Actual source point | Original width | Complete-bin width | Omitted global bins |
|---|---:|---:|---|
| Dekeleias, world 9425.272334,-14624.030665 | 2.475145 m | 4.805833 m | 589,-914 |
| Roundabout, world 9567.782159,-14862.560409 | 2.480012 m | 5.801593 m | 597,-928 and 598,-929 |

Source world `athens-ekali-development`, revision
`12935f07f7dceacdfbf96d7a9de8fa10ae88f49fcf673fb08c6c8dfe5cb0cc31`.
The decoded cells were authenticated by compressed hash, byte size and AWT
identity from terrain's read-only six-cell source manifest. The provisional
Athens composed revision was
`d7d206db358bc6ff0e143b42846f97f1f8084fecb2158e53f74c7b4f723260e7`.
It is development-only and not accepted as the final world.

Focused verification:

- New `tools/world-tile-road-width.test.mjs`: 4 passed, zero failed.
- The same four tests using the old `538b9a59` road module: 1 passed, 3 failed,
  exit 1 (the required negative control).
- New plus existing `tools/world-tile-roads.test.mjs`: 20 passed, zero failed.
- Covered oblique/corner crossings, negative coordinates, reverse heading,
  surface/layer/height/access/disjoint-interval guards and radius bounds.
- Actual provisional Ekali compiler, unchanged physical guards: the original
  legal route now passes its corridor, Pefkon timing pose and 80 m run-in /
  151 m footprint runout checks, then fails closed on missing neighborhood
  cell `17,-30`. Grid and complete route acceptance remain outstanding.

No game browser proof, hardware timing, final route-proofs regeneration or
full exact-candidate gates for this fix are claimed here. The independent
corrected Kifissia `538b9a59` archive predates this fix. The parent must rebuild
and compare final per-point width proofs and immutable route/world bindings;
no geometry hash is changed manually. A coordinated actual-game before/after
and final clean-candidate gates remain required.

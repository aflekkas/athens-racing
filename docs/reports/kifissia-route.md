# Kifissia / Kefalari street circuit

The new `kifissia-kefalari` compiled route uses existing authenticated north-basin
AWT roads. Its 2,926.566598 m lap follows connected, legal directed OSM streets
through Kifissia and Kefalari; both `kifissia-race` (two rivals) and `kifissia-tt`
(solo) run two laps. There is no reverse event. The picker and server consume
the same catalogue entry and immutable world/route/geometry tuple. No legacy
map or loader is added. Kefalari is also a named free-roam spawn area; free roam
keeps the entire hosted street network and omits race paint/marks.

The authored definition has 52 directed entries (51 distinct edges); physical
surface changes split them into 108 compiled occurrences. The start is on
Kokkinara east of Levidou. The compiler proves 80 m of run-in, three single-file
grid footprints and 151 m of runout using unchanged safety limits. Two rejected
Levidou start candidates and the legal southern return choice are documented
in [the source record](../../tools/maps/kifissia/SOURCES.md).

## Source and competitive identity

World manifest key:
`manifests/55d13b9a8643363d7cf1a9390fd1994869ff8326c16e61d42bb7c278f2cfb74b.json`.
World revision:
`80055f9208753e2d6fa8658b31c90216d22c650f7f33588ebd5178d1a6b804a1`.
Geometry hash:
`f9e1706f256aced54226817d634322d560d8f7d8a0d12c8574b152db85980f6f`.
The route hash also binds the source-hashed rival racing plan and therefore
changes when the combined implementation's browser source changes. The exact
built tuple belongs in the acceptance evidence for that candidate.

The new route has no historical aliases and shares no leaderboard/ghost edition
with an existing track. Race and TT keep distinct event/record IDs. The source
proof is the third sibling within the existing maximum of three, about 1.02 MB;
all files remain under the unchanged 8 MiB per-file cap. Root source identities
include the new seven cells, while old proofs and their geometry remain intact.

Only 2,031,067 compressed bytes of immutable source cells contribute route
proofs. Source hashes, legal street decisions, inspected Google viewpoints and
image dates are recorded in `tools/maps/kifissia/SOURCES.md`. Google was used as
visual reference, never as committed media or world geometry. Existing OSM
procedural scenery supplies sidewalks, buildings and vegetation. This route
change does not certify exact current paint, fences or every building facade.

## Wider fidelity audit sent to the master

The Kifisias structural-source plan supplies concrete crossing audit leads at
38.042113, 23.803505 (group `w26984266:0`, lower `w154259480:0` and
`w154259484:0`), nearby Dionysou bridge 38.042831, 23.801010 (`w23200519:0`), and
38.032288, 23.794236 (`w32067820:0`, lower `w361263590:0`, `w361263594:0`,
`w98895975:0`, `w98895980:0`). These are source-plan facts from
`tools/world-gen/areas/north.structures.json`, not a claim that every rendered
crossing is correct. The infrastructure/terrain agents own policy, physical
layers and shared marking corrections. This branch does not patch those files.

The custom landmark registry (`src/athens-landmark-data.js`) has no named
Ellinikon/Riviera Tower. A bounded inspection of the actual authenticated cell
`-1,21`, however, found `building:w1480412293:0`: a seven-corner OSM-derived
footprint with base 4.610027 m and height 160 m, centroid approximately
`[-289.168429,10814.121]` in Athens world metres. That is about 16 m from the
published nominal tower position 37.882775, 23.7268556. The nearest other building
in the same cell is about 230 m away. This supports presence as a generic tall
block near the tower site; metadata alone does not establish its exact visual
appearance or today's construction state.

That cell is 144,848 compressed bytes, SHA-256
`13ebbb53967d5fe7919e2c9d1f128298725d8feee757e619e18f0e134efe6e19`, in
the same composed world/source revision above. Its metadata supplies no
per-feature extraction timestamp. A read-only current OSM API request for way
1480412293 returned HTTP 429, so no current source tags/date were inferred.
The repository generator documentation names a pinned 2026-10-14 source, which
does not by itself date this particular emitted footprint.

[The developer's project page](https://theellinikon.com.gr/en/our-news/progress-of-works/riviera-tower-green-skyscraper)
identifies the Riviera Tower project. Its construction-floor language is not
reliable evidence of the current stage. The developer's
[2026-08-11 announcement](https://www.prnewswire.com/news-releases/the-ellinikon-sports-park-opens-to-all-as-europes-largest-urban-regeneration-project-accelerates-toward-completion-302847868.html)
says it was reaching its final height. Neither source is used here to claim
completion or occupancy. No tower-specific art or world-cell publication occurs
in this branch.

## Validation

`tools/kifissia-route.test.mjs` replays the authentic bounded proof, verifies the
unchanged sibling/byte caps (and rejects a fourth sibling), checks the connected
closed circuit, three grids and full runouts, requires two continuous laps in
race and TT, rejects shortcut completion, and verifies catalogue/server/record
and free-roam guidance behavior. Exact clean-candidate gates, browser driving,
proof images, performance and remaining limits are recorded with the acceptance
artifacts under [`.scratch/kifissia-kefalari/`](../../.scratch/kifissia-kefalari/README.md). The native race field and solo TT both completed two continuous laps with zero crashes, streaming holds or missing contacts. The existing scenery remains visibly too barren for leafy Kefalari; a separate shared vegetation/material pass is required.

## Free-roam proof location correction

The direct-coordinate free-roam harness requested `8059,-10553` and initially
settled at `8093.714356,-10549.748651` on Artemidos, way 32084542, not the
inspected 44 Deligianni viewpoint. Its throttle/no-race-props proof remains
valid at the recorded snapped location. It does not prove an exact paired
Deligianni scenery comparison or menu selection of the named-area anchor.
The source record now includes the greenery agent's audited 10 generated/17
mapped bodies within 80 m, generic height/roof handling limits, and the need
for coordinated infill/physical reproof. No geometry changed in this correction.

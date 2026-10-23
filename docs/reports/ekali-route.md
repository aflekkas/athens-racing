# Ekali development route stage

`ekali-circuit` is an authored, disabled basin/athens circuit recipe. Its legal
56-source-segment loop follows Fasideri, Dekeleias, Pefkon, the forward Parnithos
roundabout and nearby public residential streets. Actual emitted compilation
maps it to 27 unique directed edges and a 2,118.060774 m lap. Race and solo TT
both require two laps; reverse is unavailable.

The recipe lives in `.scratch/kifissia-kefalari/ekali-development/`, outside
production discovery. Release filtering occurs after validation, so a disabled
catalogue entry alone would not isolate it. Author output under `data/routes`
is rejected. All seven existing production definitions remain byte-identical
to the pre-DEV stage and pass the existing-world source validator (7/7).
Global build selection is unchanged.

The complete 20-cell development source passes native compilation, three offline
grid footprints, exact graph-station 80 m run-in / 151 m runout, and bounded
query replay. The exported runout sample chord is 150.988342657 m; this is not
final physical runout acceptance. Offline race/TT tests finish only after two
continuous laps and reject shortcuts. They are not actual driving.

The 752,316-byte standalone DEV query fixture is not added as a fourth root
sibling. A fresh combined Kifissia+Ekali proof measures 1,774,970 bytes and would
keep three siblings / 82 root cells under unchanged limits. Final root binding
and all-route query regeneration wait for the final world.

Terrain comfort defects remain in 19/20 source cells, not yet isolated to this
route. Final height changes require contact/identity reproof. No enabled
catalogue, free-roam spawn, online grid, actual-game acceptance, full-stage gates,
world publication or deployment is included here.

Exact source/proof hashes, files, tests, limitations and the DEV-stage review
record are in [the acceptance record](../../.scratch/kifissia-kefalari/ekali-development/README.md).
Source licence, OSM/DEM lineage and rejected proposals are in
[the source audit](../../tools/maps/ekali/SOURCES.md).

# Penteli route races — Phase 4a

Penteli remains an attached destination on the one Athens streamer. No invented
connector joins it to the basin. `penteli-hill` carries `penteli-race` (two rivals)
and `penteli-tt` (solo); `penteli-descent` carries the old solo descent TT. Traffic,
police and signals default off. The existing shared route picker exposes each
event, marks the attached destination, and keeps separate saved setups. Each
route is independently staging-flagged; production route flags remain off.

Both directed sequences contain 265 emitted main-road edges. Original source
stations 292 and 10,188 transform to the same nominal timing endpoints. The
contact-conformed 3D course is 9,920.158980 m instead of 9,896 m (+24.158980 m,
+0.244129%). Equivalence is not claimed. The descent uses actual legal reverse
edges in its own forward runtime, including both OSM bridges, not an uphill
polyline with a negative progress direction.

Old `33ed3ce1` Penteli race/TT records bind only to reviewed concrete events and
matching endpoint/direction metadata. Unknown versions and custom segments do
not acquire aliases. Originals and all setup fields remain intact. JSON,
SQLite, PB and ghost history stay separate from the new world-lanes edition;
SQLite advances the migration marker so already-cut-over databases import the
new Penteli aliases. The shared historical label is “Original Penteli road”.

The existing immutable import omitted bridge flags and used a generic graph
surface on the two layer-1 decks. A decoder compatibility adapter now requires
Penteli metadata, an authenticated OSM bridge declaration, layer-1 asphalt at
every segment midpoint, and matching height within 2.5 cm before assigning the
bridge flag and contact surface. Other layer, access, node and turn checks stay
strict. No cells, importer source locks or secrets change.

The region proof is a separate bounded sibling shard. Every source hash is
verified against the active manifest; a changed query or duplicate graph id
fails closed. See `data/routes/validation/README.md` for reproduction. The route
author, safety audit and browser acceptance scripts are included in `tools/`.

Acceptance artifacts, actual counts, timing targets and deployment status are
recorded in `/home/dev/data/agent-feed/unified-world/phase4a-report.txt` and its
adjacent JSON/WebP evidence. The safety proof covers 6,264 emitted rail sweeps
with native Vehicle instances at 150 km/h, 60 native tow-and-settle cases, 105
contact boundaries and 312,455 seam samples. The maximum tow height error is
8.854 mm and vertical speed 0.426 m/s. These are independent current-cell checks;
the original full-region import and scenery handoffs remain their own evidence.

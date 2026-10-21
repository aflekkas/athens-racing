# Megara route race — Phase 4b

`megara-club` uses the 51 permitted, clockwise directed edges of imported raceway
way 70043234 in the attached Megara region. Both original events remain three
laps: `megara-race` has two rivals and `megara-tt` is solo. Traffic, police and
signals default off. Reverse has no event and is disabled pending a separately
reviewed legal compilation. The start/finish is the original circuit point; the
contact-conformed lap is 1,999.630570 m, 0.030771 m longer than the original
1,999.599799 m. The old record edition remains separate.

The circuit uses the same Athens world release and `WorldTileStream` as the
basin, Riviera, Faros and Penteli. Its proof is the bounded emitted-graph and
contact shard `data/routes/validation/megara.inputs.json`. The root proof binds
the two raceway cells and their hashes to the active composed world revision.
The importer emitted a generic graph surface for the raceway, while its
authenticated wheel contacts use three Megara asphalt labels; the route
compiler and road footprint checks accept only those labels for the exact
permitted raceway edge identity. No world cells or importer locks change here.

The original `1621ff83` Megara race/TT records bind to this route only with
three clockwise laps and the original full-course endpoints. Unknown versions,
reverse/custom segments and fixture or unsubmitted backend records stay out of
history. Versionless local PBs require the concrete original setup; old event
counters require their exact Megara storage key. Original records and setup
fields remain intact. JSON, SQLite, PB and ghost history use the label
“Original Megara circuit”; SQLite migration marker 5 imports rows for databases
that already ran the earlier route migrations.

The staging flag is `megara-club`, independent of the other five route flags.
Production's route catalogue remains disabled. `?routes=1&map=megara` resolves
to the route, as do the other three old map names. Free roam keeps the existing
Megara region without race timing paint; the route guidance layer draws only
during a race. The previous region handoff records the tyre collision, runoff,
contact seam and physics parity measurements at
`/home/dev/data/agent-feed/megara/README.md`.

Reproduce the route and proof from a temporary directory of authenticated
emitted cells:

```sh
node tools/author-megara-route.mjs WORLD CELLS OUT
node tools/validate-routes.mjs --world WORLD --graph data/routes/validation/athens.inputs.json --routes data/routes --report REPORT
```

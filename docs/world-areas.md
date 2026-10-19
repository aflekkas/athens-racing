# Streamed Athens: areas, structures and what a bake decides

Everything here is behind the `?map=athens` dev flag. The generator lives in `tools/world-gen/`; cells are hosted in R2 (staging bucket only), never in Git.

## Areas: one world per bake

An **area** (`tools/world-gen/areas/<name>.json`) lists the 512 m cells one bake covers. Areas can `extend` earlier ones, and the **union is baked as one world**, so every border between the old and the new cells is shared, checked and exact:

| area | cells | what |
|---|---|---|
| `coast` | 120 | Glyfada to the Riviera (x 0..9, z 25..36) |
| `piraeus-faliro` | 289 | the coast plus 127 land cells and 44 sea-ring cells: the Alimos/Elliniko strip, Faliro, Neo Faliro, Tavros, Moschato and the Piraeus peninsula |
| `centre` | 336 | Piraeus/Faliro plus 47 inland cells: the historic centre (Syntagma, Omonia, Plaka/Monastiraki, Exarchia south, Kolonaki, Pangrati west), Koukaki, Nea Smyrni and Kallithea east, joined to the Faliro network by a Syngrou corridor. Sized to the 192 MiB world ceiling; `centre-candidates` lists the 161 cells the district boxes asked for |

`tools/world-gen/select-area.py CACHE OUT.json` picks the cells deterministically from the cleaned OSM cache: a cell is wanted if it has roads or buildings, touches the mainland land mask and is within **1.2 km** (strip, south of row 13) or **1.5 km** (core, rows 7..12) of the coastline, plus the ring of sea cells around them so the shore and open water are baked. The selector's parameters are stored in the area file.

Every cell of an area is a contact cell. Nothing is a "dependency" any more (see below), so a cell is safe to drive on with only its own data.

### Source data for an area

Stage A (`profiles-a.sqlite` and friends) already covered Glyfada to Faliro. Piraeus is outside it, so the area's own caches extend the stage mask by the area's cells plus a one-cell road margin:

```sh
CACHE=/home/dev/data/athens-world-cache
PY=$CACHE/venv/bin/python; W=tools/world-gen
$PY $W/select-area.py $CACHE $W/areas/piraeus-faliro.json          # once; the file is committed (edit `extends`, `world`, `sources` by hand)
$PY $W/profiles.py $CACHE/clean.sqlite $CACHE/profiles-ap.sqlite --stage a_south --dem $CACHE/attica-n37-e023.tif $CACHE/attica-n38-e023.tif --area $W/areas/piraeus-faliro.json
$PY $W/graph.py    $CACHE/profiles-ap.sqlite $CACHE/graph-ap.sqlite
$PY $W/turns.py    $CACHE/source.sqlite $CACHE/graph-ap.sqlite $CACHE/turns-ap.sqlite
$PY $W/sections.py $CACHE/profiles-ap.sqlite $CACHE/source.sqlite $CACHE/sidewalks.sqlite $CACHE/sections-ap.sqlite
$PY $W/plan-structures.py $CACHE piraeus-faliro                     # writes areas/piraeus-faliro.structures.json (see below)
ATHENS_WORKERS=6 node $W/build-coast.mjs $CACHE <output-dir> piraeus-faliro
```

Heights agree with stage A on every road in the Glyfada..Riviera cells; only 13 roads at the old northern edge of stage A change (they are now solved with their context).

`build-coast.mjs CACHE OUT [AREA]` runs the generator in `ATHENS_WORKERS` processes (output order is kept, results are bit-identical to one process) and the packer gates every cell and every border. `ATHENS_KEEP_GOING=1` reports every failing cell at once instead of stopping at the first (`failures.json`).

## Buildings are clipped to the cell

A building used to belong to the cell holding its centroid, and every cell it overlapped had to load that owner (up to four neighbours, so a 2×2 safety set pinned about twelve cells). In dense Athens that is more than the desktop low-end budget (64 MiB) can hold. Now each cell emits the **part of every footprint inside it**, as a flush prism with the whole building's base, height and palette; the cut wall is hidden between the two halves. Piece ids are `<part id>/<cx>:<cz>`. No cell has dependencies, and the worst 2×2 safety set fell from 58.6 MB (coast, owners) to **36.6 MiB for the whole 289-cell world** (cap 64 MiB).

Pieces under 0.5 m² are left out, and a piece whose simplified outline would change by more than 15% is dropped and counted (`clippedBuildingPiecesDropped` in the bake summary: 56 of 4,419 pieces).

## Structures: what is modelled, what is left out

One deck over ground is the only structure the streamed world models: a literal `bridge=yes` on layer 1 (the owner-approved guarded-shoulder exception, unchanged). Everything else is **left out, by rule, in every cell**, and counted in the bake summary (`excludedByReason`). Nothing is invented; a gap is a gap.

| left out | rule (`bridge_policy.exclusion_reason`) |
|---|---|
| tunnels | `tunnel=*` |
| bridges stacked on layer 2+, other bridge types | `bridge` not literally `yes` on layer 1 |
| layered non-bridges | `layer=*` without a bridge |
| steep streets | listed in `steep-exclusions.json` (see below) |
| decks that cannot be lifted safely | listed in the area's `structures.json` |
| one hillside street on the coast | `coast-exclusions.json` (unchanged) |

For the Piraeus area that is 139 roads of 11,9xx. The network is still one connected component, **undirected**, from Piraeus through Faliro to Glyfada and the Riviera (`11,097` of `11,918` roads in the main component). Driving direction is a different question, see *Directed connectivity* below.

### The structure plan (decided once, for the whole area)

A cell only sees the roads its 512 m halo loads, so grouping one physical bridge from a clipped halo can differ between neighbours (a different first way, a shorter chain), and a different decision is a cracked seam. `tools/world-gen/plan-structures.py CACHE AREA` therefore decides **every deck group once with the whole area in view** and writes `areas/<area>.structures.json`: for each kept group its roads, the roads that pass under it, centre, axis, taper width, **and its platform polygon**; plus the bridges drawn as ordinary roads and the roads left out. Every cell builds its decks from that plan.

A group is **kept** when its approaches are long enough to lift it (200 m underpass taper) and every road passing under it keeps 4.5 m under the slab. Otherwise its deck roads are left out and the street beneath stays; the planner iterates until nothing fails. Three further rules keep the plan honest:

* A road is "under" a deck only where its centreline truly crosses a bridge way **without sharing a node**, the test the profile solver uses to lift a deck. A street that merely meets a bridge end is a junction, not a crossing.
* A deck chain continues through a node that joins exactly two roads even if the name or class changes there (OSM often changes both at the bridge end).
* A ground street joining the deck at a node inside the underpass dip (including its smoothed 16 m fringe) is left out; it would start 4 m below the deck it connects to.

A bridge with no road beneath (rail, stream) is drawn as an ordinary road, **at layer 0**, with no deck and no guardrail (38 bridge ways in this area).

Piraeus result: 8 kept deck groups (1 on the coast, 7 new), 38 unresolved bridge ways drawn as ground, 64 roads left out by the plan.

### Steep streets

`plan-steep.mjs CACHE AREA 'x,z;...'` re-bakes the failing cells, takes the physical audit's **offender roads** (asphalt triangles over 30° and shoulder samples past 15 cm / 30°, named by their surface id) and adds them to `steep-exclusions.json` with the gate they failed, repeating until the cells pass. The gates are not relaxed. The Piraeus area needed 10 streets, all on the Kastella / Profitis Ilias slopes (cells -16,8 and -15,7).

## Seams

Seam and gate checks on every shared border are unchanged and exact. Making a union of structures seam-exact needed four things that are worth knowing:

* every deck platform is an order-stable union, snapped like the street regions, with border crossings moved onto the 2 m border vertices when within 5 cm (otherwise a 2 cm sliver segment appears whose side each cell decides from its own triangulation);
* the platform polygons come from the plan, whole, in every cell (a road touching a far deck is cut by that deck in every cell, or in none);
* deck input is windowed to the 96 m around the cell and its outline is the same order-stable union;
* junction pockets under 4 m² beside a three-way node are closed (`street_regions.fill_junction_holes`), matching the audit's own definition of a junction gap.

## Look

* **Bridge guardrail.** The deck edge is a slab with a 10 cm kerb lip, and on it a post-and-beam rail (galvanised grey, posts every 4 m, beam 28 cm tall) whose top is the collision rail's 0.65 m. It follows the deck edge exactly. The collision rail is unchanged: a solid, swept 0.3 m × 0.65 m volume, tested at 150 km/h glancing and head-on (`tools/world-tile-barriers.test.mjs`), so what is drawn is always inside what a car hits.
* **Ground, facade and sea textures** (procedural, per land class, World detail Off removes them): [docs/world-dressing.md](world-dressing.md).
* **Ground between buildings.** Ground whose every corner is urban land (residential, commercial, retail, industrial, garages, railway) is its own mesh with `tileSurface: 'urban'`. It keeps a muted warm vertex colour (`#86837a`) and at run time gets the shared paving scan at 6.4 m (twice the paving period, 80 repeats per tile), blended at 70%, with a tone drift whose wavelengths divide the tile so it never seams. No new texture is loaded. Other ground is unchanged.

## Gates added

`tools/world-gen/area_test.py` (areas share one world and are contiguous; clipped pieces tile the footprint, share height and palette and have valid wire ids; the guardrail's faces point outward, it is low and open under the beam), `bridge_policy_test.py` (exclusion rules, continuation at tag boundaries), the junction-pocket case in `street_regions_test.py`, the urban material in `tools/athens-materials.test.mjs`, and in the packer: the offender list on every physical failure, cracked seams reported in keep-going mode, and every deck-edge gate unchanged.

## The centre (`centre`, the third area)

Inland Athens cannot be described by a distance to the coast, so `select-region.py CACHE OUT.json --extends piraeus-faliro --world athens-centre-development --district name=W,S,E,N ...` takes named district boxes (lon/lat), keeps the 512 m cells that hold roads or buildings and drops cells the extended areas already own. The boxes are stored in the output (`centre-candidates.json`: Kallithea / Nea Smyrni / Koukaki, the historic centre, Kypseli / Patisia: 161 cells, 85,231 buildings, 21,470 roads).

**What fits.** The new cells average 1.08 MB compressed (largest 1.63 MB); the 47 that fit take the world to **183.8 MiB of the 192 MiB ceiling**. They are the historic centre (24 of its 60 cells: Syntagma, Omonia, Plaka/Monastiraki, Kolonaki, Pangrati west, the south of Exarchia) and 23 of the 73 Kallithea / Nea Smyrni / Koukaki cells, with the Syngrou corridor. **None of Kypseli / Patisia fits.** The remaining 114 candidate cells would add about 118 MiB at the new-cell average (about 301 MiB in all): more than the ceiling allows, so they stay in `centre-candidates.json` until the ceiling, or the cost per cell, changes. The worst 2×2 safety set did not move (36.6 MiB, still a Piraeus cell): inland centre cells are denser but smaller, and buildings are clipped.

**One height solve for the whole union.** `profiles.py --area` now solves heights for the area and everything it extends in one pass, so every shared border agrees; the whole 336-cell world is baked again each time (Piraeus and the coast change by sub-millimetre amounts).

**Seams.** The street-region union is snapped to its 2 cm grid at every step (`shapely.union(..., grid_size=GRID)`), so two cells that load different far-away streets cut the very same edge. This was the cause of the last cracked seams in the centre.

### Turn restrictions that cut the network

A `no_u_turn` made of `from -> via ways -> to` (a median crossover) used to forbid entering any via way from the from-way. When a via way is a stretch of the through road, that also banned driving straight on, and a single Poseidonos rule split the strongly connected road network in two. Only the last step is forbidden now (entering a to-way from a via way; audit mode `via-chain-exit`, 605 relations in this area). Restrictions the compiler cannot express still fail closed by blocking the from-way (36 relations, 73 edges blocked from AI and routing; the player can still drive them).

### Directed connectivity (what is enterable from where)

`tools/world-connectivity-audit.mjs` (strongly connected components of the turn-aware edge graph) on the centre world: 1,480 km of drivable edges, **main component 1,162 km (78.5%)**; the other components are one-way pockets cut by the edge of the baked world. From the Syntagma start, 93% to 98% of the centre, Faliro/Kallithea, Alimos/Elliniko and Glyfada..Riviera is enterable, and 64% of Neo Faliro / Tavros / Moschato. **Piraeus is exit-only: 0% of its 196 km can be entered from the centre, while 73% of it can be driven from inside and from there everything else is reachable.** The Piraeus-bound carriageways run through the Tavros underpasses, and tunnels are left out: adding every tunnel back makes Piraeus enterable (73%), adding any other left-out category does not. Turn restrictions and edge heights are not the cause. The undirected statement above stays true; only the direction is missing. Fixing it means modelling those underpasses (a tunnel is a deck-over-ground problem turned upside down) or opening a few of them at grade; neither is done.

## World size ceiling

The packer (`pack.mjs`, `WORLD_CEILING_BYTES`, used by `build-coast.mjs`) refuses a world whose cells together exceed **2 GiB compressed**. Owner decision 2026-10-19 (`docs/OWNER-DECISIONS.md`, "Athens world ceiling raised to 2 GB"), up from 192 MiB. Nothing player-side moved: the initial download stays at or under 15 MiB, the worst 2×2 safety set at or under the 64 MiB desktop low-end budget (the owner decided on 2026-10-19 that the game is computer only; this figure was a phone cap before and is unchanged for now), the stream at 64 MiB resident, the tier caps and the ten-minute session measurement as they were, and the R2 staging bucket at or under 5 GB in total. The earlier sections quote the 192 MiB ceiling that applied when they were written.

## The full centre (`centre-full`, the fourth area) and what changed to fit it

`areas/centre-full.json` extends `centre` with the other 114 cells of `centre-candidates.json` (Kypseli/Patisia first, then the rest of the historic centre and Kallithea / Nea Smyrni / Koukaki): **450 cells, 104.1 MiB compressed** (under the 192 MiB ceiling that applied then; the ceiling is 2 GiB now), baked as one world from the `-ad` caches (`profiles-ad`, `graph-ad`, `turns-ad`, `sections-ad`, built with the commands above and `--area areas/centre-full.json`) with `plan-structures.py` run for the whole union (`centre-full.structures.json`).

**Cost per cell (compact tiles, `docs/world-tiles-format.md`).** Each piece of geometry is stored once: one position array and one index array shared by the render meshes, the fine triangles and the contact rows; buildings are derived from their footprints at load; the unused per-vertex ribbon tables are gone. Nine dense sample cells shrank 62% compressed and 39% in resident bytes (−68% compressed against the format before this work); the 450-cell world's mean cell is 0.24 MB compressed and 2.2 MB resident (dense cells 5–6.3 MB, down from 7–11), so the 64 MiB stream holds roughly twice as many dense cells. Seam, contact and gate behaviour are unchanged: 36,000 random contact queries answer identically from a compact tile and from its classic table shape.

**Underpass links drawn at grade (`tunnels.json`).** The Tavros / Poseidonos underpass `w45190676:0` (a one-lane, one-way, 79 m `tunnel=yes` link under three roads) was the only way into Piraeus from the centre: with it left out, Piraeus was exit-only (0% of its 196 km enterable from Syntagma). The structure planner cannot lift a deck over such a short link in a dense interchange, whichever road is made the deck (both runs were tried: "approaches too short", and they also swallowed the existing Tavros deck group), and a true tunnel (trench, walls, lid, portals) is a new structure type. `tools/world-gen/tunnels.json` therefore lists the few tunnels that matter, and `tunnels.py` re-tags each as an ordinary layer 0 street where roads enter the profile database (`profiles.py`) and when a cell loads its roads. Its profile follows the roads it crosses, the crossing shares their asphalt, the graph creates no turn there, and the bake summary lists it as an at-grade underpass. Every other tunnel is still left out.

**Cell borders.** A polygon outline edge that lies exactly on a cell border (a 2 cm platform tip in cell -7,9 of the Faliro interchange) exists on one side only and cracked the seam; `canonical_polygon` now lifts such edges 2 cm into the polygon (`border_nodes.lift_border_runs`, tested in `border_nodes_test.py`).

## The north (`north`, the fifth area)

`areas/north.json` extends `centre-full` with **322 cells** picked by `select-region.py` from eight district boxes (lon/lat, in the file): Galatsi, Nea Ionia, Irakleio, Psychiko/Filothei, Chalandri, Marousi, Kifisia and Agia Paraskevi. Everything is still **one world** (`athens-north-development`, 772 cells, 198.6 MiB compressed against the 2 GiB ceiling), baked from the `-ae` caches (`profiles-ae` … `sections-ae`, `--area areas/north.json`) with `plan-structures.py` run for the whole union (`north.structures.json`: 31 deck groups). The northern hills needed no steep-street exclusion (`plan-steep.mjs` found none). Mean cell 0.27 MB compressed, largest 0.76 MB (6.3 MB resident), so the worst 2×2 set stays at 22.8 MiB (the 64 MiB desktop low-end budget).

Two generator faults showed up only here and are fixed, with their gates unchanged:

* **A deck's raised approach can run far from its bridge.** A raised road is the whole OSM way, so a cell hundreds of metres from the bridge loads the approach but none of the bridge ways, built its deck and rails, and recorded no structure: the shoulder audit then swept six metres off a deck edge and failed with thousands of "missing contacts". `Structures.approaches()` now gives such a cell an `approachOnly` guarded record (the bridge named from the plan, the loaded approach roads listed, no clearance measured because the cell has no crossing); the audit accepts it only with both lists (`world-surface-audit.test.mjs`).
* **A long straight kerb edge can disagree by one 2 cm step across a border.** Cell 10,-25's street polygons were cut by a 96 m window that ended 10 m before the end of a 120 m kerb edge the neighbour saw whole, so the border crossing rounded 5618.74 against 5618.76. `seam-halos.json` lists the cells that need a wider street window (here 288 m for 10,-25); the bake's own seam check finds them and the neighbours are re-baked beside the cell to prove the seam.

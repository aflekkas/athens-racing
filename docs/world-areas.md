# Streamed Athens: areas, structures and what a bake decides

Everything here is behind the `?map=athens` dev flag. The generator lives in `tools/world-gen/`; cells are hosted in R2 (staging bucket only), never in Git.

## Areas: one world per bake

An **area** (`tools/world-gen/areas/<name>.json`) lists the 512 m cells one bake covers. Areas can `extend` earlier ones, and the **union is baked as one world**, so every border between the old and the new cells is shared, checked and exact:

| area | cells | what |
|---|---|---|
| `coast` | 120 | Glyfada to the Riviera (x 0..9, z 25..36) |
| `piraeus-faliro` | 289 | the coast plus 127 land cells and 44 sea-ring cells: the Alimos/Elliniko strip, Faliro, Neo Faliro, Tavros, Moschato and the Piraeus peninsula |

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

A building used to belong to the cell holding its centroid, and every cell it overlapped had to load that owner (up to four neighbours, so a 2×2 safety set pinned about twelve cells). In dense Athens that is more than a phone can hold. Now each cell emits the **part of every footprint inside it**, as a flush prism with the whole building's base, height and palette; the cut wall is hidden between the two halves. Piece ids are `<part id>/<cx>:<cz>`. No cell has dependencies, and the worst 2×2 safety set fell from 58.6 MB (coast, owners) to **36.6 MiB for the whole 289-cell world** (cap 64 MiB).

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

For the Piraeus area that is 139 roads of 11,9xx. The network is still one connected component from Piraeus through Faliro to Glyfada and the Riviera (`11,097` of `11,918` roads in the main component).

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
* **Ground between buildings.** Ground whose every corner is urban land (residential, commercial, retail, industrial, garages, railway) is its own mesh with `tileSurface: 'urban'`. It keeps a muted warm vertex colour (`#86837a`) and at run time gets the shared paving scan at 6.4 m (twice the paving period, 80 repeats per tile), blended at 70%, with a tone drift whose wavelengths divide the tile so it never seams. No new texture is loaded. Other ground is unchanged.

## Gates added

`tools/world-gen/area_test.py` (areas share one world and are contiguous; clipped pieces tile the footprint, share height and palette and have valid wire ids; the guardrail's faces point outward, it is low and open under the beam), `bridge_policy_test.py` (exclusion rules, continuation at tag boundaries), the junction-pocket case in `street_regions_test.py`, the urban material in `tools/athens-materials.test.mjs`, and in the packer: the offender list on every physical failure, cracked seams reported in keep-going mode, and every deck-edge gate unchanged.

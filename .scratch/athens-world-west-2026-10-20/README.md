# Athens world: the west (2026-10-20)

World `athens-west-development`, dev flag only (`?map=athens`), computer only. One world of **1,139 cells**: the dressed north world (772) plus 367 west cells (339 land, 28 sea ring) in Sepolia/Kolonos, Egaleo, Chaidari, Peristeri, Ilion/Agioi Anargyroi, Petroupoli, Kamatero, Nikaia/Korydallos, Keratsini/Drapetsona and Perama.

## Gates

| Gate | Result | Limit |
|---|---|---|
| Compressed world | 318,297,578 B = **303.6 MiB** (mean cell 0.28 MB, largest 0.76 MB, 7.1 MB resident) | 2 GiB (`audit-summary.json` still prints the old 192 MiB ceiling) |
| Worst 2×2 safety set | **26 MiB** (cell -10,-10); worst 3×3 52 MiB | 64 MiB |
| R2 staging total | 3,764 objects, 1,181,821,128 B (1.18 GB) | 5 GB |
| Asphalt | 5,279,725 triangles, 0 above 30°, max 27.0° | ≤ 30° |
| Shoulders | 290,168,118 samples, max step 14.37 cm, max 29.89°, 0 missing contacts | ≤ 15 cm, ≤ 30° |
| Street grade | max 42.4% | 45% |
| Bridges | 36,919 edge samples, 0 unguarded; 14,828 clearance samples, 0 blocked, min 4.68 m; 53 cells with decks | |
| Junctions / sidewalks | 63,004 junctions, 0 holes; 2,943,875 sidewalk samples, 0 missing | |
| Graph | 161,185 directed edges, 82,342 nodes, 2,177 turn rules, 101,808 tow anchors | |
| Disk | 74% during the bake and upload | under 83% |

## Seven first-bake failures, all fixed (gates untouched)

1. Cells -14,2 and -12,-8: GEOS "Ring edge missing" / "side location conflict" in a junction fillet difference (invalid ring). `street_regions._overlay` repairs and retries only after a GEOS exception.
2. Cell -1,-14: a snapped polygon split in two and `canonical_polygon` nested a MultiPolygon. Parts are flattened.
3. Cells -13,-9 and -12,-9: one self-crossing 1.5 km street lost its sidewalk strip (the single-sided buffer filled the loop). Non-simple lines are buffered in 50 m pieces.
4. Cells -27,2 and -24,3: a 45.2% and a 45.3% street grade (limit 45%). The audit now names such a road, so `plan-steep.mjs` leaves `w116650376:0` and `w976901163:0` out (692 excluded roads in all, in `bake-summary.json`).

Regression tests: `street_regions_test.py` (`WestBakeCrashes`, input in `fixtures/west-robust-geometry.json`) and `world-surface-audit.test.mjs`.

## Directed connectivity and reach

`connectivity-scc-report.json`: 8,103 km drivable, main component 7,646 km (94.4%). `reach.json` (from the Syntagma start): whole world 95.4% enterable; Peristeri 99.8%, Nikaia/Korydallos 99.1%, Ilion 98.8%, Chaidari 98.6%, Petroupoli 98.0%, Sepolia/Kolonos 96.6%, Egaleo 96.2%, Kamatero 94.8%, Keratsini/Drapetsona 84.4%, Perama 76.4%.

## Ten-minute desktop run (`measure-desktop-10min.json`)

Start Peristeri, goals Egaleo, Nikaia, Keratsini: **5,158 m**, 0 holds, 0 missing contacts, 0 failures, 0 errors, 200 fps median (p95 frame 266.6), stream resident 66.4 MB at the 64 MiB cap, 39.0 MB downloaded (95 cells).

## Buildings (`buildings-per-cell.json`: `[OSM footprints, baked rows]` per cell)

The bake keeps every footprint (baked rows are about 105% of the cleaned OSM footprints centred in a cell, the extra being footprints split at cell borders) and the cleaned source matches the raw PBF. OSM maps few buildings in the western port suburbs. Per 512 m cell, OSM / baked: Peristeri 793 / 831, Chaidari 298 / 315, Petroupoli 307 / 325, Ilion 294 / 309, Egaleo 255 / 270, Sepolia 250 / 271, Nikaia/Korydallos 42 / 45, Keratsini/Drapetsona 34 / 36, Kamatero 23 / 25, Perama 9 / 10 (north: 145 to 450). `shots/overview-west-aigaleo-hills.png` looks at the Aigaleo hillside (cell -15,-3, 3 buildings); `overview-peristeri-egaleo.png` shows the dense blocks and `overview-nikaia-korydallos.png` a full street grid with few mapped buildings.

## Screenshots (`shots/`, 1280×720)

peristeri, egaleo, nikaia, korydallos (street and above), keratsini shore (street), perama shore (above), chaidari (street), ilion (above) and four overviews.

Staged to R2 staging only, manifest `manifests/ea2c752e2dcef0db84abd7f2759586df87fce775c055395d1af557bc7557f58c.json`; all 1,139 cells were pulled back and their hashes checked.

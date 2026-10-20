# Athens world: the east (2026-10-20)

World `athens-east-development`, dev flag only (`?map=athens`), computer only. **1,369 cells**: the west world (1,139) plus 230 east cells (land) over Zografou, Kaisariani, Vyronas, Ilioupoli, Agios Dimitrios, Dafni, Argyroupoli, Alimos inland, Glyfada inland, Ano Glyfada and Agia Paraskevi (the north world already covers Agia Paraskevi). Manifest `manifests/a2cc091deae3900dbf11180f19acbc29577d406b6173b6e39d23d39d6b4209e6.json`, the staging pointer in `wrangler.jsonc`.

## Gates (all 1,369 cells, unchanged)

| Gate | Result | Limit |
|---|---|---|
| Compressed world | 374,861,459 B = **357.5 MiB** (mean cell 0.27 MB, largest 0.76 MB, 7.1 MB resident) | 2 GiB |
| Worst 2×2 safety set | **26 MiB** (cell -10,-10); worst 3×3 52 MiB | 64 MiB |
| Asphalt | 6,212,204 triangles, 0 above 30°, max 27.02° | ≤ 30° |
| Shoulders | 341,202,901 samples, max step 14.37 cm, max 29.89°, **0 missing contacts** | ≤ 15 cm, ≤ 30° |
| Street grade | max 42.4% | 45% |
| Bridges | 44,378 edge samples, 0 unguarded; 16,525 clearance samples, 0 blocked, min 4.68 m; 63 cells with decks | |
| Junctions / sidewalks | 73,705 junctions, 0 holes; 3,456,808 sidewalk samples, 0 missing | |
| Seams | exact (the packer finds no seam mismatch across all 1,369 cells) | |
| R2 staging total | 1.557 GB of 5 GB (5,134 objects: west + east) | 5 GB |

## Steep streets

One cell failed on the first bake: cell 4,6, asphalt at 36.7° on two Hymettus-slope streets, `w225922250:0` and `w552896140:0`. `plan-steep.mjs` added both to `steep-exclusions.json` (14 entries in all; 45% and 30° limits not relaxed), and the whole world was baked again so every shared border agrees. Bake summary: 745 excluded roads (`bake-summary.json`), one at-grade Tavros underpass carried over from the centre (`w45190676:0`).

## Connectivity from Syntagma (`reach-buckets`, turn-aware)

Whole east world **95.1%** of 9,543 km. Argyroupoli (real cells x 2..5, z 14..17) **95.3%**; Ilioupoli 97.3%; Vyronas 96.8%; Agios Dimitrios 99.2%; Glyfada inland 99.6%; Ano Glyfada 94.4%; Zografou 84.5%; Kaisariani 70.8%.

`reach-buckets` labels cells by the box each was picked from, and Argyroupoli's box was wrong (it sat on the Hymettus foothills, so its bucket showed 0%). The cells the box picked up are the real Argyroupoli; the corrected box is in `areas/east.json`. `reach.json` still carries the old 0% row for that reason, and `reach-classification.json` has the corrected Argyroupoli row.

**Unreachable km are pockets.** In Zografou 40.5 of 41.4 km and in Kaisariani 41.5 of 43.1 km are edges with no reachable predecessor, not turn-blocked edges. Where those pockets touch the roads the bake leaves out, or the world edge, is not yet broken down by cell.

## Ten-minute desktop drive (`measure-desktop-10min.json`)

Start at the default spawn, goal Argyroupoli. **2,530 m, 0 holds, 0 missing contacts, 0 failures, 0 errors.** But the car stopped moving at about 300 s on a reachable, two-way connected spot near (4000, 9875) and did not reach its goal. The stop is outside the graph's pockets: every edge within 30 m is reachable both ways (`reach-classification.json`, `stall`). Its cause is open (pilot, physics or a snag); this needs a trace run. The frame numbers from this run are not usable: the box's load average was about 40 on 8 cores.

## Screenshots (`shots/`, 1280×800, current prod client)

Street: vyronas, ilioupoli, agia-paraskevi. Above: zografou, argyroupoli (the dense grid, not a data gap), vyronas, ilioupoli, agia-paraskevi, kaisariani. Overview: east. Not included: street views of zografou, argyroupoli and kaisariani; their cars were placed off-road (kaisariani and zografou on open ground or a flat plane, argyroupoli against a building wall). Their car points are the open item.

## Data gap check (`buildings-per-cell.json`)

Baked rows against OSM footprints centred in the cell: Argyroupoli (2..5, 14..17) 250–660 per cell, baked within about 5% of OSM; Vyronas 5,5: 811 OSM / 857 baked; Zografou 5,-2: 402 / 441. The earlier "empty" Argyroupoli frame was a box error, not missing data.

## Open

Drive stall (above). Street shots for Zografou, Argyroupoli and Kaisariani. Pocket breakdown by cell. Infill (waits for the owner's go). Papagou and Cholargos were not in any east selection; whether the north world covers them was not checked.

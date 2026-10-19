# Athens: Piraeus entry, smaller cells, the whole centre (2026-10-19)

Code: `prod` at `8c3059c5`. World: **one 450-cell world**, the earlier 336 cells plus the other 114 candidate cells of `centre-candidates.json` (Kypseli/Patisia first, then the rest of the historic centre and Kallithea / Nea Smyrni / Koukaki), baked in one pass with every gate on and published to **`athens-racing-world-staging`**: manifest `manifests/998c33ac58cb4061687c34b67a34aa1b0dcaa54317a69c5a828ebcbaf56f9d50.json` (world `athens-centre-development`, spawn unchanged: Glyfada). Everything below was measured from the cells **pulled back from R2 and hash-checked**, served as the Worker serves them, running the real app at `/?map=athens`. Behind the dev flag; the Worker is not deployed (`wrangler.jsonc` staging points at the new manifest).

## 1. Piraeus is enterable now

The only way into Piraeus from the centre was one tunnel: `w45190676:0`, a one-lane, one-way, 79 m `tunnel=yes` link under three roads at Tavros. No at-grade slip or service road runs beside it. A deck over it cannot be planned (the planner's rule "approaches too short" fails whichever way round the deck goes, and the attempt also swallowed the neighbouring deck group), and a true tunnel is a new structure type, so `tools/world-gen/tunnels.json` lists the link and draws it as an **ordinary layer 0 street** (profile follows the roads it crosses; it shares their asphalt where it crosses; no turn is created). Every other tunnel (70 roads) is still left out. This is a simplification: **the underpass is an at-grade crossing in this world**, not a tunnel with walls and a lid.

Directed connectivity from the Syntagma start (turn-aware; `directional-reach-after.json`, `connectivity-scc-report.json`, `scripts/reach-buckets.mjs`):

| district | km | enterable before | enterable now |
|---|---:|---:|---:|
| **Piraeus** | 195.6 | **0%** | **73.1%** |
| Neo Faliro / Tavros / Moschato | 171.3 | 64% | 81.9% |
| Faliro / Kallithea coast | 299.2 | 93–98% | 98.4% |
| historic centre | 595.4 | 93–98% | 96.3% |
| Kallithea / Nea Smyrni / Koukaki | 801.9 | – | 97.4% |
| Kypseli / Patisia (new) | 269.4 | – | 96.9% |
| Alimos / Elliniko / Glyfada / Riviera | 551.9 | 93–98% | 97.0% |
| whole world | 2,568.7 | – | 94.2% |

The main strongly connected component is 2,390 km, **92.8%** of the drivable network (it was 78.5%). **The ≥90% target for Piraeus is not reachable:** the other 52.7 km (26.9%) form 48 one-way pockets with no road leading into them from anywhere in the world (`scripts/reach-why.mjs`): 20 of their entry points are at the edge of the baked extent, 14 are fed only by restricted (non-public) port roads, and 31 start where a left-out road ends. Adding every excluded road back did not change this in the earlier analysis. Against what can be entered in principle it is above 90%.

Driven for real (`measure/link-drive.json`, `scripts/link-drive.mjs`): the car placed at the start of the link, real physics, autopilot: it drove `w45190676` → `w154085220` → on into Piraeus-bound streets, 438 m in 75 s, 0 holds, 0 missing contacts, 0 car hits, no page error.

## 2. Cells are 67% smaller

Same 336 cells, before (published centre manifest) and after (`cell-cost-comparison.json`): **192.7 MB → 63.9 MB compressed (−66.8%)**, resident **951 MB → 563 MB (−40.8%)**. The 75 dense cells (over 5 MB resident before): −68.6% compressed, −40.7% resident, mean 6.2 → 3.7 MB. The largest cell: 2.08 MB → 0.76 MB compressed, 10.7 → 6.3 MB resident. What went where (details: `docs/world-tiles-format.md`, "Compact tiles"):

| change | effect |
|---|---|
| one shared index array and one position array for render meshes, fine triangles and contact (draw calls are `drawRange` windows) | −13–20% compressed |
| buildings derived from their footprint tables at load (shared wall vertices, Uint8 shade, ear-clipped roof) | the largest single saving; wall shades are identical to the old `face_shaded`, roofs differ only in triangulation |
| ground contact rows are the fine triangles (`fineSurface`/`fineFlags`); one reference per triangle in the contact index | contact index halved; 36,000 random queries identical |
| the per-vertex ribbon tables (never read at run time) dropped | −12% |
| render and contact share one array unless a platform lowers the terrain under a deck | the rest |

Classic tiles stay valid. Nothing changes at driving distance: `shots/` and a before/after of four cells render the same (checked by eye). The 450-cell world's mean cell is 0.24 MB compressed and 2.2 MB resident.

## 3. The rest of the centre

450 cells, **104.1 MiB** compressed (the 192 MiB ceiling that applied at bake time; the packer's ceiling is 2 GiB now, `WORLD_CEILING_BYTES`, owner decision 2026-10-19). Largest cell 0.76 MB, 13.2 M triangles. Road: 28,156 nodes, 51,822 directed edges, 901 turn rules, 31,761 tow anchors.

**Safety sets (phone cap 64 MiB).** Worst 2×2 safety set **22.8 MiB** (cell -17,9; was 36.6), worst 3×3 neighbourhood 44.3 MiB, largest transient decode reservation 19.5 MiB. No cell has dependencies.

**Gates, all 450 cells** (`audit-summary.json`). Asphalt triangles 1,779,868, **0 above 30°** (max 27.0°). Shoulder sweep 97.2 M samples, **max step 14.4 cm, max 29.9°**, 0 missing contacts, max profile grade 42%. Every adjacent border exact (one cracked seam was found and fixed, see below). Bridge decks in 15 cells: 11,778 deck-edge samples, **0 unguarded**; 3,886 clearance samples, **0 blocked**, minimum clearance 4.8 m; 0 unsafe anchors. Streets: 21,261 junctions checked, 0 gaps, 0 overlap; 1,000,202 sidewalk samples, 0 missing; 8,456 zebras, 93,083 junction fillets.

**Left out and counted** (`bake-summary.json`): 224 roads: 70 tunnels (the Tavros link is no longer among them), 93 roads of deck groups that cannot be lifted safely, 43 layered non-bridges or stacked bridges, 11 steep hillside streets, 7 street stubs that would meet a deck inside its underpass dip. 48 bridge ways with no road beneath are drawn as ordinary roads.

**A seam fix found by the new cells.** Cell -7,9 (the Faliro interchange's platform reaches into it) cracked its seam with -7,8 by 2 cm: a platform outline edge lay exactly on the cell border, so only one side had a triangle edge there. `canonical_polygon` now lifts such edges 2 cm into the polygon (`border_nodes.lift_border_runs`, tested). No other pair cracked.

**R2 (staging only).** 1,078 objects, 444,029,564 bytes (451 objects, 109,300,082 bytes added; the older centre and Piraeus worlds' objects are still there, unreferenced by the new manifest, about 335 MB, not pruned). Production bucket `athens-racing-world`: 0 objects; `aflekkas` and `aflekkas-health` untouched. Limit 5 GB.

## 4. The two 10-minute runs

Autopilot on the directed road graph, real physics and traffic, tour Syntagma → Omonia → Kypseli → Patisia → Syntagma (`measure/desktop-10min.json`, `phone-10min.json`; 4.5–5.7 km each, the autopilot's reroutes resume from an interior anchor nearer the goal: 5 and 3 times).

| | desktop 1280×720 | phone 390×844, 4× CPU throttle |
|---|---|---|
| distance / failures / missing contacts / holds | 5,490 m / 0 / 0 / 0 | 5,747 m / 0 / 0 / 0 |
| peak JS estimate (cap 256 MiB) | 123.8 MiB | 124.0 MiB |
| peak GPU estimate (cap 192 MiB) | 50.2 MiB | 43.6 MiB |
| stream resident peak (cap 64 MiB) | 62.3 MiB | 63.8 MiB |
| cells resident at peak | 22 | 20 |
| browser process-tree RSS peak | 1.25 GB | 1.23 GB |
| frame median / p95 (SwiftShader, software) | 183 / 217 ms | 133 / 250 ms |
| network downloaded in 10 minutes | 23.7 MiB (62 cells) | 22.0 MiB (57 cells) |
| before the car can drive (limit 15 MiB) | 2.51 MiB (2 cells) | 2.51 MiB |
| startup to drivable | 2.4 s | 3.8 s |

The same 64 MiB stream now holds 20–22 cells of this dense centre where it held about 8, and the network cost of the tour halved (the old tour: 49.4 MiB). Frame times are software-rendered and only mean something relative to each other (the old centre run: 350 / 283 ms median); a physical-phone 30 fps result is still unproven.

## Files

| path | what |
|---|---|
| `shots/*.webp` | ten screenshots, 1280×720 |
| `audit-summary.json`, `bake-summary.json` | every gate number; the bake's own summary |
| `connectivity-scc-report.json`, `directional-reach-after.json` | turn-aware components; enterable-from-Syntagma by district |
| `cell-cost-comparison.json` | per-cell bytes before and after |
| `measure/` | the two 10-minute runs and the drive through the Tavros link |
| `scripts/` | harness and analyses used |

## Screenshots

| file | shows |
|---|---|
| `tavros-link-street.webp` | the car on the Tavros link (way 45190676), at the interchange, crossing the wide roads at grade |
| `tavros-link-above.webp` | the link from 55 m: the one-lane link crossing the arterial roads |
| `syntagma-street.webp`, `syntagma-above.webp` | Syntagma as before, from the compact tiles |
| `kypseli-street.webp`, `kypseli-above.webp`, `patisia-above.webp` | new: a Kypseli street between tall blocks; Kypseli and Patisia from above |
| `plaka-street.webp`, `syngrou-avenue.webp` | Plaka and Syngrou as before |
| `overview-centre-north.webp` | the new northern part of the centre from 900 m |

## Caveats

* The Tavros underpass is an at-grade crossing (see section 1), not a tunnel.
* Piraeus is 73% enterable, not 90% (section 1).
* The Acropolis is still a flat-topped hill with a box on it, no landmark modelling; software-rendered frame times only.
* The first Piraeus drives (`autopilot from 3 km east`) were not kept: the autopilot's reroute teleports the car, so they did not prove a path; the link drive above places the car on the link and proves the link itself.

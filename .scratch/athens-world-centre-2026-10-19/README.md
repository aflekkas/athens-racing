# Athens centre: evidence (2026-10-19)

Code: `prod` at `2ead313f` (this folder is committed after it). World: **one 336-cell world**, the coast (120 cells) plus Piraeus / Faliro (169) plus **47 new inland cells**, baked in one pass with every gate on and published to **`athens-racing-world-staging`**: manifest `manifests/d61171c865ba119a2919d99905b36e6c12f01950ec3251a98b601281c5164aae.json` (world `athens-centre-development`, spawn unchanged: Glyfada). Everything below was measured from cells pulled back from R2 and hash-checked against the manifest, served as the Worker serves them (immutable cell headers), running the real app at `/?map=athens`. Behind the dev flag; the Worker is not deployed (`wrangler.jsonc` staging points at the new manifest).

## Read this first: the centre does not all fit

The 192 MiB world ceiling is the binding limit, so the centre is **partial by design**:

| district (box in `centre-candidates.json`) | cells asked for | cells baked | not baked |
|---|---:|---:|---|
| historic centre (Syntagma, Omonia, Plaka/Monastiraki, Exarchia, Kolonaki, Pangrati) | 60 | 24 | parts of Exarchia and Pangrati and the outer ring |
| Kallithea / Nea Smyrni / Koukaki | 73 | 23 | 50 cells of the box (the box's own list is in `centre-candidates.json`) |
| **Kypseli / Patisia** | 28 | **0** | all of it |

The 47 new cells average 1.08 MB compressed (largest 1.63 MB) and take the world to **183.8 MiB (headroom 8.2 MiB)**. The other 114 candidate cells would add about **118 MiB** at that average (about **301 MiB** in all). I did not raise the ceiling. Options for the owner: raise the ceiling to about 310 MiB; cut the cost per cell (the centre is dense: 7.3 M triangles); or serve the far-south Riviera and Glyfada cells (about 45 MiB) from a separate world and keep the centre in this one. `tools/world-gen/areas/centre-candidates.json` has the full cell list and a structure plan for it.

## Files

| path | what |
|---|---|
| `shots/*.webp` | eight screenshots, 1280×720, listed below |
| `audit-summary.json` | every audit number, aggregated over the 336 cells |
| `bake-summary.json` | the bake's own summary (cells, bytes, safety sets, every excluded road and why, clipped buildings) |
| `connectivity-scc-report.json` | the turn-aware strongly-connected-component audit (`tools/world-connectivity-audit.mjs`) |
| `measure/desktop-10min.json`, `measure/phone-10min.json` | the two 10-minute runs (samples every 30 s, downloads, frame times); `desktop-first-clean-run-no-cache-headers.json` is an earlier run whose local server sent no cache headers (its 207 MiB "download" is mostly re-fetches a browser would not make) |
| `scripts/` | the harness (`pull`, `shots` + `spec*.json`, `measure` + `pilot.js`, `lib`, `mkr2`, `prune`) and the connectivity analyses (`connectivity-*`) |

## Screenshots

| file | shows |
|---|---|
| `syntagma-street.webp` | the car on a wide avenue near Syntagma: sidewalk, lane dashes, the road rising over a crest |
| `syntagma-above.webp` | Syntagma and its surroundings from 110 m: the junction web, zebras on every arm, the open square (green patches are the park) |
| `omonia-street.webp` | the car on a curving avenue towards Omonia, sidewalk and double line |
| `omonia-above.webp` | the Omonia area from the air; the dark area at the top is the edge of the baked world (Kypseli / Patisia is not in) |
| `plaka-street.webp` | a narrow street in the Plaka / Monastiraki cells between tall blocks |
| `syngrou-avenue.webp` | **Syngrou Avenue** at car level: a multi-lane carriageway with median and a zebra crossing, side roads and sidewalks |
| `syngrou-above.webp` | Syngrou from 95 m: the avenue, its side roads, crossings, a service road with trees and the frontage streets |
| `overview-centre-acropolis.webp` | the centre from 520 m: the grid of Plaka/Monastiraki, the Acropolis hill (flat grey top, the box is the Parthenon) on the left, the world's diagonal edge in the lower left |

## Numbers

**Extent and size.** 336 cells, **183.8 MiB compressed** (ceiling 192 MiB). Largest cell 2.08 MB compressed, 10.7 MB resident. 7.35 M triangles. Road: 1,176 km of road (directions merged; 1,595 km directed), 28,175 directed edges, 15,496 nodes, 462 turn rules, 16,986 tow anchors, 20,905 road parts of which 17,824 have sidewalks.

**Safety sets (phone cap 64 MiB).** Worst 2×2 safety set **36.6 MiB** (a Piraeus cell, -17,9; the centre did not raise it), worst 3×3 58.4 MiB, largest transient decode reservation 56.2 MiB (cap 64 MiB at the minimum tier). No cell has dependencies.

**Gates, all cells.** Asphalt triangles 1,015,913, **0 above 30°** (max 27.0°). Shoulder sweep 55.4 M samples, **max step 14.4 cm, max 29.9°**, 0 missing contacts, max profile grade 42%. Every adjacent border exact. Bridge decks in 13 cells: 9,968 deck-edge samples, **0 unguarded**; 2,584 clearance samples, **0 blocked**, minimum clearance 4.73 m; 0 unsafe anchors. Streets: 11,194 junctions checked, 0 gaps, 0 overlap; 561,836 sidewalk samples, 0 missing; 5,170 zebras, 48,286 junction fillets.

**What the generator leaves out (counted in `bake-summary.json`).** 191 of the world's roads: **51 tunnels** (including the Tavros / Poseidonos underpasses that Piraeus depends on), 41 stacked or odd-layer bridges and layered non-bridges, 81 roads of decks that cannot be lifted safely (14 deck groups: approaches too short, or clearance under the slab fails) plus 7 street stubs that would meet a deck 4 m below it, 10 steep Kastella streets (none of the 47 new cells needed a steep-street exclusion), 1 on the coast. 43 bridge ways with no road beneath are drawn as ordinary ground roads. 9 deck groups are kept and gated. 7,549 clipped building pieces, 105 dropped (outline would have changed over 15%).

**Seams, turns and the height solve.** The last cracked seams were a 2 cm snap flip in the street-region union; the union is now snapped to its grid at every step. A `no_u_turn` through via ways no longer bans driving straight on (605 relations compiled as `via-chain-exit`; one Poseidonos rule had split the road network in two). The whole 336-cell union is solved for height in one pass.

**Directed connectivity (this corrects my Piraeus report, which only checked undirected connectivity).** Turn-aware strongly connected components: 1,480 km of drivable edges, **main component 1,162 km (78.5%)**; the other components are one-way pockets, most of them cut by the edge of the baked world. Enterable from the Syntagma start: **93% to 98%** of the centre, Faliro/Kallithea, Alimos/Elliniko and Glyfada..Riviera, 64% of Neo Faliro / Tavros / Moschato. **Piraeus is exit-only: 0% of its 196 km can be entered from the centre**, while 73% of it can be driven from inside and from there everything else is reachable. Cause: the Piraeus-bound carriageways run through the Tavros underpasses, which are tunnels and are left out; adding every tunnel back makes Piraeus enterable (73%), adding any other left-out category does not, and neither turn restrictions nor edge heights are involved (`scripts/connectivity-*`). Fixing it means modelling those underpasses or opening a few of them at grade; I did neither.

**R2 (staging only).** 627 objects, 334,729,482 bytes (the 336 new cells plus the manifest, plus the earlier Piraeus-world objects). I pruned the 128 old-coast objects (47,966,654 bytes) that neither the Piraeus manifest nor the current one referenced: listed first, nothing referenced was deleted, `stillReferencedMissing: 0`. Production bucket `athens-racing-world`: 0 objects; `aflekkas` and `aflekkas-health` untouched. A second upload run wrote nothing. Ceiling 5 GB.

**Download.** Before the car can drive: **3.58 MiB** (2 cells 1.66 MiB, manifest 109 KiB, game scripts and scans 1.8 MiB; limit 15 MiB). A 10-minute tour of the centre (Syntagma, Omonia, Kolonaki, Syngrou, Plaka, Syntagma, Kolonaki; 4.5 km): **49.4 MiB over the network on both desktop and the phone emulation** (47 distinct cells, 46.1 MiB of cells). The stream asked for 110 MiB of cells in the same time: the dense centre cells are 7 to 11 MB resident, so the 64 MiB cap holds only about eight and cells are evicted and re-requested (served from the browser's cache with the Worker's immutable headers; without a cache this would be about 110 MiB). That is the cost of the centre's density at the minimum tier.

**10-minute run, traffic and real physics (autopilot on the directed road graph).**

| | desktop 1280×720 | phone 390×844, 4× CPU throttle |
|---|---|---|
| distance / failures / missing contacts | 4,472 m / 0 / 0 | 4,505 m / 0 / 0 |
| peak JS estimate (cap 256 MiB) | 158 MiB | 158 MiB |
| peak GPU estimate (cap 192 MiB) | 44 MiB | 37 MiB |
| stream resident peak (cap 64 MiB) | 63.9 MiB | 63.9 MiB |
| browser process-tree RSS peak | 1.27 GB | 1.24 GB |
| frame median / p95 (SwiftShader, software) | 350 / 550 ms | 283 / 350 ms |
| startup to drivable | 2.8 s | 4.3 s |

Frame times are software-rendered and only mean something relative to each other; a physical-phone 30 fps result is still unproven. Compared with the Piraeus run (JS 150 / 127 MiB, GPU 41 / 34 MiB, stream 62.3 MiB, RSS 1.25 / 1.21 GB) the dense centre costs a little more JS and the stream sits at its cap. The autopilot was rerouted 6 times (dead ends and one-way pockets); its goal list was changed once after it got trapped in a one-way pocket near Pangrati, which is why the first two attempts are not reported.

## Caveats

* Tunnels, stacked interchanges and short flyovers are left out (51 tunnels, 14 deck groups), so every underpass is missing and the Piraeus approach with it; the world is a drivable surface with gaps, not a faithful network.
* The Acropolis is a flat-topped hill with a box on it, and Syntagma square is an open earth-and-park surface: no landmark modelling was done.
* A physical-phone result, a real GPU frame time and the browser's behaviour under cache pressure are not measured here.

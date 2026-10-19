# Athens Piraeus / Faliro: evidence (2026-10-19)

Code: `prod` at `1f61c0fd` (this folder is committed after it). World: one 289-cell world, the connected coast (120 cells) plus Piraeus / Faliro (127 land cells and a 44-cell sea ring), baked in one pass with every gate on and published to **`athens-racing-world-staging`**:
manifest `manifests/41e674002320fdcb54649870d20a57b4d93fe44872773f9b25a83c184fe2887b.json` (world `athens-piraeus-development`, spawn unchanged: Glyfada). Everything below was measured from the cells **pulled back from R2 and hash-checked against the manifest**, served exactly as the Worker serves them, running the real app at `/?map=athens` (no code changes between the bake and the measurements). Behind the dev flag only. The Worker is not deployed; `wrangler.jsonc` (staging) now points at the new manifest.

## Files

| path | what |
|---|---|
| `shots/*.webp` | nine screenshots, 1280×720, listed below |
| `audit-summary.json` | every audit number, aggregated over the 289 cells |
| `bake-summary.json` | the bake's own summary (cells, bytes, safety sets, excluded roads and why, clipped buildings) |
| `measure/desktop-10min.json`, `measure/phone-10min.json` | the 10-minute runs: samples every 30 s (position, memory, stream, RSS), download counters, frame times |
| `scripts/` | the harness used: `pull.mjs` (R2 to local, hash-checked), `shots.mjs` + `shots-spec.json`, `measure.mjs` + `pilot.js` (goal-directed autopilot over the road graph), `lib.mjs` (Worker-shaped local server with byte counters), `mkr2.mjs` (stage a local bake as R2-shaped), `webp2.mjs` |

## Screenshots

| file | shows |
|---|---|
| `street-piraeus.webp` | the car on a two-lane Piraeus street: textured asphalt, lane dashes and edge line, paved sidewalk, kerb, the urban ground between the buildings |
| `street-faliro.webp` | a Faliro street with a zebra crossing at the side street, sidewalks both sides, the ground between blocks drawn with the paving scan |
| `junction-faliro.webp` | a junction from 16 m up: crossings, kerb corners, sidewalks wrapping the corners |
| `port-harbour.webp` | the Piraeus peninsula harbour: coast road with markings and sidewalks, quays, sea, dense blocks |
| `overview-faliro-coast.webp` | the Faliro waterfront and its street grid from 520 m up (dark areas are outside the baked cells) |
| `bridge-deck.webp` | the car on the deck of the Faliro interchange (group `w23180441`): the new low post-and-beam rail on both edges, second carriageways beyond |
| `bridge-deck-rail-side.webp` | the same deck from 7 m beside the car, the rail at car height |
| `bridge-above.webp` | the interchange from 90 m up: decks, ramps and the roads beneath |
| `bridge-under.webp` | from the ground under a deck: the slab underside, the rail seen from below, the ground road and its sidewalk |

## Numbers

**Extent and size.** 289 cells, **135.2 MiB compressed** (ceiling 192 MiB; coast alone was 45.7 MiB). Largest cell 2.08 MB compressed, 10.7 MB resident. 4.49 M triangles. Road: 871 km of road (directions merged; 1,228 km directed), 20,683 directed edges, 10,997 nodes, 296 turn rules, 12,430 tow anchors, 14,824 road parts of which 12,158 have sidewalks.

**Safety sets (phone cap 64 MiB).** The worst 2×2 safety set is **36.6 MiB** (cell -17,9, Piraeus); the coast's own worst was 58.6 MB with building owners. Worst 3×3 neighbourhood 58.4 MiB, largest transient decode reservation 56.2 MiB (cap 64 MiB; the minimum tier decodes one cell at a time). No cell has dependencies: every one is a contact cell.

**Gates, all cells.** Asphalt triangles 749,894, **0 above 30°** (max 27.0°). Shoulder sweep 41.0 M samples, **max step 14.4 cm, max 29.9°**, 0 missing contacts, max profile grade 42%. Every adjacent border exact. Bridge decks in 12 cells: 9,285 deck-edge samples, **0 unguarded**; 2,513 clearance samples, **0 blocked**, minimum clearance 4.73 m; 0 unsafe anchors. Streets: 7,975 junctions checked, 0 gaps, 0 overlap; 409,282 sidewalk samples, 0 missing; 3,447 zebras, 33,872 junction fillets.

**What the generator leaves out (all counted in `bake-summary.json`).** 139 roads of about 11,900: 27 tunnels, 12 on layer 2 or odd layers, 26 layered non-bridges, 63 by the structure plan inside the baked cells (56 roads of 11 deck groups whose approaches are too short or whose clearance fails, plus 7 street stubs that would meet a deck 4 m below it; the plan file lists 64), 10 steep Kastella / Profitis Ilias streets that no surface can satisfy inside the gates (gates not relaxed), 1 on the coast. 38 bridge ways with no road beneath are drawn as ordinary ground roads. 8 deck groups are kept and gated (1 coast, 7 new). The road network is still one connected component from Piraeus through Faliro to Glyfada and the Riviera (11,097 of 11,918 roads in the main component, 93%). 4,419 clipped building pieces, 56 dropped (outline would have changed over 15%).

**R2 (staging only).** 418 objects, 189,865,799 bytes (the 289 new cells plus the manifest, plus the earlier coast objects, which are now unreferenced and can be pruned). Production bucket `athens-racing-world`: 0 objects. `aflekkas` and `aflekkas-health` untouched. A second upload run wrote nothing. Ceiling 5 GB.

**Download.** Before the car can drive: **3.55 MiB** (2 cells 1.66 MiB, manifest 94 KiB, game scripts and the two scans 1.8 MiB; limit 15 MiB). A 10-minute session driving 5.2 km north from Glyfada into Alimos / Elliniko: **27.4 MiB on desktop, 26.6 MiB on the phone emulation** (70 to 71 cell fetches, 59 to 62 distinct cells; 25.5 / 24.7 MiB of it cells).

**10-minute run, traffic and real physics (autopilot on the directed road graph, 5.2 km).**

| | desktop 1280×720 | phone 390×844, 4× CPU throttle |
|---|---|---|
| distance / failures / missing contacts | 5,244 m / 0 / 0 | 5,367 m / 0 / 0 |
| peak JS estimate (cap 256 MiB) | 150 MiB | 127 MiB |
| peak GPU estimate (cap 192 MiB) | 41 MiB | 34 MiB |
| stream resident peak (cap 64 MiB) | 62.3 MiB | 62.3 MiB |
| browser process-tree RSS peak | 1.25 GB | 1.21 GB |
| frame median / p95 (SwiftShader, software) | 383 / 517 ms | 333 / 600 ms |
| startup to drivable | 5.6 s | 7.6 s |

Frame times are software-rendered and only mean something relative to each other; a physical-phone 30 fps result is still unproven. Memory is within the same caps as the coast run (JS 132 / 146 MiB then, GPU 41 / 34 MiB, stream 63.9 MiB, RSS 1.44 / 1.41 GB). The autopilot was rerouted 4 times (it reached the edge of the baked area and a traffic jam; it resumes from an interior anchor nearer its goal); the world has no tiles beyond its edge, so a car that reaches it holds.

## Caveats

* The two visual wins are runtime/bake looks, not gates: the **ground between buildings** is now the shared paving scan over a muted warm tone (it reads as paved plazas where blocks are empty, which is what the data shows); the **bridge rail** is a low post-and-beam rail inside the unchanged 0.65 m solid collision rail.
* A real bug was found and fixed on the way: the Athens tacho dial was missing Hud's new methods after the low-end-laptop commit, so the first frame threw and paused the car (a red "this.fontsReady is not a function" banner); guarded by a test.
* The first desktop attempts exposed three harness issues (steering sign, the car jamming against a traffic car, a local loop); the reported runs include the fixes and are the third and fourth full attempts. The edge-of-world hold is by design.
* Tunnels, stacked interchanges and short flyovers are left out, so the Piraeus-Athens motorway interchange is a partial one: the layer-1 decks stay, the layer-2 viaduct and the tunnels do not.
